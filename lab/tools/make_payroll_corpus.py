"""Generate the synthetic payroll corpus for the BI Lifecycle Lab.

The Lab's Extract stage decodes *real* bytes: EBCDIC text, packed decimal,
zoned dates, fixed-length 80-byte records. Faking that with pre-decoded JSON
would undercut the whole point, so this writes genuine mainframe-shaped records
and base64s them for the browser to decode.

Everything here is invented. No record derives from any client file. The Lab
says so on the page, and the Tier 2 cap below is a parameter of this synthetic
dataset rather than any jurisdiction's real statutory figure.

The data is built so the questions Canyonland actually gets asked have real
answers in it:

  * Why are some employees associated with a paycode not on the voucher?
    Four different causes are seeded, because the honest answer is that there
    is no single cause.
  * Whose Tier 2 contribution has reached its maximum?
    Seeded at, near and over the cap — including two where a contribution was
    taken *after* the cap was reached, which is a defect the Profile stage
    should surface rather than something to smooth over.

Run:  python lab/tools/make_payroll_corpus.py
"""

from __future__ import annotations

import base64
import io
import json
import os
import random
from datetime import date

# Deterministic: the corpus must be identical on every run, or the Lab's
# narrative ("look at record 0041") stops matching what the page shows.
SEED = 20260902
PERIOD_END = 20260626          # the biweekly period this extract covers
TIER2_EARNINGS_CAP = 12750000  # $127,500.00, in cents. Synthetic.
TIER2_RATE = 0.0450            # 4.50% employee contribution. Synthetic.

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "data"))

LAST_NAMES = [
    "ABERNATHY", "BAUTISTA", "CALDWELL", "DELACRUZ", "ELLSWORTH", "FONTENOT",
    "GRZYBOWSKI", "HERNANDEZ", "IWASAKI", "JOHANSEN", "KOWALCZYK", "LINDQVIST",
    "MBEKI", "NAKAGAWA", "OYELARAN", "PRZYBYLSKI", "QUARLES", "RASMUSSEN",
    "SZCZEPANIAK", "THIBODEAUX", "UMBERGER", "VANDERBERG", "WOJCIECHOWSKI",
    "XIONG", "YOUNGBLOOD", "ZAMORA",
]
FIRST_NAMES = [
    "ADRIAN", "BEATRICE", "CORNELIUS", "DELPHINE", "EAMON", "FIONA", "GERALD",
    "HARRIET", "IGNATIUS", "JOSEPHINE", "KWAME", "LUCILLE", "MARCUS", "NADIA",
    "OSWALD", "PRIYA", "QUINTON", "ROSALIND", "SAMUEL", "TERESA", "ULRICH",
    "VIVIAN", "WENDELL", "XIMENA", "YOLANDA", "ZACHARY",
]
DEPTS = ["1100", "1200", "2300", "2400", "3100", "4200", "5500"]
DEPT_NAMES = {
    "1100": "Public Works", "1200": "Water & Sewer", "2300": "Human Services",
    "2400": "Public Health", "3100": "Parks & Recreation",
    "4200": "Transportation", "5500": "Administration",
}

# Paycode, description, whether it reaches the voucher, whether it is cash.
PAYCODES = [
    ("REG ", "Regular hours",          True,  True),
    ("OT  ", "Overtime at 1.5",        True,  True),
    ("DBL ", "Double time",            True,  True),
    ("SHFT", "Shift differential",     True,  True),
    ("HOL ", "Holiday pay",            True,  True),
    ("VAC ", "Vacation taken",         True,  True),
    ("SICK", "Sick leave taken",       True,  True),
    ("RETR", "Retroactive adjustment", True,  True),
    ("IMPU", "Imputed income (non-cash)", False, False),
]

EXCLUSION_REASONS = {
    "TE": "Employee terminated before period end",
    "ZN": "Net pay resolved to zero after deductions",
    "NC": "Non-cash paycode, excluded from cash voucher by design",
    "DP": "Department code not found in the org table; row failed the join",
}


# --------------------------------------------------------------------------
# Mainframe field encodings
# --------------------------------------------------------------------------

def ebcdic(text: str, length: int) -> bytes:
    """Fixed-length EBCDIC text, space padded. cp037 is the US code page."""
    return text.ljust(length)[:length].encode("cp037")


