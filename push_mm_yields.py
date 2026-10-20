#!/usr/bin/env python3
"""
push_mm_yields.py
=================
Reads the Money Market Yields Tracker (Comparison sheet) and upserts the four
funds' yields into Supabase (mm_yields), which the dashboard Cash tab reads as a
reference. Pure stdlib for parsing (zipfile + regex) + the supabase client that
is already installed on the Bloomberg PC. Meant to run on that always-on PC via
Task Scheduler, a few times a day.

  py push_mm_yields.py          # read and push
  py push_mm_yields.py --dry    # read and print only, no push

Credentials: .env in the same folder (SUPABASE_URL, SUPABASE_KEY) — same file
the existing watcher uses.
"""
from __future__ import annotations
import os
import re
import sys
import zipfile
from datetime import datetime, timezone, date, timedelta

from dotenv import load_dotenv
from supabase import create_client

# Tracker location. Uses the signed-in user's OneDrive sync; falls back to the
# known path. Edit TRACKER if the Bloomberg PC syncs it somewhere else.
_CANDIDATES = [
    os.path.join(os.path.expanduser("~"), "Aylett & Co", "Funds - Documents",
                 "Fund Accounting Tools", "Money Market Yields",
                 "Money Market Yields Tracker.xlsx"),
    r"C:\Users\JamesWhitaker\Aylett & Co\Funds - Documents\Fund Accounting Tools\Money Market Yields\Money Market Yields Tracker.xlsx",
]
TRACKER = next((p for p in _CANDIDATES if os.path.exists(p)), _CANDIDATES[0])
SHEET_NAME = "Comparison"
DRY = "--dry" in sys.argv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


def _decode(s: str) -> str:
    return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&apos;", "'"))


def _serial_to_iso(serial):
    try:
        n = float(serial)
    except (TypeError, ValueError):
        return None
    if n < 1:
        return None
    return (date(1899, 12, 30) + timedelta(days=int(n))).isoformat()


def _pct(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f * 100, 4)


def parse_tracker(path: str):
    with zipfile.ZipFile(path) as z:
        files = {n: z.read(n).decode("utf-8", "replace") for n in z.namelist()
                 if n in ("xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml")
                 or re.match(r"xl/worksheets/sheet\d+\.xml$", n)}

    # shared strings
    ss = []
    for si in re.findall(r"<si>(.*?)</si>", files.get("xl/sharedStrings.xml", ""), re.S):
        ss.append("".join(_decode(t) for t in re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))

    # sheet name -> file
    rels = {}
    for m in re.finditer(r"<Relationship\b([^>]*)/>", files.get("xl/_rels/workbook.xml.rels", "")):
        a = m.group(1)
        rid = re.search(r'Id="([^"]*)"', a)
        tgt = re.search(r'Target="([^"]*)"', a)
        if rid and tgt:
            rels[rid.group(1)] = tgt.group(1)
    target = None
    for m in re.finditer(r"<sheet\b([^>]*?)/?>", files.get("xl/workbook.xml", "")):
        a = m.group(1)
        name = re.search(r'name="([^"]*)"', a)
        rid = re.search(r'r:id="([^"]*)"', a)
        if name and rid and name.group(1) == SHEET_NAME:
            target = "xl/" + rels.get(rid.group(1), "").lstrip("/")
            break
    if not target or target not in files:
        raise RuntimeError(f'sheet "{SHEET_NAME}" not found')
    xml = files[target]

    def cell_val(attrs, body):
        tmatch = re.search(r' t="([^"]*)"', attrs)
        t = tmatch.group(1) if tmatch else ""
        v = re.search(r"<v>(.*?)</v>", body, re.S)
        istr = re.search(r"<is>.*?<t[^>]*>(.*?)</t>.*?</is>", body, re.S)
        if t == "s" and v:
            idx = int(v.group(1))
            return ss[idx] if 0 <= idx < len(ss) else ""
        if t == "inlineStr" and istr:
            return _decode(istr.group(1))
        return v.group(1) if v else ""

    rows = {}
    for m in re.finditer(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', xml, re.S):
        col, row, attrs, body = m.group(1), int(m.group(2)), m.group(3) or "", m.group(4) or ""
        rows.setdefault(row, {})[col] = cell_val(attrs, body)
    return rows


def main():
    rows = parse_tracker(TRACKER)
    now = datetime.now(timezone.utc).isoformat()
    funds = []
    for r in range(6, 41):
        o = rows.get(r)
        if not o:
            continue
        manco = (o.get("A") or "").strip()
        fund = (o.get("B") or "").strip()
        if not manco or not fund:
            continue  # stops at the notes rows (blank B)
        funds.append({
            "manco": manco,
            "fund_class": fund,
            "monthly_nominal": _pct(o.get("I")),   # I  Monthly Nominal
            "eff_7day": _pct(o.get("D")),           # D  7-Day Effective (NACA)
            "rate_date": _serial_to_iso(o.get("C")),  # C  Latest Rate Date
            "rank": int(float(o["G"])) if o.get("G") and o["G"].strip() else None,  # G Rank
            "updated_at": now,
        })
    if not funds:
        raise RuntimeError("no fund rows parsed")

    print(f"Parsed {len(funds)} funds from {TRACKER}:")
    for f in funds:
        print(f"  {f['rank']}. {f['fund_class']:<20} nom {f['monthly_nominal']}%  "
              f"7d-eff {f['eff_7day']}%  ({f['rate_date']})")

    if DRY:
        print("\n--dry: not pushing.")
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in .env")
    sb = create_client(url, key)
    sb.table("mm_yields").upsert(funds, on_conflict="fund_class").execute()
    print(f"\nPushed {len(funds)} funds to Supabase mm_yields. {datetime.now().isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
