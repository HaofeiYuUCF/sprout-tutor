"""Append-only JSONL event log. Every event carries policy and app versions."""

from __future__ import annotations

import subprocess
from pathlib import Path
from uuid import uuid4

from . import __version__
from .schemas import Event


def git_commit(root: Path) -> str | None:
    try:
        out = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


class EventLogger:
    def __init__(self, events_dir: Path, learner_id: str, policy_version: str,
                 root: Path | None = None, session_id: str | None = None):
        events_dir.mkdir(parents=True, exist_ok=True)
        self.session_id = session_id or uuid4().hex[:12]
        self.learner_id = learner_id
        self.policy_version = policy_version
        self.path = events_dir / f"{learner_id}.jsonl"
        self._commit = git_commit(root) if root else None
        self.log("session_start")

    def log(self, event_type: str, **fields) -> Event:
        ev = Event(session_id=self.session_id, learner_id=self.learner_id, event_type=event_type,
                   policy_version=self.policy_version, app_version=__version__,
                   git_commit=self._commit, **fields)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(ev.model_dump_json(exclude_none=True) + "\n")
        return ev