def packed(value: int, digits: int) -> bytes:
    """COMP-3. Two digits per byte, sign in the low nibble of the last byte.

    ``value`` is already scaled to an integer — the decimal point is implied by
    the PIC clause and appears nowhere in the data, which is exactly the trap
    the Extract stage exists to show.
    """
    nbytes = digits // 2 + 1
    sign = 0x0C if value >= 0 else 0x0D          # C positive, D negative
    text = str(abs(value)).rjust(digits, "0")[-digits:]
    nibbles = list(text) + [""]                   # last nibble is the sign
    out = bytearray()
    # Digits pack two per byte from the left, with the sign occupying the final
    # low nibble, so an odd digit count fills the layout exactly.
    packed_digits = text.rjust(nbytes * 2 - 1, "0")
    for i in range(0, len(packed_digits) - 1, 2):
        out.append((int(packed_digits[i]) << 4) | int(packed_digits[i + 1]))
    out.append((int(packed_digits[-1]) << 4) | sign)
    assert len(out) == nbytes, (len(out), nbytes, digits)
    return bytes(out)


def zoned_date(yyyymmdd: int) -> bytes:
    """PIC 9(08) DISPLAY — eight EBCDIC digits, unsigned."""
    return ebcdic(str(yyyymmdd).rjust(8, "0"), 8)


# --------------------------------------------------------------------------
# Record layouts (mirrored by the copybooks written below)
# --------------------------------------------------------------------------

def employee_record(e: dict) -> bytes:
    r = (
        ebcdic(e["id"], 9)
        + ebcdic(e["last"], 20)
        + ebcdic(e["first"], 15)
        + ebcdic(e["dept"], 4)
        + ebcdic(e["status"], 1)
        + ebcdic(e["flsa"], 1)
        + zoned_date(e["hired"])
        + zoned_date(e["termed"])
        + packed(e["rate_cents"], 7)
        + ebcdic(e["tier"], 1)
        + packed(e["ytd_pens_cents"], 9)
        + packed(e["ytd_t2_cents"], 7)
    )
    assert len(r) == 80, len(r)
    return r


def transaction_record(t: dict) -> bytes:
    r = (
        ebcdic(t["emp"], 9)
        + zoned_date(t["period"])
        + ebcdic(t["paycode"], 4)
        + packed(t["hours_c"], 5)
        + packed(t["mult_c"], 4)
        + packed(t["amount_c"], 9)
        + ebcdic("Y" if t["on_voucher"] else "N", 1)
        + ebcdic(t["reason"], 2)
        + ebcdic("", 5)                       # FILLER, to a round 40 bytes
    )
    assert len(r) == 40, len(r)
    return r


# --------------------------------------------------------------------------
# Corpus
# --------------------------------------------------------------------------

