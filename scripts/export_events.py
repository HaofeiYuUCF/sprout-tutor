"""Export events for the external evaluator as CSV, with an optional redaction of student text.

Usage: python scripts/export_events.py out.csv [--redact]
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REDACT = {"student_text", "serial_summary"}  # student free text and device output
REDACT_DETAIL = {"message"}                   # tool messages can contain local paths and user names


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("out", type=Path)
    p.add_argument("--redact", action="store_true",
                   help="drop student free text, serial output and tool messages")
    a = p.parse_args()
    rows, fields = [], []
    for f in sorted((ROOT / "data" / "events").glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            ev = json.loads(line)
            if a.redact:
                for k in REDACT:
                    ev.pop(k, None)
                if isinstance(ev.get("detail"), dict):
                    for k in REDACT_DETAIL:
                        ev["detail"].pop(k, None)
            for k, v in ev.items():
                if isinstance(v, (dict, list)):
                    ev[k] = json.dumps(v, ensure_ascii=False)
                if k not in fields:
                    fields.append(k)
            rows.append(ev)
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} events to {a.out}{' (redacted)' if a.redact else ''}")


if __name__ == "__main__":
    main()
