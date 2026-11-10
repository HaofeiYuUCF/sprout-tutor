"""HTTP routes for the Web Lab, added to NiceGUI's FastAPI app.

Requests must come from this machine's own page: the Host must be localhost/127.0.0.1 (stops DNS
rebinding) and the body must be JSON (a cross-site page cannot send JSON without a CORS preflight,
which this server never approves).
"""

from __future__ import annotations

import base64
import logging
import os
import re
import time
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
from .public import CappedLLM, DailyCap, RateLimiter, Roster, allowed_hosts, env_int, flag, public_mode
from .tutor_api import BadRequest, WebTutor, card_view

STATIC = Path(__file__).parent / "static"
# The page must be re-checked on every visit. Without this header a browser may keep an old copy
# of the page for a while after a deploy and run it with the new scripts, which breaks it.
FRESH = {"Cache-Control": "no-cache"}
log = logging.getLogger("sprout.weblab")
MAX_PHOTO_BYTES = 8_000_000
SAFE_NAME = re.compile(r"^[a-z0-9_]{1,40}$")


def is_local(request: Request) -> bool:
    """The request comes from this site's own pages: Host (and Origin, if sent) is localhost or a
    host listed in SPROUT_ALLOWED_HOSTS. Stops DNS rebinding and cross-site requests."""
    hosts = allowed_hosts()
    host = request.headers.get("host", "").rsplit(":", 1)[0].strip("[]").lower()
    origin = request.headers.get("origin")
    if origin:
        origin_host = origin.split("://", 1)[-1].rsplit(":", 1)[0].lower()
        if origin_host not in hosts:
            return False
    return host in hosts


def client_key(request: Request) -> str:
    """Client address for rate limits (behind the HTTPS proxy, the first X-Forwarded-For entry)."""
    if flag("SPROUT_TRUST_PROXY"):
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


BUSY = "Too many requests in a short time. Wait a moment and try again."


def too_many(message: str = BUSY) -> JSONResponse:
    return JSONResponse({"error": message}, 429)


