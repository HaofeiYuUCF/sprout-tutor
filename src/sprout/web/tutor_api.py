"""The tutor behind the Web Lab: the same Tutor core as the desktop workbench, driven by HTTP.

The browser sends what it has (code, recent serial lines, the student's message); the server
keeps each learner's compile result and hint-ladder state, so ladder rules, guardrails and the
API key never leave the server.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..content import CardBundle
from ..hardware.board import CompileResult
from ..tutor.checks import run_checks
from ..tutor.context import Context, code_hash
from ..tutor.orchestrator import STEP_NAMES, Tutor
from ..workspace import read_sketch, sketch_dir, write_sketch

LEARNER_ID = re.compile(r"^l_[a-z0-9]{3,12}$")
MAX_SERIAL_LINES = 300
MAX_LINE_CHARS = 300
MAX_MESSAGE_CHARS = 1000
MAX_CODE_CHARS = 64_000
MAX_SIM_CHARS = 20_000
SOURCES = ("board", "sim")
SOURCE_LABEL = {"curated": "instructor hint", "llm": "AI tutor", "generic": "general advice",
                "none": "tutor"}


class BadRequest(ValueError):
    """The browser sent something the tutor cannot use (shown to the developer, not the student)."""


def clean_serial(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    lines = [str(x)[:MAX_LINE_CHARS] for x in raw if isinstance(x, str)]
    return lines[-MAX_SERIAL_LINES:]


def card_view(c: CardBundle) -> dict:
    card = c.card
    return {"id": card.id, "title": card.title, "stage": card.stage,
            "agriculture_connection": card.agriculture_connection, "safety": card.safety,
            "learning_objectives": card.learning_objectives,
            "parts": [f"{p.qty} × {p.name}" for p in card.parts],
            "tinkercad": card.tinkercad.note,
            "steps": [{"id": s.id, "kind": s.kind, "text": s.text} for s in card.steps]}


@dataclass
class _Learner:
    tutor: Tutor
    compile_result: CompileResult | None = None
    compiled_hash: str | None = None
    last_hash: str | None = None  # last code the tutor saw, to notice edits


class WebTutor:
    """Per-learner tutors and compile results. Thread-safe: routes run in a thread pool."""

    def __init__(self, cards: dict[str, CardBundle], make_tutor: Callable[[str], Tutor],
                 data_dir: Path | None = None):
        self.cards = cards
        self.make_tutor = make_tutor
        self.data_dir = data_dir  # saved work: data/work/<learner>/<card>/
        self._learners: dict[str, _Learner] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ helpers
    def _learner(self, learner_id: object) -> _Learner:
        if not isinstance(learner_id, str) or not LEARNER_ID.match(learner_id):
            raise BadRequest("learner must look like l_ab12")
        with self._lock:
            if learner_id not in self._learners:
                self._learners[learner_id] = _Learner(self.make_tutor(learner_id))
            return self._learners[learner_id]

    def _card(self, card_id: object) -> CardBundle:
        if not isinstance(card_id, str) or card_id not in self.cards:
            raise BadRequest("unknown card")
        return self.cards[card_id]

    def _context(self, lr: _Learner, card: CardBundle, code: object, serial: object = None,
                 message: str = "", step_id: object = None) -> Context:
        if not isinstance(code, str):
            raise BadRequest("code must be text")
        h = code_hash(code)
        result = lr.compile_result if lr.compiled_hash == h else None  # stale results are ignored
        step = step_id if isinstance(step_id, str) and any(s.id == step_id for s in card.card.steps) \
            else None
        ctx = Context(card, code, result, clean_serial(serial), message, step_id=step)
        if lr.last_hash is not None and h != lr.last_hash:
            lr.tutor.note(ctx, "code_edit")  # an edit counts as effort on the hint ladder
        lr.last_hash = h
        return ctx

    # ------------------------------------------------------------------ actions
    def open_card(self, learner_id: object, card_id: object) -> None:
        lr, card = self._learner(learner_id), self._card(card_id)
        lr.compile_result = lr.compiled_hash = lr.last_hash = None
        lr.tutor.progress.opened(lr.tutor.logger.learner_id, card.id)
        lr.tutor.logger.log("card_open", card_id=card.id, card_version=card.card.version,
                            detail={"client": "weblab"})

    def leave_card(self, learner_id: object, card_id: object, code: object, changed: bool) -> None:
        """The student went back to the card list, discarding their code (logged for evaluation)."""
        lr, card = self._learner(learner_id), self._card(card_id)
        lr.tutor.logger.log("card_leave", card_id=card.id, card_version=card.card.version,
                            code_hash=code_hash(code) if isinstance(code, str) else None,
                            detail={"changed": bool(changed), "client": "weblab"})
        lr.compile_result = lr.compiled_hash = lr.last_hash = None

    def record_compile(self, learner_id: object, card_id: object, code: str,
                       result: CompileResult) -> None:
        lr, card = self._learner(learner_id), self._card(card_id)
        lr.compile_result, lr.compiled_hash = result, code_hash(code)
        ctx = self._context(lr, card, code)
        lr.tutor.note(ctx, "compile", compile_ok=result.ok, compile_error_hash=ctx.compile_error_hash)

    def record_upload(self, learner_id: object, card_id: object, code: object, ok: bool,
                      error_code: str = "") -> None:
        lr, card = self._learner(learner_id), self._card(card_id)
        ctx = self._context(lr, card, code)
        lr.tutor.note(ctx, "upload", detail={"ok": bool(ok), "error_code": error_code[:40],
                                             "client": "weblab"})

    def check(self, learner_id: object, card_id: object, code: object, serial: object,
              source: object = "board") -> dict:
        """Run the card's checks. Only real-board output completes a card; a simulator pass is
        logged with source "sim" and tells the student to build it on the board next."""
        lr, card = self._learner(learner_id), self._card(card_id)
        if source not in SOURCES:
            raise BadRequest("source must be board or sim")
        ctx = self._context(lr, card, code, serial)
        if source == "board":
            results = lr.tutor.checks(ctx)
        else:
            results = run_checks(card.checks, ctx.compile_result, ctx.serial_lines)
            lr.tutor.logger.log("check_result", card_id=card.id, card_version=card.card.version,
                                code_hash=ctx.code_hash,
                                detail={"source": "sim",
                                        **{r.id: {"passed": r.passed, "detail": r.detail} for r in results}})
        return {"results": [{"id": r.id, "passed": r.passed, "detail": r.detail} for r in results],
                "all_passed": all(r.passed for r in results), "source": source,
                "completes_card": source == "board"}

    def record_sim_run(self, learner_id: object, card_id: object, code: object) -> None:
        lr, card = self._learner(learner_id), self._card(card_id)
        ctx = self._context(lr, card, code)
        lr.tutor.logger.log("sim_run", card_id=card.id, card_version=card.card.version,
                            code_hash=ctx.code_hash, detail={"client": "weblab"})

    # ------------------------------------------------------------------ saved work
    def _work_dir(self, learner_id: object, card_id: object) -> Path:
        self._learner(learner_id)  # validates the ID (it becomes a folder name)
        card = self._card(card_id)
        if self.data_dir is None:
            raise BadRequest("saving is not configured")
        return sketch_dir(self.data_dir, learner_id, card.id)  # type: ignore[arg-type]

    def load_work(self, learner_id: object, card_id: object) -> dict:
        d = self._work_dir(learner_id, card_id)
        code = read_sketch(self.data_dir, learner_id, card_id)  # type: ignore[arg-type]
        sim = None
        if (d / "sim.json").exists():
            try:
                sim = json.loads((d / "sim.json").read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                sim = None
        return {"code": code, "sim": sim}

    def save_work(self, learner_id: object, card_id: object, code: object = None,
                  sim: object = None) -> dict:
        d = self._work_dir(learner_id, card_id)
        if code is not None:
            if not isinstance(code, str) or len(code) > MAX_CODE_CHARS:
                raise BadRequest("code must be text under 64 kB")
            write_sketch(self.data_dir, learner_id, card_id, code)  # type: ignore[arg-type]
        if sim is not None:
            text = json.dumps(sim, ensure_ascii=False)
            if not isinstance(sim, dict) or len(text) > MAX_SIM_CHARS:
                raise BadRequest("sim must be a small JSON object")
            d.mkdir(parents=True, exist_ok=True)
            (d / "sim.json").write_text(text, encoding="utf-8")
        return {"saved": True}

    def discard_work(self, learner_id: object, card_id: object) -> None:
        """Start over: delete the saved code and wiring (logged)."""
        lr, card = self._learner(learner_id), self._card(card_id)
        d = self._work_dir(learner_id, card_id)
        if d.exists():
            shutil.rmtree(d)
        lr.compile_result = lr.compiled_hash = lr.last_hash = None
        lr.tutor.logger.log("work_discard", card_id=card.id, card_version=card.card.version,
                            detail={"client": "weblab"})

    def hint(self, learner_id: object, card_id: object, code: object, serial: object,
             message: object = "", step_id: object = None) -> dict:
        lr, card = self._learner(learner_id), self._card(card_id)
        text = message[:MAX_MESSAGE_CHARS].strip() if isinstance(message, str) else ""
        ctx = self._context(lr, card, code, serial, text, step_id)
        if text:  # counts as effort only if the previous hint asked a question (see Ladder)
            lr.tutor.note(ctx, "answered_question")
        resp = lr.tutor.request_hint(ctx)
        return {"text": resp.text, "step": resp.step, "step_name": STEP_NAMES[resp.step],
                "max_step": lr.tutor.policy.max_step, "source": resp.source,
                "source_label": SOURCE_LABEL.get(resp.source, "tutor"), "fault_id": resp.fault_id}
