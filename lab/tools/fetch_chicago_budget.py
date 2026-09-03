"""Build Lab Project 3: reconciling Chicago's enacted budget against payroll.

Projects 1 and 2 each read one source. Most real BI work is not that. It is two
systems that describe the same thing, disagree, and have no shared key -- and
the question is not "what does the data say" but "which of these is right, and
why do they differ".

This joins the City's Budget Ordinance (positions and salaries) to the payroll
costing dataset Project 2 uses. They should reconcile. They do not, in five
separate ways, and every one of them would produce a confident wrong number:

  * The codes do not match at all. Budget writes department 84 and title 0624;
    payroll writes D84 and T0624. A raw inner join returns zero rows, so a
    dashboard built on it renders an empty chart rather than an error.
  * total_budgeted_unit mixes annual positions with hourly *hours*. Summing the
    column reports millions of budgeted positions for a city of about 33,000.
  * The budget covers a whole year the payroll has not finished. Comparing the
    two without saying how much of the year has run reports an "underspend"
    that is nothing but unelapsed time.
  * Counting distinct employees paid over a span is not headcount.
  * Unmatched payroll is mostly not unbudgeted people. It is budgeted people
    charged to a different department from the one that funds them. An earlier
    version of this page called them "titles that appear in no budget line at
    all", which was wrong: the join is on a department-title pair, and most of
    those titles are funded under another department.

Run:  py lab/tools/fetch_chicago_budget.py
Then: py lab/tools/verify_chicago_budget.py
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DOMAIN = "data.cityofchicago.org"
BUDGET = "v2t2-vajc"        # 2026 Budget Ordinance - Positions and Salaries
PRIOR_BUDGET = "2bp7-w85v"  # 2025, for a plan-against-plan comparison
PAYROLL = "dawh-m56b"       # Employee Payroll Data (FMPS Payroll Costing)

# The budget year and the payroll year are deliberately the same. A budget is a
# plan for a year; comparing it against a different year's outcome answers a
# question nobody asked.
FOCUS_YEAR = "2026"
PRIOR_YEAR = "2025"

# Stated conversions. A budget row measured in hours is not a position, and
# turning one into the other requires an assumption; this is ours, and it is
# published on the page rather than buried here.
HOURS_PER_FTE = 2080.0
MONTHS_PER_FTE = 12.0

# Payroll charges real staff to a central accounting department; the ordinance
# funds them in their operating department. Every such row fails the join
# without anybody being unbudgeted.
CENTRAL_DEPT_HINT = "FINANCE GENERAL"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "data"))
CACHE = os.path.join(HERE, ".cache")

QUERIES = []


def api(dataset):
    return "https://" + DOMAIN + "/resource/" + dataset + ".json"


def _get(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "canyonland-lab/1.0 (+https://www.canyonlandtech.com)",
    })
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def soql(dataset, label, params, cache_key=None, publish=True):
    url = api(dataset) + "?" + urllib.parse.urlencode(params)
    if publish:
        QUERIES.append({"label": label, "dataset": dataset, "params": dict(params)})
    key = cache_key or re.sub(r"[^a-z0-9]+", "-", label.lower())[:60]
    path = os.path.join(CACHE, "b26-" + key + ".json")
    if os.path.exists(path):
        return json.load(io.open(path, encoding="utf-8"))
    os.makedirs(CACHE, exist_ok=True)
    for attempt in range(4):
        try:
            data = _get(url)
            break
        except Exception as exc:                       # pragma: no cover - network
            if attempt == 3:
                raise
            print("    retry %d after %s" % (attempt + 1, exc), file=sys.stderr)
            time.sleep(4 * (attempt + 1))
    io.open(path, "w", encoding="utf-8").write(json.dumps(data))
    return data


def paged(dataset, label, params, page=40000, cache_prefix=""):
    out, offset = [], 0
    base = cache_prefix or re.sub(r"[^a-z0-9]+", "-", label.lower())[:50]
    while True:
        p = dict(params)
        p["$limit"] = str(page)
        p["$offset"] = str(offset)
        chunk = soql(dataset, label, p, cache_key=base + "-" + str(offset),
                     publish=(offset == 0))
        out.extend(chunk)
        if len(chunk) < page:
            return out
        offset += page


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def money(v):
    return round(num(v), 2)


def norm_code(v):
    """Strip a leading system letter and leading zeros.

    Payroll writes D84 / T0624; the budget writes 84 / 0624. Neither is wrong;
    they are different systems. Codes with letters later (03A8) keep them.
    """
    s = str(v or "").strip().upper()
    s = re.sub(r"^[DT]", "", s)
    return s.lstrip("0")


def fte(units, unit_kind):
    u = (unit_kind or "").strip().lower()
    if u == "annual":
        return units
    if u == "hourly":
        return units / HOURS_PER_FTE
    if u == "monthly":
        return units / MONTHS_PER_FTE
    return 0.0


def budget_rows(dataset, label, cache_key):
    return soql(dataset, label, {
        "$select": "department_code,department_description,title_code,"
                   "title_description,budgeted_unit,"
                   "sum(total_budgeted_unit) as units,"
                   "sum(total_budgeted_amount) as amt",
        "$group": "department_code,department_description,title_code,"
                  "title_description,budgeted_unit",
        "$limit": "50000"}, cache_key=cache_key)


def summarise_budget(rows):
    by_unit = {}
    for r in rows:
        k = (r.get("budgeted_unit") or "").strip() or "(blank)"
        e = by_unit.setdefault(k, {"unit": k, "rows": 0, "units": 0.0,
                                   "amount": 0.0, "fte": 0.0})
        e["rows"] += 1
        e["units"] += num(r["units"])
        e["amount"] = round(e["amount"] + money(r["amt"]), 2)
        e["fte"] += fte(num(r["units"]), k)
    for e in by_unit.values():
        e["units"] = round(e["units"], 2)
        e["fte"] = round(e["fte"], 2)
    table = sorted(by_unit.values(), key=lambda x: -x["amount"])
    return {
        "byUnit": table,
        "naiveUnits": round(sum(e["units"] for e in table), 2),
        "fte": round(sum(e["fte"] for e in table), 2),
        "amount": round(sum(e["amount"] for e in table), 2),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    print("Reconciling the " + FOCUS_YEAR + " budget ordinance against payroll")

    meta_b = _get("https://" + DOMAIN + "/api/views/" + BUDGET + ".json")
    meta_p = _get("https://" + DOMAIN + "/api/views/" + PAYROLL + ".json")

    def upd(m):
        return datetime.fromtimestamp(
            m["rowsUpdatedAt"], timezone.utc).date().isoformat()

    # ---- how much of the focus year has actually happened ----------------
    #
    # Neither the elapsed periods nor the length of a full year is hardcoded.
    # A snapshot rebuilt three months from now must not keep claiming six
    # periods have run.
    coverage = soql(PAYROLL, "Pay periods present in each payroll year", {
        "$select": "payroll_year,count(distinct payroll_period) as periods,"
                   "max(payroll_period) as last,sum(amount) as amt",
        "$group": "payroll_year", "$order": "payroll_year"},
        cache_key="coverage")
    cov = {r["payroll_year"]: r for r in coverage}
    if FOCUS_YEAR not in cov:
        print("The payroll dataset carries no rows for " + FOCUS_YEAR + " yet.")
        return 1
    periods_elapsed = int(num(cov[FOCUS_YEAR]["periods"]))
    point_in_time = str(int(num(cov[FOCUS_YEAR]["last"])))
    periods_in_year = max(int(num(r["periods"])) for r in coverage)
    year_complete = periods_elapsed >= periods_in_year
    elapsed_share = periods_elapsed / float(periods_in_year)
    print("  %s: %d of %d pay periods have run (%.1f%% of the year)"
          % (FOCUS_YEAR, periods_elapsed, periods_in_year, elapsed_share * 100))

    # ---- budget, this year and last --------------------------------------
    print("  querying the budget ordinance ...")
    bud_rows = budget_rows(BUDGET, "Budgeted positions and salaries, " + FOCUS_YEAR,
                           "bud-focus")
    budget = summarise_budget(bud_rows)
    prior_rows = budget_rows(PRIOR_BUDGET, "The previous ordinance, " + PRIOR_YEAR,
                             "bud-prior")
    prior = summarise_budget(prior_rows)

    # ---- actual side -----------------------------------------------------
    print("  querying payroll actuals ...")
    act_rows = soql(PAYROLL, "Employees paid and dollars by department and title, "
                    + FOCUS_YEAR, {
        "$select": "department_code,department,title_code,title,"
                   "count(distinct employee_dataset_id) as emps,"
                   "sum(amount) as amt",
        "$where": "payroll_year='" + FOCUS_YEAR + "'",
        "$group": "department_code,department,title_code,title",
        "$limit": "50000"}, cache_key="act-rows")

    pit_rows = soql(PAYROLL, "Employees paid in the latest pay period", {
        "$select": "department_code,department,"
                   "count(distinct employee_dataset_id) as emps",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND payroll_period='"
                  + point_in_time + "'",
        "$group": "department_code,department",
        "$limit": "5000"}, cache_key="pit-dept")

    annual_head = int(num(soql(PAYROLL,
                               "Distinct employees paid so far in " + FOCUS_YEAR, {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + FOCUS_YEAR + "'"},
        cache_key="annual-head")[0]["e"]))
    pit_head = int(num(soql(PAYROLL, "Distinct employees in the latest period", {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND payroll_period='"
                  + point_in_time + "'"},
        cache_key="pit-head")[0]["e"]))
    actual_amount = money(cov[FOCUS_YEAR]["amt"])

    # The same definitional gap over a year that did finish, so the page can
    # say how much of the effect is simply time not yet elapsed.
    prior_annual = int(num(soql(PAYROLL, "Distinct employees paid in " + PRIOR_YEAR, {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + PRIOR_YEAR + "'"},
        cache_key="prior-annual")[0]["e"]))
    prior_pit = int(num(soql(PAYROLL,
                             "Distinct employees in the last period of " + PRIOR_YEAR, {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + PRIOR_YEAR + "' AND payroll_period='"
                  + str(periods_in_year) + "'"},
        cache_key="prior-pit")[0]["e"]))

    # ---- the join --------------------------------------------------------
    print("  joining ...")
    raw_budget = set((str(r.get("department_code", "")).strip(),
                      str(r.get("title_code", "")).strip()) for r in bud_rows)
    raw_actual = set((str(r.get("department_code", "")).strip(),
                      str(r.get("title_code", "")).strip()) for r in act_rows)
    raw_matches = len(raw_budget & raw_actual)

    def nkey(r):
        return (norm_code(r.get("department_code")), norm_code(r.get("title_code")))

    bud_by_key, act_by_key = {}, {}
    for r in bud_rows:
        k = nkey(r)
        e = bud_by_key.setdefault(k, {"fte": 0.0, "amount": 0.0,
                                      "title": r.get("title_description") or "",
                                      "dept": r.get("department_description") or ""})
        e["fte"] += fte(num(r["units"]), r.get("budgeted_unit"))
        e["amount"] += money(r["amt"])
    for r in act_rows:
        k = nkey(r)
        e = act_by_key.setdefault(k, {"emps": 0, "amount": 0.0,
                                      "title": r.get("title") or "",
                                      "dept": r.get("department") or ""})
        e["emps"] += int(num(r["emps"]))
        e["amount"] += money(r["amt"])

    matched = set(bud_by_key) & set(act_by_key)
    budget_only = sorted(set(bud_by_key) - set(act_by_key))
    actual_only = sorted(set(act_by_key) - set(bud_by_key))

    # ---- what the unmatched payroll actually is ---------------------------
    budgeted_titles = set(k[1] for k in bud_by_key)
    title_elsewhere = [k for k in actual_only if k[1] in budgeted_titles]
    title_never = [k for k in actual_only if k[1] not in budgeted_titles]
    central = [k for k in actual_only
               if CENTRAL_DEPT_HINT in (act_by_key[k]["dept"] or "").upper()]
    central_amount = round(sum(act_by_key[k]["amount"] for k in central), 2)
    unmatched_amount = round(sum(act_by_key[k]["amount"] for k in actual_only), 2)

    print("  counting distinct people behind the unmatched keys ...")
    grid = paged(PAYROLL, "Employee, department and title combinations, "
                 + FOCUS_YEAR, {
        "$select": "employee_dataset_id,department_code,title_code",
        "$where": "payroll_year='" + FOCUS_YEAR + "'",
        "$group": "employee_dataset_id,department_code,title_code",
        "$order": "employee_dataset_id"}, cache_prefix="grid-year")
    grid_pit = paged(PAYROLL, "The same combinations in the latest period", {
        "$select": "employee_dataset_id,department_code,title_code",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND payroll_period='"
                  + point_in_time + "'",
        "$group": "employee_dataset_id,department_code,title_code",
        "$order": "employee_dataset_id"}, cache_prefix="grid-pit")

    def people_on(rows, keys):
        return set(r["employee_dataset_id"] for r in rows
                   if (norm_code(r.get("department_code")),
                       norm_code(r.get("title_code"))) in keys)

    unmatched_people = people_on(grid, set(actual_only))
    unmatched_people_pit = people_on(grid_pit, set(actual_only))
    central_people = people_on(grid, set(central))
    # Attribution is a department-level effect. A person booked centrally is
    # still inside the city-wide headcount, so the city-wide subtraction is not
    # explained by it -- and quoting an annual attribution count beside a
    # point-in-time headcount compares two different populations as well.
    central_people_pit = people_on(grid_pit, set(central))
    never_people = people_on(grid, set(title_never))

    join = {
        "rawBudgetKeys": len(raw_budget),
        "rawActualKeys": len(raw_actual),
        "rawMatches": raw_matches,
        "normalisedBudgetKeys": len(bud_by_key),
        "normalisedActualKeys": len(act_by_key),
        "matched": len(matched),
        "matchRate": round(len(matched) / len(bud_by_key) * 100, 1),
        "budgetOnly": len(budget_only),
        "actualOnly": len(actual_only),
        "budgetOnlyFte": round(sum(bud_by_key[k]["fte"] for k in budget_only), 1),
        "budgetOnlyAmount": round(sum(bud_by_key[k]["amount"] for k in budget_only), 2),
        "actualOnlyEmployees": len(unmatched_people),
        "actualOnlyEmployeesPointInTime": len(unmatched_people_pit),
        "actualOnlyRowSum": sum(act_by_key[k]["emps"] for k in actual_only),
        "actualOnlyAmount": unmatched_amount,
        "titleBudgetedElsewhere": len(title_elsewhere),
        "titleNeverBudgeted": len(title_never),
        "titleNeverBudgetedPeople": len(never_people),
        "centralKeys": len(central),
        "centralPeople": len(central_people),
        "centralPeoplePointInTime": len(central_people_pit),
        "centralAmount": central_amount,
        "centralShareOfUnmatchedAmount": (round(central_amount / unmatched_amount * 100, 1)
                                          if unmatched_amount else 0.0),
        "centralDepartment": next((act_by_key[k]["dept"] for k in central), ""),
        "multiTitleRows": len(grid),
        "multiTitlePeople": len(set(r["employee_dataset_id"] for r in grid)),
    }

    example = sorted(matched)[0] if matched else None
    if example:
        b = next(r for r in bud_rows if nkey(r) == example)
        a = next(r for r in act_rows if nkey(r) == example)
        join["example"] = {
            "budgetDept": b.get("department_code"), "budgetTitle": b.get("title_code"),
            "payrollDept": a.get("department_code"), "payrollTitle": a.get("title_code"),
            "normalisedDept": example[0], "normalisedTitle": example[1],
            "titleDescription": b.get("title_description") or a.get("title"),
        }

    zero_fte = set(k for k in budget_only if bud_by_key[k]["fte"] < 0.005)
    join["budgetOnlyNonPosition"] = len(zero_fte)
    join["budgetOnlyNonPositionAmount"] = round(
        sum(bud_by_key[k]["amount"] for k in zero_fte), 2)
    join["budgetOnlyRealPositions"] = len(budget_only) - len(zero_fte)
    join["budgetOnlyRealFte"] = round(
        sum(bud_by_key[k]["fte"] for k in budget_only if k not in zero_fte), 1)
    join["topActualOnly"] = [
        {"dept": act_by_key[k]["dept"], "title": act_by_key[k]["title"],
         "employees": act_by_key[k]["emps"],
         "amount": round(act_by_key[k]["amount"], 2),
         "titleBudgetedElsewhere": k[1] in budgeted_titles}
        for k in sorted(actual_only, key=lambda k: -act_by_key[k]["amount"])[:10]]
    join["topBudgetOnly"] = [
        {"dept": bud_by_key[k]["dept"], "title": bud_by_key[k]["title"],
         "fte": round(bud_by_key[k]["fte"], 1),
         "amount": round(bud_by_key[k]["amount"], 2)}
        for k in sorted(budget_only, key=lambda k: -bud_by_key[k]["amount"])[:10]]

    # ---- departments -----------------------------------------------------
    dept_budget, dept_actual = {}, {}
    for r in bud_rows:
        d = norm_code(r.get("department_code"))
        e = dept_budget.setdefault(d, {"code": d,
                                       "name": r.get("department_description") or "",
                                       "fte": 0.0, "amount": 0.0,
                                       "positionAmount": 0.0,
                                       "nonPositionAmount": 0.0})
        f = fte(num(r["units"]), r.get("budgeted_unit"))
        e["fte"] += f
        e["amount"] += money(r["amt"])
        if f >= 0.005:
            e["positionAmount"] += money(r["amt"])
        else:
            e["nonPositionAmount"] += money(r["amt"])
    for r in act_rows:
        d = norm_code(r.get("department_code"))
        e = dept_actual.setdefault(d, {"code": d, "name": r.get("department") or "",
                                       "annual": 0, "amount": 0.0})
        e["annual"] += int(num(r["emps"]))
        e["amount"] += money(r["amt"])
    dept_pit = {norm_code(r.get("department_code")): int(num(r["emps"]))
                for r in pit_rows}

    departments = []
    for d in sorted(set(dept_budget) | set(dept_actual)):
        b = dept_budget.get(d)
        a = dept_actual.get(d)
        row = {
            "code": d,
            "name": (b or {}).get("name") or (a or {}).get("name") or d,
            "payrollName": (a or {}).get("name") or "",
            "budgetFte": round(b["fte"], 1) if b else None,
            "budgetAmount": round(b["amount"], 2) if b else None,
            "budgetPositionAmount": round(b["positionAmount"], 2) if b else None,
            "budgetNonPositionAmount": round(b["nonPositionAmount"], 2) if b else None,
            "annualHeadcount": a["annual"] if a else None,
            "pointInTime": dept_pit.get(d),
            "actualAmount": round(a["amount"], 2) if a else None,
        }
        # Share of the year's funded salary already paid, to be read against the
        # share of the year that has elapsed. Comparing the raw totals instead
        # reports an underspend that is only unelapsed time.
        row["burnShare"] = (round(a["amount"] / b["positionAmount"] * 100, 1)
                            if b and a and b["positionAmount"] else None)
        departments.append(row)
    departments.sort(key=lambda x: -(x["actualAmount"] or 0))

    name_mismatch = [d for d in departments
                     if d["budgetFte"] is not None and d["payrollName"]
                     and d["name"].strip().lower()
                     != re.sub(r"^D?\d+\s*-\s*", "", d["payrollName"]).strip().lower()]

    # City-wide split of the budget into salary for funded positions and lines
    # carrying no headcount. Both the page and the verifier read these, so they
    # are totalled here rather than recomputed in two places.
    budget["positionAmount"] = round(
        sum(v["positionAmount"] for v in dept_budget.values()), 2)
    budget["nonPositionAmount"] = round(
        sum(v["nonPositionAmount"] for v in dept_budget.values()), 2)

    burn_share = round(actual_amount / budget["amount"] * 100, 1)

    findings = [
        {
            "id": "no-shared-key",
            "title": "The two datasets share no key until you make one",
            "numbers": {"rawMatches": raw_matches,
                        "budgetKeys": len(raw_budget),
                        "actualKeys": len(raw_actual),
                        "matchedAfter": len(matched),
                        "matchRate": join["matchRate"]},
            "check": "Inner join on department_code and title_code as published, "
                     "then again after stripping the system letter and leading zeros.",
        },
        {
            "id": "mixed-units",
            "title": "The budget mixes positions with hours in one column",
            "numbers": {"naiveTotal": budget["naiveUnits"], "fte": budget["fte"],
                        "ratio": (round(budget["naiveUnits"] / budget["fte"], 1)
                                  if budget["fte"] else None),
                        "unitKinds": len(budget["byUnit"]),
                        "hourly": next((e["units"] for e in budget["byUnit"]
                                        if e["unit"].lower() == "hourly"), 0),
                        "annual": next((e["units"] for e in budget["byUnit"]
                                        if e["unit"].lower() == "annual"), 0)},
            "check": "Group by budgeted_unit before summing total_budgeted_unit.",
        },
        {
            "id": "partial-year",
            "title": "The budget covers a year the payroll has not finished",
            "numbers": {"periodsElapsed": periods_elapsed,
                        "periodsInYear": periods_in_year,
                        "elapsedPct": round(elapsed_share * 100, 1),
                        "budget": budget["amount"],
                        "paid": actual_amount,
                        "burnPct": burn_share,
                        "burnPctPositionsOnly": round(
                            actual_amount / budget["positionAmount"] * 100, 1)
                        if budget["positionAmount"] else None,
                        "positionAmount": budget["positionAmount"],
                        "nonPositionAmount": budget["nonPositionAmount"],
                        "naiveUnderspendPct": round(100 - burn_share, 1),
                        "complete": year_complete},
            "check": "Count distinct payroll_period in the focus year before "
                     "comparing any total against a full-year budget. Then check "
                     "whether the two sides cover the same costs before reading "
                     "the result as progress.",
        },
        {
            "id": "headcount-is-a-choice",
            "title": "Counting people paid is not counting headcount",
            "numbers": {"annual": annual_head, "pointInTime": pit_head,
                        "difference": annual_head - pit_head,
                        "pct": round((annual_head - pit_head) / pit_head * 100, 1),
                        "period": int(point_in_time),
                        "priorAnnual": prior_annual, "priorPointInTime": prior_pit,
                        "priorDifference": prior_annual - prior_pit,
                        "priorPct": round((prior_annual - prior_pit) / prior_pit * 100, 1),
                        "priorYear": PRIOR_YEAR},
            "check": "Count distinct employees for the year so far, then for a "
                     "single pay period.",
        },
        {
            "id": "not-a-vacancy-rate",
            "title": "Unmatched payroll is attribution, not absence",
            "numbers": {"budgetFte": budget["fte"], "pointInTime": pit_head,
                        "naiveGap": round(pit_head - budget["fte"], 1),
                        "budgetOnly": len(budget_only),
                        "budgetOnlyNonPosition": len(zero_fte),
                        "budgetOnlyRealPositions": len(budget_only) - len(zero_fte),
                        "actualOnly": len(actual_only),
                        "actualOnlyEmployees": len(unmatched_people),
                        "actualOnlyEmployeesPointInTime": len(unmatched_people_pit),
                        "actualOnlyAmount": unmatched_amount,
                        "titleBudgetedElsewhere": len(title_elsewhere),
                        "titleNeverBudgeted": len(title_never),
                        "titleNeverBudgetedPeople": len(never_people),
                        "centralPeople": len(central_people),
                        "centralPeoplePointInTime": len(central_people_pit),
                        "centralAmount": central_amount,
                        "hourlyUnits": next((e["units"] for e in budget["byUnit"]
                                             if e["unit"].lower() == "hourly"), 0),
                        "hourlyFte": next((e["fte"] for e in budget["byUnit"]
                                           if e["unit"].lower() == "hourly"), 0),
                        "centralShare": join["centralShareOfUnmatchedAmount"],
                        "centralDepartment": join["centralDepartment"]},
            "check": "For each unmatched department-title pair, check whether the "
                     "title is funded under a different department before calling "
                     "anyone unbudgeted. Separately: a budgeted FTE is a workload "
                     "measure, not a person, so it cannot be subtracted from a "
                     "headcount at any level.",
        },
    ]

    payload = {
        "source": {
            "publisher": "City of Chicago",
            "budget": {"dataset": meta_b["name"], "id": BUDGET,
                       "landing": "https://" + DOMAIN + "/d/" + BUDGET,
                       "rows": len(bud_rows), "updated": upd(meta_b),
                       "license": (meta_b.get("license") or {}).get("name")
                                  or "See Terms of Use"},
            "payroll": {"dataset": meta_p["name"], "id": PAYROLL,
                        "landing": "https://" + DOMAIN + "/d/" + PAYROLL,
                        "updated": upd(meta_p),
                        "license": (meta_p.get("license") or {}).get("name")
                                   or "See Terms of Use"},
            "priorBudget": {"id": PRIOR_BUDGET, "year": PRIOR_YEAR,
                            "landing": "https://" + DOMAIN + "/d/" + PRIOR_BUDGET},
            "portal": "https://" + DOMAIN,
            "licenseUrl": "https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html",
            "attribution": "City of Chicago",
            "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "focusYear": FOCUS_YEAR,
            "mode": "Cached snapshot. Nothing on this page calls the portal at run time.",
        },
        "queries": QUERIES,
        "rules": {
            "focusYear": FOCUS_YEAR,
            "priorYear": PRIOR_YEAR,
            "pointInTimePeriod": int(point_in_time),
            "periodsElapsed": periods_elapsed,
            "periodsInYear": periods_in_year,
            "yearComplete": year_complete,
            "elapsedPct": round(elapsed_share * 100, 1),
            "normalisation": "Strip a leading D or T, then leading zeros, from "
                             "department and title codes on both sides.",
            "fteRule": ("Annual units count as one FTE each; hourly units are "
                        "divided by %d hours; monthly units by %d months."
                        % (int(HOURS_PER_FTE), int(MONTHS_PER_FTE))),
            "hoursPerFte": HOURS_PER_FTE,
        },
        "join": join,
        "budget": budget,
        "priorBudget": prior,
        "actual": {"annualHeadcount": annual_head, "pointInTime": pit_head,
                   "amount": actual_amount, "burnPct": burn_share},
        "departments": departments,
        "nameMismatches": len(name_mismatch),
        "findings": findings,
    }

    payload["expected"] = {
        "rawMatches": raw_matches,
        "matched": len(matched),
        "matchRate": join["matchRate"],
        "unitKinds": len(budget["byUnit"]),
        "budgetFte": budget["fte"],
        "annualHeadcount": annual_head,
        "pointInTime": pit_head,
        "departments": len(departments),
        "findings": len(findings),
        "actualOnlyEmployees": len(unmatched_people),
        "periodsElapsed": periods_elapsed,
        "burnPct": burn_share,
    }

    path = os.path.join(OUT, "chicago-budget.json")
    io.open(path, "w", encoding="utf-8").write(
        json.dumps(payload, separators=(",", ":")))
    print("")
    print("  wrote %s  (%.1f KB)" % (path, os.path.getsize(path) / 1024.0))
    print("  raw join matched %d of %d budget keys" % (raw_matches, len(raw_budget)))
    print("  normalised join matched %d (%.1f%%)" % (len(matched), join["matchRate"]))
    print("  budget %s: %s naive units -> %s FTE  ($%s)" % (
        FOCUS_YEAR, format(budget["naiveUnits"], ",.0f"),
        format(budget["fte"], ",.0f"), format(budget["amount"], ",.0f")))
    print("  budget %s: %s FTE ($%s)" % (
        PRIOR_YEAR, format(prior["fte"], ",.0f"), format(prior["amount"], ",.0f")))
    print("  %.0f%% of the year elapsed, %.1f%% of budget paid" % (
        elapsed_share * 100, burn_share))
    print("  unmatched payroll: %s people; %s charged to %s (%.0f%% of the money)" % (
        format(len(unmatched_people), ","), format(len(central_people), ","),
        join["centralDepartment"] or "a central account",
        join["centralShareOfUnmatchedAmount"]))
    print("  titles genuinely never budgeted: %d keys, %s people" % (
        len(title_never), format(len(never_people), ",")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
