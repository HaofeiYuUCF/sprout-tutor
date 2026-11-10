"""List the sign-in codes of students who said they want to hear about Grow teams.

    python scripts/list_grow_interest.py [data_dir]

Prints one line per code: code, answer, date, cards done. Match the codes to students with the
class list kept by the instructor; the site stores no names or e-mail addresses.
"""

import sys
from pathlib import Path

import yaml

data = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "data"
rows = []
for p in sorted((data / "learners").glob("l_*.yaml")):
    d = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if d.get("grow_interest"):
        cards = d.get("cards") or {}
        done = sum(1 for c in cards.values() if c.get("status") == "completed" or c.get("sim_passed"))
        rows.append((d["learner_id"], d["grow_interest"], (d.get("grow_interest_at") or "")[:10], done))
for code, answer, day, done in rows:
    print(f"{code}\t{answer}\t{day}\t{done} cards")
print(f"{sum(1 for r in rows if r[1] == 'yes')} interested, {len(rows)} answered", file=sys.stderr)
