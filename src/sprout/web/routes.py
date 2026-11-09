"""HTTP routes for the Web Lab, added to NiceGUI's FastAPI app.

Requests must come from this machine's own page: the Host must be localhost/127.0.0.1 (stops DNS
rebinding) and the body must be JSON (a cross-site page cannot send JSON without a CORS preflight,
which this server never approves).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from ..config import data_dir, load_settings, repo_root
from ..content import load_cards
from ..hardware.board import ArduinoCliBoard
from ..hardware.ports import KNOWN
from ..runtime import build_tutor
from .compile_service import HELLO_SKETCH, CompileService, append_trial, clean_trial
from .tutor_api import BadRequest, WebTutor, card_view

STATIC = Path(__file__).parent / "static"
log = logging.getLogger("sprout.weblab")
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


def sketch_list(root: Path, include_seeds: bool = False) -> list[dict]:
    """The hello test plus each card's starter code (never the reference solutions).

    include_seeds (test mode only) adds the seeded-fault sketches used for demos and evaluation.
    """
    items = [{"id": "hello", "card_id": None, "title": "Hello UNO (no parts needed)",
              "code": HELLO_SKETCH}]
    for c in load_cards(root).values():
        items.append({"id": c.id, "card_id": c.id, "title": f"{c.card.title} (starter)",
                      "code": c.starter.read_text(encoding="utf-8")})
        if include_seeds:
            for name, path in c.seeds.items():
                items.append({"id": f"{c.id}:{name}", "card_id": c.id,
                              "title": f"{c.card.title}: seeded fault '{name}'",
                              "code": path.read_text(encoding="utf-8")})
    return items


async def _body(request: Request) -> dict:
    body = await request.json()
    if not isinstance(body, dict):
        raise BadRequest("send a JSON object")
    return body


def register(app: FastAPI, root: Path | None = None) -> None:
    root = root or repo_root()
    s = load_settings(root)
    board = ArduinoCliBoard(root / s.board.arduino_cli, root / s.board.arduino_cli_config,
                            s.board.fqbn, None)
    d = data_dir(root)
    service = CompileService(board, d / "work" / "_weblab")
    trials = d / "weblab" / "upload_trials.jsonl"
    test_mode = os.environ.get("SPROUT_WEBLAB_TEST") == "1"
    cards = load_cards(root)
    tutor = WebTutor(cards, lambda learner: build_tutor(learner, root))

    app.add_static_files("/weblab/static", STATIC, max_cache_age=0)
    if test_mode:
        app.add_static_files("/weblab/test", root / "tests" / "js", max_cache_age=0)

    async def tutor_call(request: Request, fn):
        """Guard, parse, run a WebTutor action in the thread pool; BadRequest becomes a 400."""
        if bad := _guard(request, json_body=True):
            return bad
        body: object = None
        try:
            body = await _body(request)
            return await run_in_threadpool(fn, body)
        except BadRequest as e:
            # Log the reason and the shape of the request (types only, no content) for debugging.
            b = body if isinstance(body, dict) else {}
            shape = {k: type(v).__name__ for k, v in b.items()}
            log.warning("400 %s: %s; fields=%s; learner=%r card_id=%r", request.url.path, e, shape,
                        str(b.get("learner"))[:20], str(b.get("card_id"))[:40])
            return JSONResponse({"error": str(e)}, 400)

    @app.get("/weblab")
    def weblab_page(request: Request):
        return _guard(request) or FileResponse(STATIC / "weblab.html")

    @app.get("/api/weblab/config")
    def weblab_config(request: Request):
        return _guard(request) or {
            "sketches": sketch_list(root, include_seeds=test_mode),
            "cards": {cid: card_view(c) for cid, c in cards.items()},
            "llm_provider": s.llm.provider,
            "compiler_ready": service.available(),
            "known_boards": [{"usbVendorId": v, "usbProductId": p, "name": n}
                             for (v, p), n in KNOWN.items()],
            "default_baud": s.board.baud,
        }

    @app.post("/api/weblab/compile")
    async def weblab_compile(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        try:
            body = await _body(request)
        except BadRequest as e:
            return JSONResponse({"error": str(e)}, 400)
        code = body.get("code")
        reply, result = await run_in_threadpool(service.compile_full, code)
        if result is not None and body.get("learner") and body.get("card_id"):
            try:  # tell the tutor (a compile counts on the hint ladder); never block the reply
                await run_in_threadpool(tutor.record_compile, body["learner"], body["card_id"],
                                        code, result)
            except BadRequest:
                pass
        return reply

    @app.post("/api/weblab/card_open")
    async def weblab_card_open(request: Request):
        def act(b):
            tutor.open_card(b.get("learner"), b.get("card_id"))
            return {"ok": True}
        return await tutor_call(request, act)

    @app.post("/api/weblab/card_leave")
    async def weblab_card_leave(request: Request):
        def act(b):
            tutor.leave_card(b.get("learner"), b.get("card_id"), b.get("code"),
                             b.get("changed") is True)
            return {"ok": True}
        return await tutor_call(request, act)

    @app.post("/api/weblab/upload_done")
    async def weblab_upload_done(request: Request):
        def act(b):
            tutor.record_upload(b.get("learner"), b.get("card_id"), b.get("code"),
                                b.get("ok") is True, str(b.get("error_code") or ""))
            return {"ok": True}
        return await tutor_call(request, act)

    @app.post("/api/weblab/check")
    async def weblab_check(request: Request):
        return await tutor_call(request, lambda b: tutor.check(
            b.get("learner"), b.get("card_id"), b.get("code"), b.get("serial")))

    @app.post("/api/weblab/hint")
    async def weblab_hint(request: Request):
        return await tutor_call(request, lambda b: tutor.hint(
            b.get("learner"), b.get("card_id"), b.get("code"), b.get("serial"),
            b.get("message"), b.get("step_id")))

    @app.post("/api/weblab/trial")
    async def weblab_trial(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        record = clean_trial(await request.json())
        if record is None:
            return JSONResponse({"error": "bad trial record"}, 400)
        await run_in_threadpool(append_trial, trials, record)
        return {"saved": True}
