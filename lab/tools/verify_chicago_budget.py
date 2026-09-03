"""Check the budget-vs-payroll snapshot against the City's API, independently.

Same contract as the Project 2 verifier: this shares no code with the fetcher.
It re-issues its own queries, writes its own normalisation, and rebuilds the
join from scratch, because a reconciliation that agrees only with itself proves
nothing at all.

The central claim of the page -- that the join as published matches zero rows
and that one rule takes it past ninety per cent -- is re-derived here from the
City's own data rather than read back out of the snapshot.

Needs network access.

Run:  py lab/tools/verify_chicago_budget.py
"""

from __future__ import annotations

import io
import json
import os
import re
import time
import urllib.parse
import urllib.request

DOMAIN = "data.cityofchicago.org"
BUDGET = "2bp7-w85v"
PAYROLL = "dawh-m56b"

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.abspath(os.path.join(HERE, "..", "data", "chicago-budget.json"))
LAB_INDEX = os.path.abspath(os.path.join(HERE, "..", "index.html"))

# Which pages must carry which figures as static text.
REQUIRED_FIGURES = {
    "lab/index.html": ("bamatch",),
}

failures = []


def check(label, ok, detail=""):
    print("  %s  %s%s" % ("PASS" if ok else "FAIL", label,
                          ("  " + detail) if detail else ""))
    if not ok:
        failures.append(label)


def get(dataset, params, timeout=300):
    """One query, retried. The largest of these pulls tens of thousands of
    grouped rows and the portal is occasionally slow enough to time out; a
    verifier that fails on a slow network teaches the wrong lesson."""
    url = ("https://" + DOMAIN + "/resource/" + dataset + ".json?"
           + urllib.parse.urlencode(params))
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "canyonland-lab-verify/1.0"})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as exc:                      # pragma: no cover - network
            last = exc
            print("    retry %d after %s" % (attempt + 1, exc))
            time.sleep(4 * (attempt + 1))
    raise last


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def close(a, b, tol=1.0):
    return abs(float(a) - float(b)) <= tol


def normalise(v):
    """Independent restatement of the page's rule.

    Written as explicit steps rather than the fetcher's regular expression, so
    a change to that expression does not silently change this too.
    """
    s = str(v or "").strip().upper()
    if s[:1] in ("D", "T"):
        s = s[1:]
    while s.startswith("0"):
        s = s[1:]
    return s


