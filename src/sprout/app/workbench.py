"""Student workbench page: card steps · code editor · compile/upload · serial plot · tutor panel."""

from __future__ import annotations

from nicegui import run, ui

from ..config import data_dir, repo_root
from ..content import load_cards
from ..hardware.board import Board, CompileResult
from ..tutor.checks import CheckResult
from ..tutor.context import Context, code_hash, parse_field
from ..tutor.orchestrator import STEP_NAMES, Tutor
from ..workspace import read_sketch, write_sketch

PLOT_FIELDS = ("temp_c",)


class Session:
    """Per-browser-tab state for one learner working on one card."""

    def __init__(self, learner_id: str, tutor: Tutor, board: Board):
        self.learner_id = learner_id
        self.tutor = tutor
        self.board = board
        self.cards = load_cards(repo_root())
        self.card = self.cards[sorted(self.cards)[0]]
        self.compile_result: CompileResult | None = None
        self.serial: list[str] = []
        self.last_noted_hash: str | None = None
        self.step_id: str | None = None

    def code_for(self, card_id: str) -> str:
        saved = read_sketch(data_dir(), self.learner_id, card_id)
        return saved if saved is not None else self.cards[card_id].starter.read_text(encoding="utf-8")

    def context(self, code: str, student_text: str = "") -> Context:
        return Context(self.card, code, self.compile_result, list(self.serial), student_text,
                       step_id=self.step_id)


