"""Human-readable learner progress files (YAML), one per learner."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import yaml

from .schemas import CardProgress, LearnerProgress

HEADER = (
    "# SPROUT learner progress (readable summary; the full record is in data/events/).\n"
    "# highest_hint_step: 1 where, 2 general check, 3 specific issue, 4 fix.\n"
)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class ProgressStore:
    def __init__(self, learners_dir: Path):
        self.dir = learners_dir
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, learner_id: str) -> Path:
        return self.dir / f"{learner_id}.yaml"

    def load(self, learner_id: str) -> LearnerProgress:
        p = self.path(learner_id)
        if not p.exists():
            return LearnerProgress(learner_id=learner_id)
        return LearnerProgress.model_validate(yaml.safe_load(p.read_text(encoding="utf-8")))

    def save(self, prog: LearnerProgress) -> None:
        prog.updated = _now()
        body = yaml.safe_dump(prog.model_dump(), sort_keys=False, allow_unicode=True)
        self.path(prog.learner_id).write_text(HEADER + body, encoding="utf-8")

    def _card(self, prog: LearnerProgress, card_id: str) -> CardProgress:
        return prog.cards.setdefault(card_id, CardProgress())

    def opened(self, learner_id: str, card_id: str) -> None:
        prog = self.load(learner_id)
        c = self._card(prog, card_id)
        if c.status == "not_started":
            c.status, c.first_opened = "in_progress", _now()
        self.save(prog)

    def sim_passed(self, learner_id: str, card_id: str) -> None:
        prog = self.load(learner_id)
        c = self._card(prog, card_id)
        if c.status == "not_started":
            c.status, c.first_opened = "in_progress", _now()
        c.sim_passed = True
        self.save(prog)

    def hint(self, learner_id: str, card_id: str, step: int, source: str) -> None:
        prog = self.load(learner_id)
        c = self._card(prog, card_id)
        c.highest_hint_step = max(c.highest_hint_step, step)
        if source == "llm":
            c.hints_llm += 1
        elif source == "curated":
            c.hints_curated += 1
        else:
            c.hints_generic += 1
        self.save(prog)

    def checks(self, learner_id: str, card_id: str, passed_ids: list[str], all_passed: bool) -> None:
        prog = self.load(learner_id)
        c = self._card(prog, card_id)
        c.checks_passed = sorted(set(c.checks_passed) | set(passed_ids))
        if all_passed and c.status != "completed":
            c.status, c.completed_at = "completed", _now()
        self.save(prog)
