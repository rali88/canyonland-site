"""Decode the generated corpus back and check it says what it claims to say.

The generator asserts things about its own output — four exclusion causes, two
contributions taken past the cap. Those claims are worth exactly nothing unless
something reads the bytes back independently and agrees, so this decodes from
base64 with no access to the generator's in-memory structures.

It is also the reference the browser decoder gets checked against, the same way
the estatemap JavaScript port is checked against the Python tool.

Run:  python lab/tools/verify_corpus.py
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.abspath(os.path.join(HERE, "..", "data", "payroll-corpus.json"))

EMP_LEN, TRAN_LEN = 80, 40

# Offsets are derived from the copybooks, not from the writer, so a layout
# change that the copybook does not describe shows up here as a failure.
EMP = {
    "id": (0, 9, "X"), "last": (9, 20, "X"), "first": (29, 15, "X"),
    "dept": (44, 4, "X"), "status": (48, 1, "X"), "flsa": (49, 1, "X"),
    "hired": (50, 8, "9"), "termed": (58, 8, "9"),
    "rate": (66, 4, "P2"), "tier": (70, 1, "X"),
    "ytdPens": (71, 5, "P2"), "ytdTier2": (76, 4, "P2"),
}
TRAN = {
    "emp": (0, 9, "X"), "period": (9, 8, "9"), "paycode": (17, 4, "X"),
    "hours": (21, 3, "P2"), "mult": (24, 3, "P3"), "amount": (27, 5, "P2"),
    "onVoucher": (32, 1, "X"), "reason": (33, 2, "X"),
}


def ebcdic(b: bytes) -> str:
    return b.decode("cp037")


def unpack(b: bytes) -> int:
    """COMP-3 back to a scaled integer.

    Each byte holds two nibbles; the final low nibble is the sign, not a digit.
    Formatting nibbles as decimal rather than hex turns that sign into the
    digits "12" and silently shifts every value — a mistake worth naming,
    because the result still looks like a plausible number.
    """
    nibbles = "".join(f"{x >> 4:x}{x & 0xF:x}" for x in b)
    digits, sign = nibbles[:-1], nibbles[-1].lower()
    if any(c not in "0123456789" for c in digits):
        raise ValueError(f"non-digit nibble in packed field: {b.hex(' ')}")
    value = int(digits or "0")
    return -value if sign in ("d", "b") else value


def field(rec: bytes, spec: tuple):
    off, ln, kind = spec
    raw = rec[off:off + ln]
    if kind == "X":
        return ebcdic(raw)
    if kind == "9":
        return int(ebcdic(raw))
    if kind.startswith("P"):
        return unpack(raw) / (10 ** int(kind[1]))
    raise ValueError(kind)


def decode(blob: bytes, length: int, layout: dict) -> list[dict]:
    if len(blob) % length:
        raise ValueError(f"{len(blob)} bytes is not a multiple of {length}")
    out = []
    for i in range(0, len(blob), length):
        rec = blob[i:i + length]
        out.append({k: field(rec, spec) for k, spec in layout.items()})
    return out


def main() -> int:
    d = json.load(io.open(CORPUS, encoding="utf-8"))
    employees = decode(base64.b64decode(d["records"]["employeeB64"]), EMP_LEN, EMP)
    trans = decode(base64.b64decode(d["records"]["transactionB64"]), TRAN_LEN, TRAN)

    cap = d["params"]["tier2EarningsCapCents"] / 100
    rate = d["params"]["tier2Rate"]
    expected_max = round(cap * rate, 2)

    failures = []

    def check(label, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
        if not ok:
            failures.append(label)

    print("Structure")
    check("record counts match the manifest",
          len(employees) == d["records"]["employeeCount"]
          and len(trans) == d["records"]["transactionCount"],
          f"{len(employees)} employees, {len(trans)} transactions")
    check("pay rates are plausible hourly figures",
          all(15 <= e["rate"] <= 120 for e in employees),
          f"min {min(e['rate'] for e in employees):.2f}, "
          f"max {max(e['rate'] for e in employees):.2f}")
    check("every termination date is a real date or the 99999999 sentinel",
          all(e["termed"] == 99999999 or 19000000 < e["termed"] < 21000000
              for e in employees))

    print("\nQuestion: why are some paycode rows missing from the voucher?")
    excluded = [t for t in trans if t["onVoucher"] == "N"]
    reasons = sorted({t["reason"] for t in excluded})
    documented = set(d["reference"]["exclusionReasons"])
    check("more than one cause is present", len(reasons) > 1, f"{reasons}")
    check("all four documented causes occur",
          set(reasons) == documented, f"{len(excluded)} excluded rows")
    check("every excluded row carries a reason",
          all(t["reason"].strip() for t in excluded))
    check("no included row carries a reason",
          all(not t["reason"].strip() for t in trans if t["onVoucher"] == "Y"))

    print("\nQuestion: whose Tier 2 contribution has reached its maximum?")
    tier2 = [e for e in employees if e["tier"] == "2"]
    at_cap = [e for e in tier2 if e["ytdPens"] >= cap]
    over = [e for e in at_cap if round(e["ytdTier2"], 2) > expected_max + 0.005]
    check("some Tier 2 employees have reached the cap", len(at_cap) > 0,
          f"{len(at_cap)} of {len(tier2)} Tier 2 employees")
    check("not all of them have, or the question is trivial",
          len(at_cap) < len(tier2))
    check("contributions taken past the cap are present to be found",
          len(over) == 2, f"{[e['id'] for e in over]}")

    print("\nFindings the Profile stage should surface")
    ot_exempt = {t["emp"] for t in trans if t["paycode"].strip() == "OT"} & {
        e["id"] for e in employees if e["flsa"] == "E"}
    check("overtime recorded against exempt employees", len(ot_exempt) > 0,
          f"{sorted(ot_exempt)}")
    orphan_dept = {e["dept"] for e in employees} - set(d["reference"]["departments"])
    check("department codes with no entry in the org table", len(orphan_dept) > 0,
          f"{sorted(orphan_dept)}")

    print("\nHomepage Lab preview figures")
    # The homepage states four findings as static text. Marketing copy that
    # quietly stops matching the data is the failure mode this whole project
    # argues against, so it is checked here rather than trusted.
    home = os.path.abspath(os.path.join(HERE, "..", "..", "index.html"))
    shown = []
    try:
        html = io.open(home, encoding="utf-8").read()
        strip = re.search(r'lab-preview-strip">(.*?)</div>\s*\n\s*</div>', html, re.S)
        shown = [int(n) for n in re.findall(r"<strong>(\d+)</strong>", strip.group(1))]
    except Exception as exc:                       # pragma: no cover - I/O guard
        check("homepage preview strip is readable", False, str(exc))

    if shown:
        want = [len(trans), len(excluded), len(orphan_dept), len(over)]
        labels = ["transactions", "exclusions", "broken joins", "contribution errors"]
        check("homepage figures match the corpus", shown == want,
              f"page {shown} vs data {want}")
        for label, a, b in zip(labels, shown, want):
            if a != b:
                print(f"        {label}: homepage says {a}, data says {b}")

    print(f"\n{'All checks passed.' if not failures else str(len(failures)) + ' FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