def build_page(session: Session) -> None:
    ui.add_head_html("<style>.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}</style>")

    with ui.header().classes("items-center justify-between bg-green-8"):
        ui.label("SPROUT workbench").classes("text-h6")
        status = ui.label(session.board.status()).classes("text-caption")

    with ui.row().classes("w-full no-wrap items-start gap-4"):
        # ---------------------------------------------------------------- card column
        with ui.column().classes("w-1/4 min-w-[260px]"):
            card_select = ui.select({cid: f"{b.card.title}" for cid, b in session.cards.items()},
                                    value=session.card.id, label="Card")
            card_box = ui.column().classes("w-full")

        # ---------------------------------------------------------------- code column
        with ui.column().classes("w-1/2 min-w-[420px]"):
            editor = ui.codemirror(session.code_for(session.card.id), language="C++").classes(
                "w-full h-[340px] border")
            with ui.row():
                compile_btn = ui.button("Compile", icon="build")
                upload_btn = ui.button("Upload", icon="upload")
                check_btn = ui.button("Check my work", icon="task_alt").props("outline")
                ui.button("Reset to starter", on_click=lambda: reset_starter()).props("flat")
            compiler_out = ui.label("").classes("mono text-red-9 whitespace-pre-wrap")
            ui.label("Serial log").classes("text-subtitle2")
            serial_log = ui.log(max_lines=200).classes("w-full h-[140px] mono")
            chart = ui.echart({
                "xAxis": {"type": "category", "data": []},
                "yAxis": {"type": "value", "name": "temp_c"},
                "series": [{"type": "line", "data": [], "showSymbol": False}],
                "grid": {"left": 40, "right": 10, "top": 30, "bottom": 20},
            }).classes("w-full h-[180px]")

        # ---------------------------------------------------------------- tutor column
        with ui.column().classes("w-1/4 min-w-[260px]"):
            ui.label("Tutor").classes("text-subtitle1")
            question = ui.textarea(label="What do you see? What did you expect?").classes("w-full")
            ask_btn = ui.button("Ask for help", icon="support_agent").classes("w-full")
            hints_box = ui.column().classes("w-full")
            ui.separator()
            ui.label("Checks").classes("text-subtitle2")
            checks_box = ui.column().classes("w-full")

    # -------------------------------------------------------------------- behaviour
    def render_card() -> None:
        card_box.clear()
        c = session.card.card
        with card_box:
            ui.label(c.title).classes("text-h6")
            ui.label(c.agriculture_connection).classes("text-caption text-green-9")
            for warn in c.safety:
                ui.label(f"⚠ {warn}").classes("text-caption text-orange-9")
            with ui.expansion("Learning objectives").classes("w-full"):
                for o in c.learning_objectives:
                    ui.label(f"• {o}").classes("text-body2")
            for i, step in enumerate(c.steps, 1):
                with ui.expansion(f"{i}. {step.kind.capitalize()}",
                                  on_value_change=lambda e, s=step.id: set_step(s, e.value)
                                  ).classes("w-full"):
                    ui.markdown(step.text)
                    if step.kind == "simulate":
                        ui.markdown(f"*Tinkercad:* {c.tinkercad.note}").classes("text-caption")

    def set_step(step_id: str, opened: bool) -> None:
        if opened:
            session.step_id = step_id

    def change_card(e) -> None:
        save_code()
        session.card = session.cards[e.value]
        session.compile_result, session.serial = None, []
        editor.value = session.code_for(session.card.id)
        serial_log.clear()
        hints_box.clear()
        checks_box.clear()
        render_card()
        session.tutor.progress.opened(session.learner_id, session.card.id)
        session.tutor.logger.log("card_open", card_id=session.card.id,
                                 card_version=session.card.card.version)

    def save_code() -> str:
        code = editor.value or ""
        write_sketch(data_dir(), session.learner_id, session.card.id, code)
        h = code_hash(code)
        if session.last_noted_hash and h != session.last_noted_hash:
            session.tutor.note(session.context(code), "code_edit")
        session.last_noted_hash = h
        return code

    def reset_starter() -> None:
        editor.value = session.card.starter.read_text(encoding="utf-8")

    async def do_compile() -> CompileResult:
        code = save_code()
        compile_btn.props("loading")
        sk = write_sketch(data_dir(), session.learner_id, session.card.id, code)
        r = await run.io_bound(session.board.compile, sk)
        compile_btn.props(remove="loading")
        session.compile_result = r
        compiler_out.text = "Compiled OK" if r.ok else "\n".join(
            f"line {d.line}: {d.message}" for d in r.errors) or r.raw_error
        compiler_out.classes(replace="mono whitespace-pre-wrap " + ("text-green-9" if r.ok else "text-red-9"))
        session.tutor.note(session.context(code), "compile", compile_ok=r.ok,
                           compile_error_hash=session.context(code).compile_error_hash)
        return r

    async def do_upload() -> None:
        r = await do_compile()
        if not r.ok:
            return
        upload_btn.props("loading")
        sk = write_sketch(data_dir(), session.learner_id, session.card.id, editor.value or "")
        u = await run.io_bound(session.board.upload, sk)
        upload_btn.props(remove="loading")
        session.serial = []
        serial_log.clear()
        session.tutor.note(session.context(editor.value or ""), "upload",
                           detail={"ok": u.ok, "message": u.message[:300]})
        ui.notify("Uploaded" if u.ok else f"Upload failed: {u.message[:200]}",
                  type="positive" if u.ok else "negative")

    def do_check() -> None:
        results: list[CheckResult] = session.tutor.checks(session.context(editor.value or ""))
        checks_box.clear()
        with checks_box:
            for r in results:
                ui.label(f"{'✅' if r.passed else '⬜'} {r.id}: {r.detail}").classes("text-body2")
            if all(r.passed for r in results):
                ui.label("Card complete. Go on to the Reflect step.").classes("text-positive")

    def do_ask() -> None:
        code = save_code()
        resp = session.tutor.request_hint(session.context(code, question.value or ""))
        if question.value:
            session.tutor.note(session.context(code), "answered_question")
        with hints_box:
            with ui.card().classes("w-full"):
                src = "tutor (curated)" if resp.source == "curated" else "tutor (AI)"
                ui.label(f"Step {resp.step}: {STEP_NAMES[resp.step]} · {src}").classes(
                    "text-caption text-grey-8")
                ui.markdown(resp.text)
        question.value = ""

    def poll_serial() -> None:
        status.text = session.board.status()
        lines = [ln.text for ln in session.board.recent_serial(120)]
        new = lines[len(session.serial):] if lines[: len(session.serial)] == session.serial else lines
        if not new:
            return
        if new is lines:
            serial_log.clear()
        for ln in new:
            serial_log.push(ln)
        session.serial = lines[-300:]
        for f in PLOT_FIELDS:
            values = parse_field(session.serial, f)
            if values:
                chart.options["yAxis"]["name"] = f
                chart.options["xAxis"]["data"] = list(range(len(values[-60:])))
                chart.options["series"][0]["data"] = values[-60:]
                chart.update()
                break

    card_select.on_value_change(change_card)
    compile_btn.on_click(do_compile)
    upload_btn.on_click(do_upload)
    check_btn.on_click(do_check)
    ask_btn.on_click(do_ask)
    ui.timer(0.5, poll_serial)
    render_card()
    session.tutor.progress.opened(session.learner_id, session.card.id)