def build() -> dict:
    rnd = random.Random(SEED)
    employees: list[dict] = []

    for i in range(64):
        emp_id = f"E{100000 + i * 7:08d}"[:9]
        tier = "2" if i % 3 else "1"
        rate = rnd.randrange(2100, 7400)  # cents: $21.00–$74.00 hourly

        # Tier 2 year-to-date pensionable earnings, deliberately spread across
        # the cap so the "who has reached the maximum" question has a real,
        # non-trivial answer: some under, some just at, some over.
        if tier == "2":
            band = i % 8
            if band < 5:
                ytd = rnd.randrange(2_000_000, 11_000_000)
            elif band < 7:
                ytd = rnd.randrange(TIER2_EARNINGS_CAP - 180_000,
                                    TIER2_EARNINGS_CAP + 20_000)
            else:
                ytd = rnd.randrange(TIER2_EARNINGS_CAP + 40_000,
                                    TIER2_EARNINGS_CAP + 900_000)
        else:
            ytd = rnd.randrange(2_000_000, 14_000_000)

        contrib = int(min(ytd, TIER2_EARNINGS_CAP) * TIER2_RATE) if tier == "2" else 0

        status, termed = "A", 99999999
        if i in (11, 29, 47):                 # terminated mid-period
            status, termed = "T", 20260617
        elif i in (5, 38):
            status = "L"                      # on leave

        employees.append({
            "id": emp_id,
            "last": LAST_NAMES[i % len(LAST_NAMES)],
            "first": FIRST_NAMES[(i * 5) % len(FIRST_NAMES)],
            # Two employees carry a department code absent from the org table.
            "dept": "9999" if i in (23, 51) else DEPTS[i % len(DEPTS)],
            "status": status,
            "flsa": "E" if i % 6 == 0 else "N",
            "hired": int(f"{rnd.randrange(1998, 2024)}{rnd.randrange(1,13):02d}{rnd.randrange(1,28):02d}"),
            "termed": termed,
            "rate_cents": rate,
            "tier": tier,
            "ytd_pens_cents": ytd,
            "ytd_t2_cents": contrib,
        })

    # Two employees had a Tier 2 contribution taken after reaching the cap.
    # This is a seeded defect, not a rounding artefact: the Profile stage
    # should find it and the page should say what it means.
    for idx in (16, 40):
        e = employees[idx]
        if e["tier"] == "2":
            e["ytd_pens_cents"] = TIER2_EARNINGS_CAP + 250_00
            e["ytd_t2_cents"] = int(e["ytd_pens_cents"] * TIER2_RATE)

    transactions: list[dict] = []
    for e in employees:
        idx = employees.index(e)
        codes = ["REG "]
        if e["flsa"] == "N" and idx % 3 == 0:
            codes.append("OT  ")
        # Overtime recorded against an exempt employee: a finding, not noise.
        if e["flsa"] == "E" and idx in (12, 36):
            codes.append("OT  ")
        if idx % 5 == 0:
            codes.append("SHFT")
        if idx % 7 == 0:
            codes.append("VAC ")
        if idx % 11 == 0:
            codes.append("SICK")
        if idx % 9 == 0:
            codes.append("IMPU")
        if idx in (3, 21, 44):
            codes.append("RETR")

        for code in codes:
            meta = next(c for c in PAYCODES if c[0] == code)
            hours = {"REG ": 0 if e["status"] == "L" else 8000,
                     "OT  ": rnd.randrange(200, 1400),
                     "SHFT": rnd.randrange(400, 2000), "VAC ": rnd.randrange(800, 4000),
                     "SICK": rnd.randrange(400, 1600), "IMPU": 0,
                     "RETR": 0}.get(code, 0)
            mult = {"OT  ": 1500, "DBL ": 2000}.get(code, 1000)   # 3dp implied
            amount = int(hours / 100 * e["rate_cents"] * mult / 1000)
            if code == "IMPU":
                amount = rnd.randrange(1500, 9000)
            if code == "RETR":
                amount = rnd.randrange(11000, 62000)

            reason, on_voucher = "  ", True
            if not meta[2]:
                reason, on_voucher = "NC", False
            elif e["status"] == "T" and e["termed"] <= PERIOD_END:
                reason, on_voucher = "TE", False
            elif e["dept"] == "9999":
                reason, on_voucher = "DP", False
            elif amount == 0:
                reason, on_voucher = "ZN", False

            transactions.append({
                "emp": e["id"], "period": PERIOD_END, "paycode": code,
                "hours_c": hours, "mult_c": mult, "amount_c": amount,
                "on_voucher": on_voucher, "reason": reason,
            })

    return {"employees": employees, "transactions": transactions}


COPYBOOK_EMP = """      *
      * EMPLOYEE MASTER - 80 BYTE FIXED LENGTH RECORD
      * SYNTHETIC DATA FOR DEMONSTRATION. NOT CLIENT DATA.
      *
       01  EMPLOYEE-RECORD.
           05  EM-EMPLOYEE-ID          PIC X(09).
           05  EM-LAST-NAME            PIC X(20).
           05  EM-FIRST-NAME           PIC X(15).
           05  EM-DEPT-CODE            PIC X(04).
           05  EM-STATUS               PIC X(01).
           05  EM-FLSA-CLASS           PIC X(01).
           05  EM-HIRE-DATE            PIC 9(08).
           05  EM-TERM-DATE            PIC 9(08).
           05  EM-PAY-RATE             PIC S9(05)V99 COMP-3.
           05  EM-PENSION-TIER         PIC X(01).
           05  EM-YTD-PENS-EARN        PIC S9(07)V99 COMP-3.
           05  EM-YTD-TIER2-CONTRIB    PIC S9(05)V99 COMP-3.
"""