def _guard(request: Request, json_body: bool = False) -> JSONResponse | None:
    if not is_local(request):
        return JSONResponse({"error": "This site only answers requests from its own pages."}, 403)
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
    public = public_mode()
    test_mode = os.environ.get("SPROUT_WEBLAB_TEST") == "1" and not public   # never on a public site
    photos = not public or flag("SPROUT_PHOTOS")
    # Photo wiring check: needs the AI service. On by default; SPROUT_PHOTO_CHECK=0 turns it off.
    photo_check = s.llm.provider == "anthropic" and os.environ.get("SPROUT_PHOTO_CHECK", "1") != "0"
    photo_keep = flag("SPROUT_PHOTO_KEEP")      # store checked photos (pilot studies, with consent)
    cards = load_cards(root)
    roster = Roster(Path(os.environ.get("SPROUT_ROSTER") or d / "roster.txt"), d / "guests.txt",
                    public, flag("SPROUT_GUEST"))
    ai_cap = DailyCap(env_int("SPROUT_AI_PER_DAY", 30))

    def make_tutor(learner: str):
        t = build_tutor(learner, root)
        if public:
            t.llm = CappedLLM(t.llm, ai_cap, learner)   # curated hints never reach the LLM
        return t

    tutor = WebTutor(cards, make_tutor, d, allowed=roster.allowed,
                     is_guest=lambda code: code in roster.guests)
    # Shown to guests who are interested in Grow (an address or a link); empty = not shown.
    grow_contact = os.environ.get("SPROUT_GROW_CONTACT", "").strip()[:200]
    compile_limit = RateLimiter(env_int("SPROUT_COMPILE_PER_MIN", 20), 60)
    hint_limit = RateLimiter(env_int("SPROUT_HINT_PER_MIN", 10), 60)
    api_limit = RateLimiter(env_int("SPROUT_API_PER_MIN", 300), 60)
    guest_limit = RateLimiter(env_int("SPROUT_GUESTS_PER_HOUR", 10), 3600)
    photo_limit = RateLimiter(env_int("SPROUT_PHOTO_PER_MIN", 20), 60)
    photo_cap = DailyCap(env_int("SPROUT_PHOTO_PER_DAY", 15))      # per student code

    app.add_static_files("/weblab/static", STATIC, max_cache_age=0)
    if test_mode:
        app.add_static_files("/weblab/test", root / "tests" / "js", max_cache_age=0)

    async def tutor_call(request: Request, fn):
        """Guard, parse, run a WebTutor action in the thread pool; BadRequest becomes a 400."""
        if bad := _guard(request, json_body=True):
            return bad
        if not api_limit.allow(client_key(request)):
            return too_many()
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

    @app.get("/healthz")
    def healthz():
        """For the hosting platform's health check (no guard: it calls from an internal address)."""
        return {"ok": True, "compiler": service.available(), "cards": len(cards)}

    @app.get("/weblab")
    def weblab_page(request: Request):
        return _guard(request) or FileResponse(STATIC / "weblab.html", headers=FRESH)

    @app.get("/weblab/board")
    def board_page(request: Request):
        """Get to know your board: a 3D model of the UNO with clickable parts."""
        return _guard(request) or FileResponse(STATIC / "board.html", headers=FRESH)

    @app.get("/weblab/signals")
    def signals_page(request: Request):
        """How parts talk to your board: digital, analog, serial; other ways named only."""
        return _guard(request) or FileResponse(STATIC / "signals.html", headers=FRESH)

    @app.get("/weblab/camera")
    def camera_page(request: Request):
        if not photos:
            return JSONResponse({"error": "not available on this site"}, 404)
        return _guard(request) or FileResponse(STATIC / "camera.html", headers=FRESH)

    @app.post("/api/weblab/photo")
    async def weblab_photo(request: Request):
        """Save one JPEG from the camera page under data/photos/<learner>/<card>/ (local test only)."""
        if not photos:
            return JSONResponse({"error": "not available on this site"}, 404)
        if bad := _guard(request, json_body=True):
            return bad
        body = await request.json()
        if not isinstance(body, dict):
            return JSONResponse({"error": "send a JSON object"}, 400)
        image = body.get("image")
        prefix = "data:image/jpeg;base64,"
        if not isinstance(image, str) or not image.startswith(prefix):
            return JSONResponse({"error": "image must be a JPEG data URL"}, 400)
        try:
            data = base64.b64decode(image[len(prefix):], validate=True)
        except ValueError:
            return JSONResponse({"error": "bad image data"}, 400)
        if len(data) > MAX_PHOTO_BYTES or data[:2] != b"\xff\xd8":
            return JSONResponse({"error": "not a JPEG, or larger than 8 MB"}, 400)
        learner = body.get("learner") if isinstance(body.get("learner"), str) else "test"
        card = body.get("card_id") if isinstance(body.get("card_id"), str) else "none"
        if not SAFE_NAME.match(learner) or not SAFE_NAME.match(card):
            return JSONResponse({"error": "bad learner or card name"}, 400)
        folder = d / "photos" / learner / card
        name = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}.jpg"
        await run_in_threadpool(lambda: (folder.mkdir(parents=True, exist_ok=True),
                                         (folder / name).write_bytes(data)))
        return {"saved": f"data/photos/{learner}/{card}/{name}", "bytes": len(data)}

    @app.get("/api/weblab/config")
    def weblab_config(request: Request):
        return _guard(request) or {
            "sketches": sketch_list(root, include_seeds=test_mode),
            "cards": {cid: card_view(c) for cid, c in cards.items()},
            "llm_provider": s.llm.provider,
            "test_mode": test_mode,
            "public": public,
            "roster_required": roster.required,
            "guest_allowed": roster.guests_enabled,
            "compiler_ready": service.available(),
            "photo_check": photo_check,
            "grow_contact": grow_contact,
            "photo_kept": photo_check and photo_keep,
            "known_boards": [{"usbVendorId": v, "usbProductId": p, "name": n}
                             for (v, p), n in KNOWN.items()],
            "default_baud": s.board.baud,
        }

    @app.post("/api/weblab/signin")
    async def weblab_signin(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        if not api_limit.allow(client_key(request)):
            return too_many()
        body = await request.json()
        code = str(body.get("learner", "")).strip().lower() if isinstance(body, dict) else ""
        if not roster.allowed(code):
            return JSONResponse({"error": "This code is not on the class list. "
                                          "Check it with your instructor."}, 403)
        return {"ok": True}

    @app.post("/api/weblab/guest")
    async def weblab_guest(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        if not roster.guests_enabled:
            return JSONResponse({"error": "Guest access is off on this site."}, 403)
        if not guest_limit.allow(client_key(request)):
            return too_many("Too many guest codes from this network. Try again later.")
        return {"learner": await run_in_threadpool(roster.new_guest)}

    @app.post("/api/weblab/compile")
    async def weblab_compile(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        if not compile_limit.allow(client_key(request)):
            msg = "You checked your code many times in a minute. Wait a moment, then try again."
            return {"ok": False, "errors": [{"line": 0, "message": msg}], "hex": None,
                    "flash_bytes": None, "flash_max": None, "compile_ms": 0}
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
            b.get("learner"), b.get("card_id"), b.get("code"), b.get("serial"),
            b.get("source", "board")))

    @app.post("/api/weblab/sim_run")
    async def weblab_sim_run(request: Request):
        def act(b):
            tutor.record_sim_run(b.get("learner"), b.get("card_id"), b.get("code"))
            return {"ok": True}
        return await tutor_call(request, act)

    @app.post("/api/weblab/work")
    async def weblab_work(request: Request):
        return await tutor_call(request, lambda b: tutor.load_work(b.get("learner"), b.get("card_id")))

    @app.post("/api/weblab/save")
    async def weblab_save(request: Request):
        return await tutor_call(request, lambda b: tutor.save_work(
            b.get("learner"), b.get("card_id"), b.get("code"), b.get("sim"), b.get("reflection")))

    @app.post("/api/weblab/learn")
    async def weblab_learn(request: Request):
        def act(b):
            tutor.record_learning(b.get("learner"), b.get("card_id"), b.get("kind"), b.get("item"),
                                  b.get("correct"))
            return {"ok": True}
        return await tutor_call(request, act)

    @app.post("/api/weblab/progress")
    async def weblab_progress(request: Request):
        return await tutor_call(request, lambda b: tutor.progress_summary(b.get("learner")))

    @app.post("/api/weblab/grow_interest")
    async def weblab_grow_interest(request: Request):
        return await tutor_call(request, lambda b: tutor.grow_interest(b.get("learner"), b.get("answer")))

    @app.post("/api/weblab/discard")
    async def weblab_discard(request: Request):
        def act(b):
            tutor.discard_work(b.get("learner"), b.get("card_id"))
            return {"ok": True}
        return await tutor_call(request, act)

    @app.post("/api/weblab/hint")
    async def weblab_hint(request: Request):
        if not hint_limit.allow(client_key(request)):
            return too_many("You asked for many hints in a minute. Try the last hint, then ask again.")
        return await tutor_call(request, lambda b: tutor.hint(
            b.get("learner"), b.get("card_id"), b.get("code"), b.get("serial"),
            b.get("message"), b.get("step_id")))

    @app.post("/api/weblab/photo_check")
    async def weblab_photo_check(request: Request):
        if not photo_check:
            return JSONResponse({"error": "not available on this site"}, 404)
        if not photo_limit.allow(client_key(request)):
            return too_many("Many photos were checked in the last minute. Wait a moment, then try again.")

        def act(b):
            image = b.get("image")
            prefix = "data:image/jpeg;base64,"
            if not isinstance(image, str) or not image.startswith(prefix):
                raise BadRequest("image must be a JPEG data URL")
            try:
                data = base64.b64decode(image[len(prefix):], validate=True)
            except ValueError:
                raise BadRequest("bad image data") from None
            learner = b.get("learner")
            if isinstance(learner, str) and not photo_cap.take(learner):
                return {"ok": False, "flags": [], "message":
                        "You have used today's photo checks. Compare your board with the wiring "
                        "picture by eye, or ask your instructor."}
            return tutor.photo_check(learner, b.get("card_id"), data, keep=photo_keep)
        return await tutor_call(request, act)

    @app.post("/api/weblab/photo_feedback")
    async def weblab_photo_feedback(request: Request):
        def act(b):
            tutor.photo_feedback(b.get("learner"), b.get("card_id"), b.get("photo_id"), b.get("verdict"))
            return {"ok": True}
        return await tutor_call(request, act)

    @app.post("/api/weblab/trial")
    async def weblab_trial(request: Request):
        if bad := _guard(request, json_body=True):
            return bad
        record = clean_trial(await request.json())
        if record is None:
            return JSONResponse({"error": "bad trial record"}, 400)
        await run_in_threadpool(append_trial, trials, record)
        return {"saved": True}
