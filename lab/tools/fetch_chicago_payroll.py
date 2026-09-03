"""Build the Lab's Project 2 dataset from the City of Chicago payroll portal.

Project 1 decodes a corpus we wrote ourselves, which makes it a demonstration
of technique and nothing more: a synthetic file cannot be checked against
anything. This one runs the same lifecycle over data the City publishes, so a
visitor can re-issue our queries and either land on our numbers or catch us
out. That is the whole point, so the rules here are mechanical and stated
rather than tuned until a chart looks good.

What ships and what does not
----------------------------
The source carries an ``employee`` name column. We never select it. The
analysis needs a stable key to count people, and ``employee_dataset_id``
supplies one with no name attached, so that is what we group by; the key is
never written to the output either. Traceability rows cite ``record_id``, which
lets anyone pull the original record from the City. That leaves the decision to
publish a person's name where it already sits, with the City, rather than
copying it onto a marketing site.

Run:  py lab/tools/fetch_chicago_payroll.py
Then: py lab/tools/verify_chicago_payroll.py
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
DATASET = "dawh-m56b"
API = "https://" + DOMAIN + "/resource/" + DATASET + ".json"
LANDING = "https://" + DOMAIN + "/d/" + DATASET

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "data"))
CACHE = os.path.join(HERE, ".cache")

# The most recent complete payroll year. 2026 exists in the source but is
# partial, which the Land stage reports rather than quietly dropping.
FOCUS_YEAR = "2025"

# --------------------------------------------------------------------------
# Overtime classification
#
# There is no overtime column. There are 127 pay elements, and deciding which
# of them count as overtime is a judgement, not a lookup. Three defensible
# rules are computed and all three are published, so the page can show that the
# answer moves with the rule instead of asserting one number.
# --------------------------------------------------------------------------

RE_OT_STRICT = re.compile(r"^(OT[ _]|OVERTIME\b)|^CANINE OVERTIME$")
RE_OT_NAMED_EXTRA = re.compile(r"SPRVSR QRT OT$|^SUPERVISORS QUARTERLY OT$|^DEC OT ")
# Elements whose name encodes a premium multiplier of 1.5x or more. These are
# paid at overtime-like rates without being labelled overtime.
RE_PREMIUM = re.compile(r"RATE (1_5|2_0|2_5)$|^HOLIDAY PREMIUM|DIFF (1_5|2_0)$")


def ot_class(element):
    e = (element or "").strip().upper()
    if RE_OT_STRICT.search(e):
        return "strict"
    if RE_OT_NAMED_EXTRA.search(e):
        return "named"
    if RE_PREMIUM.search(e):
        return "premium"
    return "other"


def in_rule(cls, rule):
    if rule == "strict":
        return cls == "strict"
    if rule == "named":
        return cls in ("strict", "named")
    return cls in ("strict", "named", "premium")     # broad


# --------------------------------------------------------------------------
# Portal access
# --------------------------------------------------------------------------

QUERIES = []


def _get(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "canyonland-lab/1.0 (+https://www.canyonlandtech.com)",
    })
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def soql(label, params, cache_key=None, publish=True):
    """Issue one SoQL query, remembering it so the page can publish it."""
    url = API + "?" + urllib.parse.urlencode(params)
    if publish:
        QUERIES.append({"label": label, "params": dict(params)})
    key = cache_key or re.sub(r"[^a-z0-9]+", "-", label.lower())[:60]
    path = os.path.join(CACHE, key + ".json")
    if os.path.exists(path):
        return json.load(io.open(path, encoding="utf-8"))
    os.makedirs(CACHE, exist_ok=True)
    for attempt in range(4):
        try:
            data = _get(url)
            break
        except Exception as exc:                      # pragma: no cover - network
            if attempt == 3:
                raise
            print("    retry %d after %s" % (attempt + 1, exc), file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    io.open(path, "w", encoding="utf-8").write(json.dumps(data))
    return data


def paged(label, params, page=40000):
    """Same, for group-by results larger than one response."""
    out, offset = [], 0
    base = re.sub(r"[^a-z0-9]+", "-", label.lower())[:50]
    while True:
        p = dict(params)
        p["$limit"] = str(page)
        p["$offset"] = str(offset)
        chunk = soql(label, p, cache_key=base + "-" + str(offset),
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


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    return round(s[min(len(s) - 1, int(p * len(s)))], 2)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def main():
    os.makedirs(OUT, exist_ok=True)
    print("Source: " + LANDING)

    meta = _get("https://" + DOMAIN + "/api/views/" + DATASET + ".json")
    updated = datetime.fromtimestamp(
        meta["rowsUpdatedAt"], timezone.utc).date().isoformat()
    print("  dataset last updated at source: " + updated)

    # ---- Land: coverage by year and period ------------------------------
    print("  querying coverage by year and period ...")
    per = soql("Rows, dollars and employees per payroll year and period", {
        "$select": "payroll_year,payroll_period,count(record_id) as n,"
                   "sum(amount) as amt,count(distinct employee_dataset_id) as emps",
        "$group": "payroll_year,payroll_period",
        "$order": "payroll_year,payroll_period",
        "$limit": "5000",
    })
    by_period = [{
        "year": r["payroll_year"], "period": int(num(r["payroll_period"])),
        "rows": int(num(r["n"])), "amount": money(r["amt"]),
        "employees": int(num(r["emps"])),
    } for r in per]

    years = {}
    for r in by_period:
        y = years.setdefault(r["year"], {"year": r["year"], "periods": 0,
                                         "rows": 0, "amount": 0.0,
                                         "employees": 0})
        y["periods"] += 1
        y["rows"] += r["rows"]
        y["amount"] = round(y["amount"] + r["amount"], 2)
    for r in soql("Distinct employees per payroll year", {
            "$select": "payroll_year,count(distinct employee_dataset_id) as emps",
            "$group": "payroll_year", "$order": "payroll_year"}):
        if r["payroll_year"] in years:
            years[r["payroll_year"]]["employees"] = int(num(r["emps"]))
    by_year = [years[k] for k in sorted(years)]
    full = max(y["periods"] for y in by_year)
    for y in by_year:
        y["complete"] = y["periods"] == full

    # ---- Model: the pay elements ----------------------------------------
    print("  querying pay elements ...")
    el = soql("Every pay element with its row count and total", {
        "$select": "pay_element,count(record_id) as n,sum(amount) as amt",
        "$group": "pay_element", "$order": "amt DESC", "$limit": "500"})
    elements = [{
        "element": r["pay_element"], "rows": int(num(r["n"])),
        "amount": money(r["amt"]), "class": ot_class(r["pay_element"]),
    } for r in el]
    negatives = [e for e in elements if e["amount"] < 0]

    ot_totals = {}
    for rule in ("strict", "named", "broad"):
        ot_totals[rule] = round(
            sum(e["amount"] for e in elements if in_rule(e["class"], rule)), 2)

    # ---- Build: departments ---------------------------------------------
    print("  querying departments for " + FOCUS_YEAR + " ...")
    dept_rows = soql("Department totals by pay element, " + FOCUS_YEAR, {
        "$select": "department,pay_element,sum(amount) as amt",
        "$where": "payroll_year='" + FOCUS_YEAR + "'",
        "$group": "department,pay_element", "$limit": "50000"})
    depts = {}
    for r in dept_rows:
        d = depts.setdefault(r["department"], {
            "department": r["department"], "total": 0.0,
            "ot": {"strict": 0.0, "named": 0.0, "broad": 0.0}, "employees": 0})
        amt = money(r["amt"])
        d["total"] = round(d["total"] + amt, 2)
        cls = ot_class(r["pay_element"])
        for rule in ("strict", "named", "broad"):
            if in_rule(cls, rule):
                d["ot"][rule] = round(d["ot"][rule] + amt, 2)
    for r in soql("Distinct employees per department, " + FOCUS_YEAR, {
            "$select": "department,count(distinct employee_dataset_id) as emps",
            "$where": "payroll_year='" + FOCUS_YEAR + "'",
            "$group": "department", "$limit": "500"}):
        if r["department"] in depts:
            depts[r["department"]]["employees"] = int(num(r["emps"]))
    departments = sorted(depts.values(), key=lambda d: -d["ot"]["named"])
    for d in departments:
        d["otShare"] = (round(d["ot"]["named"] / d["total"] * 100, 2)
                        if d["total"] else 0.0)

    # ---- Build: how concentrated is overtime? ----------------------------
    print("  querying per-employee overtime for " + FOCUS_YEAR + " ...")
    named_els = [e["element"] for e in elements if in_rule(e["class"], "named")]
    quoted = ",".join("'" + e.replace("'", "''") + "'" for e in named_els)
    emp_ot = paged("Overtime per employee, " + FOCUS_YEAR, {
        "$select": "employee_dataset_id,sum(amount) as ot",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND pay_element IN(" + quoted + ")",
        "$group": "employee_dataset_id", "$order": "employee_dataset_id"})
    all_ot = sorted([money(r["ot"]) for r in emp_ot], reverse=True)
    # A handful of employees net to zero or below across the year, because a
    # reversal in one period cancels overtime paid in another. They are real
    # records, they are not overtime earners, and dropping them silently would
    # leave the page's total unable to reconcile against the source. Counted,
    # so the verifier can check an identity instead of a tolerance.
    ot_values = [v for v in all_ot if v > 0]
    non_positive = [v for v in all_ot if v <= 0]
    total_ot = round(sum(ot_values), 2)
    n_ot = len(ot_values)

    def top_share(frac):
        k = max(1, int(round(n_ot * frac)))
        return {"employees": k,
                "share": round(sum(ot_values[:k]) / total_ot * 100, 2)
                if total_ot else 0.0}

    concentration = {
        "earners": n_ot,
        "total": total_ot,
        "top1": top_share(0.01),
        "top5": top_share(0.05),
        "top10": top_share(0.10),
        "median": ot_values[n_ot // 2] if n_ot else 0.0,
        "max": ot_values[0] if n_ot else 0.0,
        "over50k": sum(1 for v in ot_values if v >= 50000),
        "over100k": sum(1 for v in ot_values if v >= 100000),
        "nonPositive": {"employees": len(non_positive),
                        "amount": round(sum(non_positive), 2)},
        "deciles": ([round(sum(ot_values[int(n_ot * i / 10):
                                         int(n_ot * (i + 1) / 10)])
                           / total_ot * 100, 2) for i in range(10)]
                    if total_ot else []),
    }

    # ---- Build: pay variation inside a job classification -----------------
    #
    # Taken naively this measures the wrong thing. Summing a year of pay per
    # employee mixes someone who worked all 24 periods with someone who held
    # the title for one, and the second is not a low-paid captain -- they are a
    # partial record. The naive ranking is computed anyway, because the gap
    # between it and the corrected one is the most useful thing on the page:
    # it is what "the number looked wrong so we checked" actually looks like.
    print("  querying per-employee pay by title for " + FOCUS_YEAR + " ...")
    periods_in_year = max(p["period"] for p in by_period
                          if p["year"] == FOCUS_YEAR)
    FULL_YEAR_MIN = int(round(periods_in_year * 5 / 6.0))   # 20 of 24

    title_rows = paged("Pay and periods present per employee per title, " + FOCUS_YEAR, {
        "$select": "title,employee_dataset_id,sum(amount) as amt,"
                   "count(distinct payroll_period) as periods",
        "$where": "payroll_year='" + FOCUS_YEAR + "'",
        "$group": "title,employee_dataset_id", "$order": "title,employee_dataset_id"})
    all_by_title, full_by_title = {}, {}
    for r in title_rows:
        amt = money(r["amt"])
        all_by_title.setdefault(r["title"], []).append(amt)
        if int(num(r["periods"])) >= FULL_YEAR_MIN:
            full_by_title.setdefault(r["title"], []).append(amt)

    def title_stats(source, min_n=50):
        out = []
        for t, vals in source.items():
            if len(vals) < min_n:      # small cohorts make unstable spreads
                continue
            p10, p50, p90 = pct(vals, 0.10), pct(vals, 0.50), pct(vals, 0.90)
            out.append({"title": t, "employees": len(vals), "p10": p10,
                        "median": p50, "p90": p90,
                        "ratio": round(p90 / p10, 2) if p10 > 0 else None})
        return out

    naive = title_stats(all_by_title)
    full = title_stats(full_by_title)
    full_index = {t["title"]: t for t in full}

    title_naive = sorted([t for t in naive if t["ratio"]],
                         key=lambda t: -t["ratio"])[:15]
    title_spread = sorted([t for t in full if t["ratio"]],
                          key=lambda t: -t["ratio"])[:25]
    title_largest = sorted(full, key=lambda t: -t["employees"])[:25]

    # The side-by-side the page leads with: the titles the naive ranking calls
    # most unequal, next to what they look like once part-year records are out.
    correction = []
    for t in title_naive[:8]:
        f = full_index.get(t["title"])
        correction.append({
            "title": t["title"],
            "naive": {"employees": t["employees"], "p10": t["p10"],
                      "median": t["median"], "p90": t["p90"], "ratio": t["ratio"]},
            "fullYear": ({"employees": f["employees"], "p10": f["p10"],
                          "median": f["median"], "p90": f["p90"],
                          "ratio": f["ratio"]} if f else None),
        })

    # ---- Extract: real source rows, minus the name column ------------------
    print("  fetching sample source rows ...")
    sample = soql("Twelve source rows; the name column is not selected", {
        "$select": "record_id,payroll_year,payroll_period,department,title,"
                   "pay_element,fund_type,amount",
        "$where": "payroll_year='" + FOCUS_YEAR + "' AND pay_element='OT 1_5' "
                  "AND amount > 400 AND payroll_period='12'",
        "$order": "record_id", "$limit": "12"})
    sample_rows = []
    for r in sample:
        row = dict(r)
        row["amount"] = money(row.get("amount"))
        sample_rows.append(row)

    fields = [{"name": c["fieldName"], "type": c["dataTypeName"],
               "label": c["name"], "used": c["fieldName"] != "employee"}
              for c in meta["columns"] if not c["fieldName"].startswith(":")]

    # ---- What the data does not tell you unless you look ------------------
    #
    # Four things that would each produce a confident, wrong chart. They are
    # computed here rather than written down, so that regenerating against a
    # refreshed source either keeps them true or fails the verifier.
    partial = [y for y in by_year if not y["complete"]]
    neg_rows = sum(n["rows"] for n in negatives)
    neg_amount = round(sum(n["amount"] for n in negatives), 2)
    focus = next(y for y in by_year if y["year"] == FOCUS_YEAR)
    # The headline case is the worst naive ratio that a full-year cohort can
    # actually be compared against. Titles whose full-year cohort is too
    # small to report are a finding in their own right, not a headline.
    worst = next((c for c in correction if c["fullYear"]), None)
    unreportable = [c["title"] for c in correction if not c["fullYear"]]

    findings = []
    if partial:
        pa = partial[0]
        run_rate = round(pa["amount"] / pa["periods"] * periods_in_year, 2)
        findings.append({
            "id": "partial-year",
            "title": "The most recent year is a fifth of a year",
            "numbers": {"year": pa["year"], "periods": pa["periods"],
                        "of": periods_in_year, "reported": pa["amount"],
                        "runRate": run_rate,
                        "understatement": round(run_rate - pa["amount"], 2)},
            "check": "Count distinct payroll_period within each payroll_year.",
        })
    findings.append({
        "id": "negative-amounts",
        "title": "Some pay elements are negative",
        "numbers": {"elements": len(negatives), "rows": neg_rows,
                    "amount": neg_amount,
                    "largest": negatives[-1]["element"] if negatives else None},
        "check": "Group by pay_element and look for sum(amount) below zero.",
    })
    findings.append({
        "id": "overtime-definition",
        "title": "There is no overtime column, and the answer moves with the rule",
        "numbers": {"strict": ot_totals["strict"], "named": ot_totals["named"],
                    "broad": ot_totals["broad"],
                    "spread": round(ot_totals["broad"] - ot_totals["strict"], 2),
                    "spreadPct": round((ot_totals["broad"] - ot_totals["strict"])
                                       / ot_totals["strict"] * 100, 1),
                    "strictElements": len([e for e in elements
                                           if e["class"] == "strict"]),
                    "premiumElements": len([e for e in elements
                                            if e["class"] == "premium"])},
        "check": "Group by pay_element; classify by name; total each rule.",
    })
    if worst and worst["fullYear"]:
        findings.append({
            "id": "part-year-records",
            "title": "The widest pay gaps are part-year records, not pay gaps",
            "numbers": {"title": worst["title"],
                        "naiveRatio": worst["naive"]["ratio"],
                        "naiveP10": worst["naive"]["p10"],
                        "naiveN": worst["naive"]["employees"],
                        "fullRatio": worst["fullYear"]["ratio"],
                        "fullP10": worst["fullYear"]["p10"],
                        "fullN": worst["fullYear"]["employees"],
                        "minPeriods": FULL_YEAR_MIN, "of": periods_in_year,
                        "unreportable": len(unreportable),
                        "unreportableExample": unreportable[0] if unreportable else None},
            "check": ("Count distinct payroll_period per employee per title, "
                      "then re-rank using only the full-year cohort."),
        })

    payload = {
        "source": {
            "publisher": "City of Chicago",
            "dataset": meta["name"],
            "datasetId": DATASET,
            "landing": LANDING,
            "api": API,
            "portal": "https://" + DOMAIN,
            "owner": "Budget & Management",
            "license": (meta.get("license") or {}).get("name") or "See Terms of Use",
            "licenseUrl": "https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html",
            "attribution": meta.get("attribution") or "City of Chicago",
            "sourceUpdated": updated,
            "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "rowsInSource": sum(y["rows"] for y in by_year),
            "grain": (meta.get("metadata") or {}).get("rowLabel") or "",
            "refresh": "Typically four times a year, every six pay periods.",
            "mode": "Cached snapshot. Nothing on this page calls the portal at run time.",
        },
        "queries": QUERIES,
        "rules": {
            "focusYear": FOCUS_YEAR,
            "otStrict": sorted(e["element"] for e in elements
                               if e["class"] == "strict"),
            "otNamed": sorted(e["element"] for e in elements
                              if e["class"] == "named"),
            "otPremium": sorted(e["element"] for e in elements
                                if e["class"] == "premium"),
            "otTotals": ot_totals,
            "fullYearRule": ("An employee counts toward a job classification's pay "
                             "spread only if they appear in at least {} of the {} "
                             "pay periods in {}.").format(
                                 FULL_YEAR_MIN, periods_in_year, FOCUS_YEAR),
        },
        "land": {"byYear": by_year, "byPeriod": by_period, "negatives": negatives},
        "model": {"elements": elements, "departments": departments, "fields": fields},
        "build": {"concentration": concentration, "titleSpread": title_spread,
                  "titleLargest": title_largest, "titleNaive": title_naive,
                  "titleCorrection": correction,
                  "fullYearMin": FULL_YEAR_MIN,
                  "periodsInYear": periods_in_year},
        "extract": {"sampleRows": sample_rows},
        "findings": findings,
    }

    # The browser checks these on load, so a rebuilt dataset that no longer
    # matches the page reports a mismatch instead of drawing a wrong chart.
    payload["expected"] = {
        "years": len(by_year),
        "completeYears": sum(1 for y in by_year if y["complete"]),
        "partialYears": sum(1 for y in by_year if not y["complete"]),
        "elements": len(elements),
        "negativeElements": len(negatives),
        "departments": len(departments),
        "otRuleSpread": round(ot_totals["broad"] - ot_totals["strict"], 2),
        "otEarners": concentration["earners"],
        "top10Share": concentration["top10"]["share"],
        "findings": len(findings),
        "focusYearAmount": focus["amount"],
        "negativeRows": neg_rows,
    }

    path = os.path.join(OUT, "chicago-payroll.json")
    io.open(path, "w", encoding="utf-8").write(
        json.dumps(payload, separators=(",", ":")))
    size = os.path.getsize(path)
    print("")
    print("  wrote %s  (%.1f KB)" % (path, size / 1024.0))
    print("  %d payroll years, %d pay elements, %d departments"
          % (len(by_year), len(elements), len(departments)))
    print("  overtime by rule: strict ${:,.0f} / named ${:,.0f} / broad ${:,.0f}"
          .format(ot_totals["strict"], ot_totals["named"], ot_totals["broad"]))
    print("  {:,} employees took overtime in {}; the top 10 pct of them took {} pct"
          .format(concentration["earners"], FOCUS_YEAR,
                  concentration["top10"]["share"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
