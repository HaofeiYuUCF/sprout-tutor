"""Start the workbench. NiceGUI auto-reload stays OFF: a second process would open the COM port twice."""

from __future__ import annotations

import os

from nicegui import app, ui

from ..config import load_settings
from ..runtime import build_board, build_tutor
from .workbench import Session, build_page

_board = None
_tutors: dict = {}


def _board_singleton():
    global _board
    if _board is None:
        _board = build_board()
    return _board


@ui.page("/")
def index(learner: str = "l_demo") -> None:
    if learner not in _tutors:
        _tutors[learner] = build_tutor(learner)
    build_page(Session(learner, _tutors[learner], _board_singleton()))


def _shutdown() -> None:
    broker = getattr(_board, "broker", None)
    if broker:
        broker.stop()


def main() -> None:
    s = load_settings()
    app.on_shutdown(_shutdown)
    ui.run(port=s.ui.port, reload=False, title="SPROUT workbench",
           show=os.environ.get("SPROUT_UI_SHOW", "1") == "1")
