"""Make random student codes for a class list.

    python scripts/make_roster.py 24                    # 24 codes -> data/roster_new.txt + .csv
    python scripts/make_roster.py 24 --out roster.txt   # choose the file name

The .txt file (one code per line) is the class list the site reads (SPROUT_ROSTER, or on Render a
Secret File named roster.txt). The .csv adds an empty "name" column for the instructor's own copy:
keep that file offline. The site never sees student names.
"""

from __future__ import annotations

import argparse
import csv
import secrets
from pathlib import Path

ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # no 0/o, 1/l/i: easy to read off a slip of paper


def make_codes(n: int, length: int = 6, taken: set[str] | None = None) -> list[str]:
    taken = set(taken or ())
    codes: list[str] = []
    while len(codes) < n:
        c = "l_" + "".join(secrets.choice(ALPHABET) for _ in range(length))
        if c not in taken:
            taken.add(c)
            codes.append(c)
    return codes


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("count", type=int, help="number of codes")
    ap.add_argument("--out", default="data/roster_new.txt", help="class list file to write")
    ap.add_argument("--length", type=int, default=6, help="random characters per code (3-12)")
    args = ap.parse_args()
    if not 3 <= args.length <= 12:
        ap.error("--length must be 3 to 12")

    out = Path(args.out)
    existing = set()
    if out.exists():
        existing = {ln.strip() for ln in out.read_text(encoding="utf-8").splitlines() if ln.strip()}
    codes = make_codes(args.count, args.length, existing)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "a", encoding="utf-8") as f:
        f.writelines(c + "\n" for c in codes)
    sheet = out.with_suffix(".csv")
    new_sheet = not sheet.exists()
    with open(sheet, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new_sheet:
            w.writerow(["code", "name"])
        w.writerows([c, ""] for c in codes)
    print(f"added {len(codes)} codes to {out} (instructor sheet: {sheet})")


if __name__ == "__main__":
    main()
