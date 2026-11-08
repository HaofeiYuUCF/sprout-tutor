"""Per-learner sketch folders that satisfy arduino-cli (<folder>/<folder>.ino)."""

from __future__ import annotations

from pathlib import Path


def sketch_dir(data_dir: Path, learner_id: str, card_id: str) -> Path:
    return data_dir / "work" / learner_id / card_id


def write_sketch(data_dir: Path, learner_id: str, card_id: str, code: str) -> Path:
    d = sketch_dir(data_dir, learner_id, card_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{card_id}.ino").write_text(code, encoding="utf-8")
    return d


def read_sketch(data_dir: Path, learner_id: str, card_id: str) -> str | None:
    f = sketch_dir(data_dir, learner_id, card_id) / f"{card_id}.ino"
    return f.read_text(encoding="utf-8") if f.exists() else None