def main():
    if not os.path.exists(SNAPSHOT):
        print("No snapshot; run fetch_chicago_budget.py first.")
        return 1
    d = json.load(io.open(SNAPSHOT, encoding="utf-8"))
    focus = d["rules"]["focusYear"]
    period = str(d["rules"]["pointInTimePeriod"])

    print("Snapshot")
    print("  retrieved  " + d["source"]["retrieved"])
    print("  focus year " + focus)

    print("\nNo individual should appear anywhere in this payload")
    blob = json.dumps(d)
    check("no employee name field", '"employee"' not in blob)
    check("no surrogate employee id", "employee_dataset_id" not in
          json.dumps([d["join"], d["departments"], d["budget"], d["actual"]]))

    # ---- rebuild the join from the source -------------------------------
    print("\nThe join, rebuilt from the City's data")
    bud = get(BUDGET, {
        "$select": "department_code,title_code,budgeted_unit,"
                   "sum(total_budgeted_unit) as units,"
                   "sum(total_budgeted_amount) as amt",
        "$group": "department_code,title_code,budgeted_unit",
        "$limit": "50000"})
    act = get(PAYROLL, {
        "$select": "department_code,title_code,"
                   "count(distinct employee_dataset_id) as emps",
        "$where": "payroll_year='" + focus + "'",
        "$group": "department_code,title_code",
        "$limit": "50000"})

    raw_b = set((str(r.get("department_code", "")).strip(),
                 str(r.get("title_code", "")).strip()) for r in bud)
    raw_a = set((str(r.get("department_code", "")).strip(),
                 str(r.get("title_code", "")).strip()) for r in act)
    raw_matches = len(raw_b & raw_a)
    check("the join as published still matches nothing",
          raw_matches == d["join"]["rawMatches"] == 0,
          "%d matches at source, snapshot says %d"
          % (raw_matches, d["join"]["rawMatches"]))

    norm_b = set((normalise(r.get("department_code")),
                  normalise(r.get("title_code"))) for r in bud)
    norm_a = set((normalise(r.get("department_code")),
                  normalise(r.get("title_code"))) for r in act)
    matched = len(norm_b & norm_a)
    check("normalised match count", matched == d["join"]["matched"],
          "%d at source, %d in snapshot" % (matched, d["join"]["matched"]))
    rate = round(matched / len(norm_b) * 100, 1)
    check("match rate", close(rate, d["join"]["matchRate"], 0.15),
          "%.1f%% at source, %.1f%% in snapshot" % (rate, d["join"]["matchRate"]))
    check("normalising actually changes the outcome", matched > raw_matches,
          "%d -> %d" % (raw_matches, matched))
    check("budget-only key count",
          len(norm_b - norm_a) == d["join"]["budgetOnly"],
          "%d at source" % len(norm_b - norm_a))
    check("payroll-only key count",
          len(norm_a - norm_b) == d["join"]["actualOnly"],
          "%d at source" % len(norm_a - norm_b))

    # ---- units, recomputed ------------------------------------------------
    print("\nBudgeted units, recomputed")
    units = {}
    for r in bud:
        k = (r.get("budgeted_unit") or "").strip() or "(blank)"
        units[k] = units.get(k, 0.0) + num(r["units"])
    check("the same unit kinds are present",
          set(units) == set(u["unit"] for u in d["budget"]["byUnit"]),
          str(sorted(units)))
    naive = round(sum(units.values()), 2)
    check("naive unit total", close(naive, d["budget"]["naiveUnits"], 1.0),
          "%s at source" % format(naive, ",.0f"))
    hours = d["rules"]["hoursPerFte"]
    fte = round(units.get("Annual", 0) + units.get("Hourly", 0) / hours
                + units.get("Monthly", 0) / 12.0, 2)
    check("FTE total under the published rule",
          close(fte, d["budget"]["fte"], 1.0),
          "%s at source, %s in snapshot" % (format(fte, ",.0f"),
                                            format(d["budget"]["fte"], ",.0f")))
    check("the naive total really is the stated multiple of the FTE total",
          close(round(naive / fte, 1),
                [f for f in d["findings"]
                 if f["id"] == "mixed-units"][0]["numbers"]["ratio"], 0.15),
          "x%.1f" % (naive / fte))

    # ---- headcount --------------------------------------------------------
    print("\nHeadcount, both definitions, re-queried")
    annual = int(num(get(PAYROLL, {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + focus + "'"})[0]["e"]))
    pit = int(num(get(PAYROLL, {
        "$select": "count(distinct employee_dataset_id) as e",
        "$where": "payroll_year='" + focus + "' AND payroll_period='"
                  + period + "'"})[0]["e"]))
    check("annual distinct employees", annual == d["actual"]["annualHeadcount"],
          "%s at source" % format(annual, ","))
    check("point-in-time employees", pit == d["actual"]["pointInTime"],
          "%s at source" % format(pit, ","))
    check("the two headcounts genuinely differ", annual > pit,
          "%s vs %s" % (format(annual, ","), format(pit, ",")))

    # ---- the refusal ------------------------------------------------------
    print("\nThe claim that a vacancy rate is not available")
    vac = [f for f in d["findings"] if f["id"] == "not-a-vacancy-rate"][0]["numbers"]
    check("the page reports unmatched payroll large enough to justify refusing",
          vac["actualOnlyEmployees"] > 0 and vac["actualOnlyAmount"] > 0,
          "%s people, $%s" % (format(vac["actualOnlyEmployees"], ","),
                              format(vac["actualOnlyAmount"], ",.0f")))
    # Recount the unmatched population from the source as a set of distinct
    # people. Summing count(distinct ...) across grouped rows counts anyone who
    # held two department-titles twice, and this number carries the refusal.
    grid = []
    offset = 0
    while True:
        chunk = get(PAYROLL, {
            "$select": "employee_dataset_id,department_code,title_code",
            "$where": "payroll_year='" + focus + "'",
            "$group": "employee_dataset_id,department_code,title_code",
            "$order": "employee_dataset_id",
            "$limit": "40000", "$offset": str(offset)})
        grid.extend(chunk)
        if len(chunk) < 40000:
            break
        offset += 40000
    unmatched_keys = norm_a - norm_b
    people = set(r["employee_dataset_id"] for r in grid
                 if (normalise(r.get("department_code")),
                     normalise(r.get("title_code"))) in unmatched_keys)
    check("unmatched people recounted from source as distinct individuals",
          len(people) == vac["actualOnlyEmployees"],
          "%s at source, %s in snapshot" % (format(len(people), ","),
                                            format(vac["actualOnlyEmployees"], ",")))
    check("the distinct count is below the sum of group counts, as it must be",
          d["join"]["actualOnlyEmployees"] <= d["join"]["actualOnlyRowSum"],
          "%s distinct vs %s row-sum"
          % (format(d["join"]["actualOnlyEmployees"], ","),
             format(d["join"]["actualOnlyRowSum"], ",")))
    check("unmatched payroll is a material share of the workforce",
          vac["actualOnlyEmployeesPointInTime"] / pit > 0.05,
          "%.1f%% of point-in-time headcount"
          % (vac["actualOnlyEmployeesPointInTime"] / pit * 100))
    check("the point-in-time unmatched count is a subset of the annual one",
          vac["actualOnlyEmployeesPointInTime"] <= vac["actualOnlyEmployees"])
    check("budget-only keys are split into positions and non-positions",
          d["join"]["budgetOnlyNonPosition"] + d["join"]["budgetOnlyRealPositions"]
          == d["join"]["budgetOnly"])

    # ---- internal ---------------------------------------------------------
    print("\nInternal consistency")
    e = d["expected"]
    check("expected block describes the payload",
          e["matched"] == d["join"]["matched"]
          and e["departments"] == len(d["departments"])
          and e["findings"] == len(d["findings"]))
    check("every department row has a name",
          all((x.get("name") or "").strip() for x in d["departments"]))
    check("no department reports negative pay",
          all((x["actualAmount"] or 0) >= 0 for x in d["departments"]))
    check("each department's budget splits into positions and non-positions",
          all(close((x["budgetPositionAmount"] or 0)
                    + (x["budgetNonPositionAmount"] or 0),
                    x["budgetAmount"] or 0, 0.02)
              for x in d["departments"] if x["budgetAmount"] is not None))
    check("the split totals reconcile to the budget total",
          close(d["budget"]["positionAmount"] + d["budget"]["nonPositionAmount"],
                d["budget"]["amount"], 1.0),
          "$%s + $%s vs $%s" % (
              format(d["budget"]["positionAmount"], ",.0f"),
              format(d["budget"]["nonPositionAmount"], ",.0f"),
              format(d["budget"]["amount"], ",.0f")))

    # ---- page copy --------------------------------------------------------
    print("\nPage copy that states figures as static text")
    html = io.open(LAB_INDEX, encoding="utf-8").read()
    check("lab/index.html links to Project 3", "budget-actual" in html)
    stated = re.findall(r"data-ba-figure=\"([a-z0-9]+)\">([^<]+)<", html)
    check("lab/index.html carries its stated figures",
          len(stated) == len(REQUIRED_FIGURES["lab/index.html"]),
          "found %d, expected %d" % (len(stated),
                                     len(REQUIRED_FIGURES["lab/index.html"])))
    want = {"bamatch": str(d["join"]["matchRate"])}
    for key, shown in stated:
        if key not in want:
            check("lab/index.html states an unknown figure %r" % key, False)
            continue
        check("lab/index.html figure '%s'" % key,
              shown.strip().replace("%", "") == want[key],
              "page says %r, data says %r" % (shown.strip(), want[key]))
    for key in REQUIRED_FIGURES["lab/index.html"]:
        check("lab/index.html still states the '%s' figure" % key,
              any(k == key for k, _ in stated),
              "present" if any(k == key for k, _ in stated) else "MISSING")

    print("\n" + ("All checks passed." if not failures
                  else "%d FAILED: %s" % (len(failures), "; ".join(failures))))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
