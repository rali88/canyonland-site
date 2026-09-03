"""Build Lab Project 3: reconciling Chicago's enacted budget against payroll.

Projects 1 and 2 each read one source. Most real BI work is not that. It is two
systems that describe the same thing, disagree, and have no shared key — and the
question is not "what does the data say" but "which of these is right, and why
do they differ".

This joins the City's 2025 Budget Ordinance (positions and salaries) to the
payroll costing dataset Project 2 already uses. They should reconcile. They do
not, in four separate ways, and every one of them would produce a confident
wrong number:

  * The codes do not match at all. Budget writes department 84 and title 0624;
    payroll writes D84 and T0624. A raw inner join returns zero rows, so a
    dashboard built on it renders an empty chart rather than an error.
  * total_budgeted_unit mixes annual positions with hourly *hours*. Summing the
    column reports 3.37m budgeted positions for a city that pays about 33,000
    people.
  * Counting distinct employees paid across a year is not headcount. Turnover
    means more people are paid than there are positions.
  * After all of that the two figures still measure different populations, so
    the subtraction everyone wants -- budget minus actual equals vacancies --
    is not available from these datasets. The page says so rather than
    publishing a number that would be quoted.

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
BUDGET = "2bp7-w85v"      # 2025 Budget Ordinance - Positions and Salaries
APPROP = "t59y-fr3k"      # 2025 Budget Ordinance - Appropriations
PAYROLL = "dawh-m56b"     # Employee Payroll Data (FMPS Payroll Costing)

FOCUS_YEAR = "2025"
POINT_IN_TIME = "24"      # last pay period of the focus year

# Stated conversions. A budget row measured in hours is not a position, and
# turning one into the other requires an assumption; this is ours, and it is
# published on the page rather than buried here.
HOURS_PER_FTE = 2080.0
MONTHS_PER_FTE = 12.0

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
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def soql(dataset, label, params, cache_key=None, publish=True):
    url = api(dataset) + "?" + urllib.parse.urlencode(params)
    if publish:
        QUERIES.append({"label": label, "dataset": dataset, "params": dict(params)})
    key = cache_key or re.sub(r"[^a-z0-9]+", "-", label.lower())[:60]
    path = os.path.join(CACHE, "b-" + key + ".json")
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
            time.sleep(3 * (attempt + 1))
    io.open(path, "w", encoding="utf-8").write(json.dumps(data))
    return data


def paged(dataset, label, params, page=40000, cache_prefix=""):
    """Same as soql, for results larger than one response."""
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


# --------------------------------------------------------------------------
# The normalisation rule, stated once and applied everywhere
# --------------------------------------------------------------------------

def norm_code(v):
    """Strip a leading system letter and leading zeros.

    Payroll writes D84 / T0624; the budget writes 84 / 0624. Neither is wrong;
    they are different systems. Leading zeros go too, because 0624 and 624 are
    the same title. Codes containing letters after the first (03A8) keep them.
    """
    s = str(v or "").strip().upper()
    s = re.sub(r"^[DT]", "", s)
    s = s.lstrip("0")
    return s


def fte(units, unit_kind):
    """Convert a budgeted unit to full-time equivalents under a stated rule."""
    u = (unit_kind or "").strip().lower()
    if u == "annual":
        return units
    if u == "hourly":
        return units / HOURS_PER_FTE
    if u == "monthly":
        return units / MONTHS_PER_FTE
    return 0.0


def main():
    os.makedirs(OUT, exist_ok=True)
    print("Reconciling budget against payroll for " + FOCUS_YEAR)

    meta_b = _get("https://" + DOMAIN + "/api/views/" + BUDGET + ".json")
    meta_p = _get("https://" + DOMAIN + "/api/views/" + PAYROLL + ".json")
    upd = lambda m: datetime.fromtimestamp(
        m["rowsUpdatedAt"], timezone.utc).date().isoformat()

    # ---- budget side ----------------------------------------------------
    print("  querying the budget ordinance ...")
    bud_rows = soql(BUDGET, "Budgeted positions and salaries by department and title", {
        "$select": "department_code,department_description,title_code,"
                   "title_description,budgeted_unit,"
                   "sum(total_budgeted_unit) as units,"
                   "sum(total_budgeted_amount) as amt",
        "$group": "department_code,department_description,title_code,"
                  "title_description,budgeted_unit",
        "$limit": "50000"})

    by_unit = {}
    for r in bud_rows:
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
    units_table = sorted(by_unit.values(), key=lambda x: -x["amount"])

    naive_units = round(sum(e["units"] for e in units_table), 2)
    budget_fte = round(sum(e["fte"] for e in units_table), 2)
    budget_amount = round(sum(e["amount"] for e in units_table), 2)

    # ---- actual side -----------------------------------------------------
    print("  querying payroll actuals ...")
    act_rows = soql(PAYROLL, "Employees paid and dollars by department and title, "
                    + FOCUS_YEAR, {
        "$select": "department_code,department,title_code,title,"
                   "count(distinct employee_dataset_id) as emps,"
                   "sum(amount) as amt",
        "$where": "payroll_year='" + FOCUS_YEAR + "'",
        "$group": "department_code,department,title_code,title",
        "$limit": "50000"})

    pit_rows = soql(PAYROLL, "Employees paid in the final pay period of "
                    + FOCUS_YEAR, {
        "$select": "department_code,department,"
                   "count(distinct employee_dataset_id) as emps",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND payroll_period='"
                  + POINT_IN_TIME + "'",
        "$group": "department_code,department",
        "$limit": "5000"},
        cache_key="pit-dept")

    annual_head = int(num(soql(PAYROLL, "Distinct employees paid in " + FOCUS_YEAR, {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + FOCUS_YEAR + "'"},
        cache_key="annual-head")[0]["e"]))
    pit_head = int(num(soql(PAYROLL, "Distinct employees paid in the final period", {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND payroll_period='"
                  + POINT_IN_TIME + "'"},
        cache_key="pit-head")[0]["e"]))
    actual_amount = money(soql(PAYROLL, "Total paid in " + FOCUS_YEAR, {
        "$select": "sum(amount) as amt",
        "$where": "payroll_year='" + FOCUS_YEAR + "'"},
        cache_key="actual-total")[0]["amt"])

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

    # Summing count(distinct employee) across grouped rows counts a person once
    # per department-title they held, and 2,389 people held more than one in
    # this year alone. The unmatched population is a headline number supporting
    # the page's refusal to publish a vacancy rate, so it is counted as a set of
    # distinct people rather than a sum of group counts.
    print("  counting distinct people behind the unmatched keys ...")
    grid = paged(PAYROLL, "Employee, department and title combinations, " + FOCUS_YEAR, {
        "$select": "employee_dataset_id,department_code,title_code",
        "$where": "payroll_year='" + FOCUS_YEAR + "'",
        "$group": "employee_dataset_id,department_code,title_code",
        "$order": "employee_dataset_id"}, cache_prefix="grid-year")
    grid_pit = paged(PAYROLL, "The same combinations in the final pay period", {
        "$select": "employee_dataset_id,department_code,title_code",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND payroll_period='"
                  + POINT_IN_TIME + "'",
        "$group": "employee_dataset_id,department_code,title_code",
        "$order": "employee_dataset_id"}, cache_prefix="grid-pit")

    unmatched = set(actual_only)

    def distinct_on_unmatched(rows):
        return set(r["employee_dataset_id"] for r in rows
                   if (norm_code(r.get("department_code")),
                       norm_code(r.get("title_code"))) in unmatched)

    unmatched_people = distinct_on_unmatched(grid)
    unmatched_people_pit = distinct_on_unmatched(grid_pit)
    grid_rows = len(grid)
    grid_people = len(set(r["employee_dataset_id"] for r in grid))

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
        # Distinct people, and separately the sum of group counts, so the gap
        # between the two is visible rather than hidden.
        "actualOnlyEmployees": len(unmatched_people),
        "actualOnlyEmployeesPointInTime": len(unmatched_people_pit),
        "actualOnlyRowSum": sum(act_by_key[k]["emps"] for k in actual_only),
        "multiTitleRows": grid_rows,
        "multiTitlePeople": grid_people,
        "actualOnlyAmount": round(sum(act_by_key[k]["amount"] for k in actual_only), 2),
        "sampleRaw": [{"budget": {"dept": r.get("department_code"),
                                  "title": r.get("title_code")},
                       "payroll": None} for r in bud_rows[:1]],
    }
    # A concrete before/after for the page: one key in each notation.
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
    # Not every budget-only key is an unfilled job. Many are budget lines that
    # were never positions at all -- fringe benefits, salary adjustment pools --
    # and counting them as vacancies would be the same error as counting hours
    # as positions.
    zero_fte = [k for k in budget_only if bud_by_key[k]["fte"] < 0.005]
    join["budgetOnlyNonPosition"] = len(zero_fte)
    join["budgetOnlyNonPositionAmount"] = round(
        sum(bud_by_key[k]["amount"] for k in zero_fte), 2)
    join["budgetOnlyRealPositions"] = len(budget_only) - len(zero_fte)
    join["budgetOnlyRealFte"] = round(
        sum(bud_by_key[k]["fte"] for k in budget_only if k not in set(zero_fte)), 1)

    join["topBudgetOnly"] = [
        {"dept": bud_by_key[k]["dept"], "title": bud_by_key[k]["title"],
         "fte": round(bud_by_key[k]["fte"], 1),
         "amount": round(bud_by_key[k]["amount"], 2)}
        for k in sorted(budget_only, key=lambda k: -bud_by_key[k]["amount"])[:10]]
    join["topActualOnly"] = [
        {"dept": act_by_key[k]["dept"], "title": act_by_key[k]["title"],
         "employees": act_by_key[k]["emps"],
         "amount": round(act_by_key[k]["amount"], 2)}
        for k in sorted(actual_only, key=lambda k: -act_by_key[k]["amount"])[:10]]

    # ---- department comparison -------------------------------------------
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
        # A budget line with no headcount is not salary. Fringe benefits and
        # adjustment pools live here, and folding them into a salary column
        # would repeat the mixed-units error this page is about.
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
    dept_pit = {}
    for r in pit_rows:
        dept_pit[norm_code(r.get("department_code"))] = int(num(r["emps"]))

    departments = []
    for d in sorted(set(dept_budget) | set(dept_actual)):
        b = dept_budget.get(d)
        a = dept_actual.get(d)
        departments.append({
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
        })
    departments.sort(key=lambda x: -(x["actualAmount"] or 0))

    # Department names differ between the two systems more often than not.
    name_mismatch = [d for d in departments
                     if d["budgetFte"] is not None and d["payrollName"]
                     and d["name"].strip().lower()
                     != re.sub(r"^D?\d+\s*-\s*", "", d["payrollName"]).strip().lower()]

    # ---- findings --------------------------------------------------------
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
            "numbers": {"naiveTotal": naive_units, "fte": budget_fte,
                        "ratio": round(naive_units / budget_fte, 1) if budget_fte else None,
                        "unitKinds": len(units_table),
                        "hourly": next((e["units"] for e in units_table
                                        if e["unit"].lower() == "hourly"), 0),
                        "annual": next((e["units"] for e in units_table
                                        if e["unit"].lower() == "annual"), 0)},
            "check": "Group by budgeted_unit before summing total_budgeted_unit.",
        },
        {
            "id": "headcount-is-a-choice",
            "title": "Counting people paid in a year is not headcount",
            "numbers": {"annual": annual_head, "pointInTime": pit_head,
                        "difference": annual_head - pit_head,
                        "pct": round((annual_head - pit_head) / pit_head * 100, 1),
                        "period": int(POINT_IN_TIME)},
            "check": "Count distinct employees for the whole year, then for a "
                     "single pay period.",
        },
        {
            "id": "not-a-vacancy-rate",
            "title": "The subtraction everyone wants is not available here",
            "numbers": {"budgetFte": budget_fte, "pointInTime": pit_head,
                        "naiveGap": round(pit_head - budget_fte, 1),
                        "budgetOnly": len(budget_only),
                        "budgetOnlyNonPosition": len(zero_fte),
                        "budgetOnlyRealPositions": len(budget_only) - len(zero_fte),
                        "actualOnly": len(actual_only),
                        "actualOnlyEmployees": join["actualOnlyEmployees"],
                        "actualOnlyEmployeesPointInTime":
                            join["actualOnlyEmployeesPointInTime"],
                        "actualOnlyAmount": join["actualOnlyAmount"]},
            "check": "Compare the populations each dataset covers before "
                     "subtracting one from the other.",
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
            "pointInTimePeriod": int(POINT_IN_TIME),
            "normalisation": "Strip a leading D or T, then leading zeros, from "
                             "department and title codes on both sides.",
            "fteRule": ("Annual units count as one FTE each; hourly units are "
                        "divided by %d hours; monthly units by %d months."
                        % (int(HOURS_PER_FTE), int(MONTHS_PER_FTE))),
            "hoursPerFte": HOURS_PER_FTE,
        },
        "join": join,
        "budget": {"byUnit": units_table, "naiveUnits": naive_units,
                   "fte": budget_fte, "amount": budget_amount,
                   "positionAmount": round(sum(
                       v["positionAmount"] for v in dept_budget.values()), 2),
                   "nonPositionAmount": round(sum(
                       v["nonPositionAmount"] for v in dept_budget.values()), 2)},
        "actual": {"annualHeadcount": annual_head, "pointInTime": pit_head,
                   "amount": actual_amount},
        "departments": departments,
        "nameMismatches": len(name_mismatch),
        "findings": findings,
    }

    payload["expected"] = {
        "rawMatches": raw_matches,
        "matched": len(matched),
        "matchRate": join["matchRate"],
        "unitKinds": len(units_table),
        "budgetFte": budget_fte,
        "annualHeadcount": annual_head,
        "pointInTime": pit_head,
        "departments": len(departments),
        "findings": len(findings),
        "actualOnlyEmployees": join["actualOnlyEmployees"],
    }

    path = os.path.join(OUT, "chicago-budget.json")
    io.open(path, "w", encoding="utf-8").write(
        json.dumps(payload, separators=(",", ":")))
    print("")
    print("  wrote %s  (%.1f KB)" % (path, os.path.getsize(path) / 1024.0))
    print("  raw join matched %d of %d budget keys" % (raw_matches, len(raw_budget)))
    print("  normalised join matched %d (%.1f%%)" % (len(matched), join["matchRate"]))
    print("  budget: %s naive units -> %s FTE" % (
        format(naive_units, ",.0f"), format(budget_fte, ",.0f")))
    print("  paid: %s across the year, %s in period %s" % (
        format(annual_head, ","), format(pit_head, ","), POINT_IN_TIME))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
