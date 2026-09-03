"""Check the published Chicago snapshot against the City's API, independently.

The fetcher asserts things about its own output. Those assertions are worth
nothing on their own, so this re-derives every headline figure by issuing its
own queries, written differently, and classifying pay elements with rules
written out by hand rather than by regular expression. Agreement between two
implementations that share code is not evidence; these deliberately share none.

It also reads the figures out of the two pages that talk about this dataset, so
marketing copy cannot quietly drift away from the data it describes. That check
exists because the same failure has happened on this site before.

Needs network access. Run it before shipping any change to the snapshot, the
page copy, or the fetcher.

Run:  py lab/tools/verify_chicago_payroll.py
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

DOMAIN = "data.cityofchicago.org"
DATASET = "dawh-m56b"
API = "https://" + DOMAIN + "/resource/" + DATASET + ".json"

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.abspath(os.path.join(HERE, "..", "data", "chicago-payroll.json"))
LAB_PAGE = os.path.abspath(os.path.join(HERE, "..", "public-payroll.html"))
LAB_INDEX = os.path.abspath(os.path.join(HERE, "..", "index.html"))
HOME = os.path.abspath(os.path.join(HERE, "..", "..", "index.html"))

# Hand-written membership, not a pattern. If the fetcher's regular expression
# ever drifts, these lists do not drift with it.
OT_STRICT_EXPECTED = {
    "OT 1_0", "OT 1_5", "OT 2_0", "OT 2_5", "OT 1_5 REIMB", "OT 2_0 REIMB",
    "OT 2_5 REIMB", "OVERTIME 0_5", "CANINE OVERTIME", "OT FLSA",
}
OT_NAMED_EXTRA_EXPECTED = {
    "SUPERVISORS QUARTERLY OT", "DEC SPRVSR QRT OT", "DEC OT FLSA",
}

# What each page is required to state as static text. Anything a page shows
# from this dataset without recomputing it belongs here, or it can drift.
REQUIRED_FIGURES = {
    "lab/index.html": ("rows", "naive", "full"),
    "index.html": ("rows",),
}

failures: list[str] = []


def check(label, ok, detail=""):
    print("  %s  %s%s" % ("PASS" if ok else "FAIL", label,
                          ("  " + detail) if detail else ""))
    if not ok:
        failures.append(label)


def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "canyonland-lab-verify/1.0",
    })
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def money(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def close(a, b, tol=1.0):
    return abs(float(a) - float(b)) <= tol


def figures_in(path, marker_class):
    """Pull the numbers a page states as static text inside a marked block."""
    html = io.open(path, encoding="utf-8").read()
    block = re.search(marker_class + r'">(.*?)</div>\s*\n\s*</div>', html, re.S)
    if not block:
        return None
    return re.findall(r"<strong>([\d,]+)</strong>", block.group(1))


def main():
    if not os.path.exists(SNAPSHOT):
        print("No snapshot at " + SNAPSHOT + "; run fetch_chicago_payroll.py first.")
        return 1
    d = json.load(io.open(SNAPSHOT, encoding="utf-8"))
    focus = d["rules"]["focusYear"]

    print("Snapshot")
    print("  retrieved   " + d["source"]["retrieved"])
    print("  source      " + d["source"]["landing"])

    # ---- privacy, checked rather than trusted ----------------------------
    print("\nWhat the snapshot must not contain")
    # The schema listing names the column deliberately, to show it was withheld.
    # What must not appear anywhere is a row carrying it, so the data sections
    # are checked rather than the whole blob.
    data_only = json.dumps([d["extract"], d["build"], d["land"],
                            d["model"]["departments"], d["model"]["elements"]])
    check("no data section carries an employee key",
          '"employee"' not in data_only)
    check("no sample row carries a name",
          all("employee" not in r for r in d["extract"]["sampleRows"]))
    check("no employee_dataset_id values were published",
          "employee_dataset_id" not in data_only)
    check("the schema records the name column as withheld",
          any(f["name"] == "employee" and not f["used"] for f in d["model"]["fields"]))

    # ---- coverage, re-queried by year only -------------------------------
    print("\nCoverage, re-queried without going through periods")
    rows = get({"$select": "payroll_year,count(record_id) as n,sum(amount) as amt,"
                           "count(distinct payroll_period) as periods",
                "$group": "payroll_year", "$order": "payroll_year"})
    live = {r["payroll_year"]: r for r in rows}
    for y in d["land"]["byYear"]:
        r = live.get(y["year"])
        if not r:
            check("payroll year %s still exists at source" % y["year"], False)
            continue
        check("year %s row count" % y["year"], int(float(r["n"])) == y["rows"],
              "%s at source" % format(int(float(r["n"])), ","))
        check("year %s total" % y["year"], close(money(r["amt"]), y["amount"], 0.5),
              "source ${:,.2f}".format(money(r["amt"])))
        check("year %s period count" % y["year"],
              int(float(r["periods"])) == y["periods"])

    completeness = [y for y in d["land"]["byYear"] if not y["complete"]]
    check("at least one year is marked partial", len(completeness) > 0,
          "%d partial" % len(completeness))
    # A partial year must be visible as a finding, not silently dropped: the
    # page shows it and labels it, and that is what is checked here.
    partial_ids = [f for f in d["findings"] if f["id"] == "partial-year"]
    check("the partial year is reported as a finding", len(partial_ids) == 1)
    if partial_ids:
        n = partial_ids[0]["numbers"]
        check("the partial year's run rate exceeds what it reports",
              n["runRate"] > n["reported"],
              "reports ${:,.0f} against a run rate of ${:,.0f}".format(
                  n["reported"], n["runRate"]))

    # ---- overtime classification, from an independent list ---------------
    print("\nOvertime classification, against a hand-written element list")
    strict = set(d["rules"]["otStrict"])
    named_extra = set(d["rules"]["otNamed"]) - strict
    check("strict rule matches the hand-written list",
          strict == OT_STRICT_EXPECTED,
          "unexpected: %s; missing: %s" % (sorted(strict - OT_STRICT_EXPECTED),
                                           sorted(OT_STRICT_EXPECTED - strict)))
    check("named rule adds exactly the supervisor and posthumous OT elements",
          named_extra == OT_NAMED_EXTRA_EXPECTED,
          "%s" % sorted(named_extra))
    check("premium elements are disjoint from named overtime",
          not (set(d["rules"]["otPremium"]) & set(d["rules"]["otNamed"])))

    print("\nOvertime totals, re-queried per rule")
    for rule, elements in (("strict", sorted(OT_STRICT_EXPECTED)),
                           ("named", sorted(OT_STRICT_EXPECTED | OT_NAMED_EXTRA_EXPECTED))):
        quoted = ",".join("'" + e + "'" for e in elements)
        r = get({"$select": "sum(amount) as amt",
                 "$where": "pay_element IN(" + quoted + ")"})
        got = money(r[0]["amt"])
        want = d["rules"]["otTotals"][rule]
        check("%s rule total" % rule, close(got, want, 1.0),
              "source $%.2f vs snapshot $%.2f" % (got, want))

    # ---- the four findings ------------------------------------------------
    print("\nThe findings this page makes")
    ids = [f["id"] for f in d["findings"]]
    check("all four findings are present", len(ids) == 4, str(ids))

    neg = get({"$select": "pay_element,sum(amount) as amt,count(record_id) as n",
               "$group": "pay_element", "$having": "sum(amount) < 0",
               "$limit": "100"})
    check("negative pay elements still number what the page says",
          len(neg) == len(d["land"]["negatives"]),
          "%d at source, %d in snapshot" % (len(neg), len(d["land"]["negatives"])))
    check("negative total matches",
          close(sum(money(r["amt"]) for r in neg),
                sum(n["amount"] for n in d["land"]["negatives"]), 1.0))

    pyr = [f for f in d["findings"] if f["id"] == "part-year-records"]
    if pyr:
        n = pyr[0]["numbers"]
        check("the part-year correction actually shrinks the spread",
              n["fullRatio"] < n["naiveRatio"] / 10,
              "x%s -> x%s" % (n["naiveRatio"], n["fullRatio"]))
        check("the corrected 10th percentile is a plausible full-year figure",
              n["fullP10"] > 20000, "$%.0f" % n["fullP10"])
        check("the naive 10th percentile is implausible, which is the point",
              n["naiveP10"] < 20000, "$%.0f" % n["naiveP10"])

    # ---- concentration, recomputed from the source ------------------------
    print("\nOvertime concentration, recomputed for " + focus)
    named = sorted(OT_STRICT_EXPECTED | OT_NAMED_EXTRA_EXPECTED)
    quoted = ",".join("'" + e + "'" for e in named)
    agg = get({"$select": "sum(amount) as amt,count(distinct employee_dataset_id) as emps",
               "$where": "payroll_year='" + focus + "' AND pay_element IN(" + quoted + ")"})
    c = d["build"]["concentration"]
    src_total = money(agg[0]["amt"])
    # An identity, not a tolerance: what the page reports plus what it excluded
    # must equal what the City reports. A tolerance here would have quietly
    # absorbed the excluded employees instead of accounting for them.
    excluded = c.get("nonPositive", {}).get("amount", 0.0)
    check("focus-year overtime reconciles exactly to the source",
          close(c["total"] + excluded, src_total, 1.0),
          "source ${:,.2f} = reported ${:,.2f} + excluded ${:,.2f}".format(
              src_total, c["total"], excluded))
    check("the excluded employees are the ones netting zero or below",
          c.get("nonPositive", {}).get("employees", 0) ==
          int(float(agg[0]["emps"])) - c["earners"],
          "{} excluded, {} unaccounted".format(
              c.get("nonPositive", {}).get("employees", 0),
              int(float(agg[0]["emps"])) - c["earners"]))
    check("employees with overtime is no more than employees with an overtime row",
          c["earners"] <= int(float(agg[0]["emps"])),
          "%s counted, %s have rows" % (c["earners"], int(float(agg[0]["emps"]))))
    check("decile shares sum to 100", close(sum(c["deciles"]), 100.0, 0.25),
          "%.2f" % sum(c["deciles"]))
    check("the top decile takes the largest share",
          c["deciles"][0] == max(c["deciles"]))

    # ---- internal consistency --------------------------------------------
    print("\nInternal consistency")
    e = d["expected"]
    check("expected block matches the payload it describes",
          e["elements"] == len(d["model"]["elements"])
          and e["departments"] == len(d["model"]["departments"])
          and e["findings"] == len(d["findings"]))
    check("the overtime rule spread is what the summary strip claims",
          close(e["otRuleSpread"],
                d["rules"]["otTotals"]["broad"] - d["rules"]["otTotals"]["strict"], 0.01))
    check("every department's overtime is at most its total pay",
          all(x["ot"]["named"] <= x["total"] + 0.01 for x in d["model"]["departments"]))
    check("every full-year spread is smaller than its naive counterpart",
          all(x["fullYear"]["ratio"] <= x["naive"]["ratio"]
              for x in d["build"]["titleCorrection"] if x["fullYear"]))

    # ---- page copy --------------------------------------------------------
    print("\nPage copy that states figures as static text")
    # The Lab page computes everything at run time, so there is nothing to drift
    # there. The index and homepage teasers do not, so they are checked.
    for path, label in ((LAB_INDEX, "lab/index.html"), (HOME, "index.html")):
        # A page that stops carrying its figures must fail, not skip.
        html = io.open(path, encoding="utf-8").read()
        if "public-payroll" not in html:
            check(label + " links to Project 2", False, "no link found")
            continue
        check(label + " links to Project 2", True)
        stated = re.findall(r"data-pp-figure=\"([a-z0-9]+)\">([^<]+)<", html)
        check("%s carries its stated figures" % label,
              len(stated) == len(REQUIRED_FIGURES[label]),
              "found %d, expected %d" % (len(stated), len(REQUIRED_FIGURES[label])))
        pyr = [f for f in d["findings"]
               if f["id"] == "part-year-records"][0]["numbers"]
        want = {
            "rows": format(d["source"]["rowsInSource"], ","),
            "naive": str(pyr["naiveRatio"]),
            "full": str(pyr["fullRatio"]),
        }
        # Exact string equality after stripping thousands separators. A figure
        # stated on a marketing page is either the number in the data or it is
        # wrong; there is no 'close enough'.
        for key, shown in stated:
            if key not in want:
                check("%s states an unknown figure %r" % (label, key), False)
                continue
            check("%s figure '%s'" % (label, key),
                  shown.strip().replace(",", "") == want[key].replace(",", ""),
                  "page says %r, data says %r" % (shown.strip(), want[key]))
        # Each page owes a specific set of figures. Passing because a figure was
        # optional is how a check quietly stops checking anything.
        for key in REQUIRED_FIGURES[label]:
            check("%s still states the '%s' figure" % (label, key),
                  any(k == key for k, _ in stated),
                  "present" if any(k == key for k, _ in stated) else "MISSING")

    print("\n" + ("All checks passed." if not failures
                  else "%d FAILED: %s" % (len(failures), "; ".join(failures))))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
