"""HTTP routes for the Web Lab, added to NiceGUI's FastAPI app.

Requests must come from this machine's own page: the Host must be localhost/127.0.0.1 (stops DNS
rebinding) and the body must be JSON (a cross-site page cannot send JSON without a CORS preflight,
which this server never approves).
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from ..config import data_dir, load_settings, repo_root
from ..content import load_cards
from ..hardware.board import ArduinoCliBoard
from ..hardware.ports import KNOWN
from .compile_service import HELLO_SKETCH, CompileService, append_trial, clean_trial

STATIC = Path(__file__).parent / "static"
LOCAL_HOSTS = {"127.0.0.1", "localhost"}


def is_local(request: Request) -> bool:
    host = request.headers.get("host", "").rsplit(":", 1)[0].strip("[]")
    origin = request.headers.get("origin")
    if origin:
        origin_host = origin.split("://", 1)[-1].rsplit(":", 1)[0]
        if origin_host not in LOCAL_HOSTS:
            return False
    return host in LOCAL_HOSTS


def _guard(request: Request, json_body: bool = False) -> JSONResponse | None:
    if not is_local(request):
        return JSONResponse({"error": "Web Lab accepts requests from this computer only."}, 403)
    if json_body and not request.headers.get("content-type", "").startswith("application/json"):
        return JSONResponse({"error": "Send JSON."}, 415)
    return None


def sketch_list(root: Path) -> list[dict]:
    """The hello test plus each card's starter code (never the reference solutions)."""
    items = [{"id": "hello", "title": "Hello UNO (no parts needed)", "code": HELLO_SKETCH}]
    for c in load_cards(root).values():
        items.append({"id": c.id, "title": f"{c.card.title} (starter)",
                      "code": c.starter.read_text(encoding="utf-8")})
    return items


def register(app: FastAPI, root: Path | None = None) -> None:
    root = root or repo_root()
    s = load_settings(root)
    board = ArduinoCliBoard(root / s.board.arduino_cli, root / s.board.arduino_cli_config,
                            s.board.fqbn, None)
    d = data_dir(root)
    service = CompileService(board, d / "work" / "_weblab")
    trials = d / "weblab" / "upload_trials.jsonl"

    app.add_static_files("/weblab/static", STATIC, max_cache_age=0)
    if os.environ.get("SPROUT_WEBLAB_TEST") == "1":
        app.add_static_files("/weblab/test", root / "tests" / "js", max_cache_age=0)

    @app.get("/weblab")
    def weblab_page(request: Request):
        return _guard(request) or FileResponse(STATIC / "weblab.html")

    @app.get("/api/weblab/config")
    def weblab_config(request: Request):
        return _guard(request) or {
            "sketches": sketch_list(root),
            "compiler_ready": service.available(),
            "known_boards": [{"usbVendorId": v, "usbProductId": p, "name": n}
                             for (v, p), n in KNOWN.items()],
            "default_baud": s.board.baud,
        }

    @app.post("/api/weblab/compile")
    async def weblab_compile(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        body = await request.json()
        code = body.get("code") if isinstance(body, dict) else None
        return await run_in_threadpool(service.compile, code)

    @app.post("/api/weblab/trial")
    async def weblab_trial(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        record = clean_trial(await request.json())
        if record is None:
            return JSONResponse({"error": "bad trial record"}, 400)
        await run_in_threadpool(append_trial, trials, record)
        return {"saved": True}
