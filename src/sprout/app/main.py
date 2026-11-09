"""Start the workbench. NiceGUI auto-reload stays OFF: a second process would open the COM port twice.

The server listens on 127.0.0.1 only: lab laptops are single-user, and learner IDs become file
names, so other machines must not reach it.
"""

from __future__ import annotations

import os
import re

from fastapi.responses import RedirectResponse
from nicegui import app, ui

from ..config import load_settings
from ..runtime import build_board, build_tutor
from ..web.public import public_mode
from ..web.routes import register as register_weblab
from .workbench import Session, build_page

LEARNER_ID = re.compile(r"^l_[a-z0-9]{3,12}$")

_board = None
_tutors: dict = {}


def _board_singleton():
    global _board
    if _board is None:
        _board = build_board()
    return _board


@ui.page("/")
def index(learner: str = "l_demo"):
    if public_mode():   # the desktop workbench is for lab laptops; the public site is the Web Lab
        return RedirectResponse("/weblab")
    if not LEARNER_ID.match(learner):
        ui.label("Invalid learner ID. Use the link your instructor gave you (e.g. ?learner=l_ab12).")
        return
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
    register_weblab(app)  # /weblab: browser-upload feasibility test
    # 127.0.0.1 on a laptop; 0.0.0.0 inside the server container (behind the HTTPS proxy).
    ui.run(host=os.environ.get("SPROUT_HOST", "127.0.0.1"), port=s.ui.port, reload=False,
           title="SPROUT workbench", show=os.environ.get("SPROUT_UI_SHOW", "1") == "1")