COPYBOOK_TRAN = """      *
      * PAY TRANSACTION - 40 BYTE FIXED LENGTH RECORD
      * SYNTHETIC DATA FOR DEMONSTRATION. NOT CLIENT DATA.
      *
       01  PAY-TRANSACTION.
           05  PT-EMPLOYEE-ID          PIC X(09).
           05  PT-PERIOD-END           PIC 9(08).
           05  PT-PAYCODE              PIC X(04).
           05  PT-HOURS                PIC S9(03)V99 COMP-3.
           05  PT-RATE-MULT            PIC S9(01)V999 COMP-3.
           05  PT-AMOUNT               PIC S9(07)V99 COMP-3.
           05  PT-VOUCHER-FLAG         PIC X(01).
           05  PT-EXCLUDE-REASON       PIC X(02).
           05  FILLER                  PIC X(05).
"""


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    corpus = build()

    emp_bytes = b"".join(employee_record(e) for e in corpus["employees"])
    tran_bytes = b"".join(transaction_record(t) for t in corpus["transactions"])

    excluded = [t for t in corpus["transactions"] if not t["on_voucher"]]
    at_cap = [e for e in corpus["employees"]
              if e["tier"] == "2" and e["ytd_pens_cents"] >= TIER2_EARNINGS_CAP]
    over_contrib = [e for e in at_cap
                    if e["ytd_t2_cents"] > int(TIER2_EARNINGS_CAP * TIER2_RATE)]

    # What the browser decoder must reproduce. The page checks itself against
    # these on load: if the JavaScript decode disagrees with the Python that
    # wrote the bytes, the Lab says so rather than showing confident nonsense.
    by_reason: dict[str, int] = {}
    for t in excluded:
        by_reason[t["reason"]] = by_reason.get(t["reason"], 0) + 1
    ot_exempt = sorted(
        {t["emp"] for t in corpus["transactions"] if t["paycode"].strip() == "OT"}
        & {e["id"] for e in corpus["employees"] if e["flsa"] == "E"})
    payload_expected = {
        "employeeCount": len(corpus["employees"]),
        "transactionCount": len(corpus["transactions"]),
        "excludedCount": len(excluded),
        "excludedByReason": by_reason,
        "tier2AtCap": sorted(e["id"] for e in at_cap),
        "tier2OverContributed": sorted(e["id"] for e in over_contrib),
        "overtimeOnExempt": ot_exempt,
        "orphanDepartments": sorted(
            {e["dept"] for e in corpus["employees"]} - set(DEPT_NAMES)),
        "grossOnVoucherCents": sum(
            t["amount_c"] for t in corpus["transactions"] if t["on_voucher"]),
    }

    payload = {
        "generated": {
            "seed": SEED,
            "periodEnd": PERIOD_END,
            "note": "Synthetic. Constructed for demonstration; not derived from any client file.",
        },
        "params": {
            "tier2EarningsCapCents": TIER2_EARNINGS_CAP,
            "tier2Rate": TIER2_RATE,
            "capIsSynthetic": True,
        },
        "layouts": {
            "employee": {"bytes": 80, "copybook": COPYBOOK_EMP},
            "transaction": {"bytes": 40, "copybook": COPYBOOK_TRAN},
        },
        "reference": {
            "departments": DEPT_NAMES,
            "paycodes": [{"code": c[0].strip(), "label": c[1],
                          "onVoucher": c[2], "cash": c[3]} for c in PAYCODES],
            "exclusionReasons": EXCLUSION_REASONS,
        },
        "records": {
            "employeeB64": base64.b64encode(emp_bytes).decode("ascii"),
            "transactionB64": base64.b64encode(tran_bytes).decode("ascii"),
            "employeeCount": len(corpus["employees"]),
            "transactionCount": len(corpus["transactions"]),
        },
        "expected": payload_expected,
    }

    path = os.path.join(OUT, "payroll-corpus.json")
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(payload, indent=1))

    print(f"  employees      {len(corpus['employees']):>4}  ({len(emp_bytes):,} bytes raw)")
    print(f"  transactions   {len(corpus['transactions']):>4}  ({len(tran_bytes):,} bytes raw)")
    print(f"  excluded rows  {len(excluded):>4}  reasons: "
          f"{sorted(set(t['reason'] for t in excluded))}")
    print(f"  at/over cap    {len(at_cap):>4}  of which over-contributed: {len(over_contrib)}")
    print(f"  wrote {path} ({os.path.getsize(path):,} bytes)")


if __name__ == "__main__":
    main()
