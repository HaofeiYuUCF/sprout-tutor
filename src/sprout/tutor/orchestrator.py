"""The tutor: known fault → curated hint; unknown → LLM under code-enforced guardrails."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from ..content import Skill
from ..events import EventLogger
from ..progress import ProgressStore
from ..schemas import Fault, Policy
from . import guardrail
from .checks import CheckResult, run_checks
from .context import Context, quote
from .ladder import Ladder
from .llm import LLM, prompt_hash
from .matcher import Match, match_faults

STEP_NAMES = {1: "where", 2: "general check", 3: "specific issue", 4: "fix"}
REPEAT_NUDGE = "Try the last suggestion first, then tell me what you saw. "

# Used when no curated fault matches and the LLM is unavailable or its reply is blocked.
GENERIC = {
    1: "Let's narrow it down. Did the code compile, and does the serial log show what you "
       "expected? If the code runs but the result is wrong, look at the circuit; if not, look at "
       "the code. What do you see?",
    2: "Test one part at a time. Compare each wire with the card's circuit, row by row, and "
       "re-read the card step that matches what you are doing. What did you check?",
    3: "Go back to the card step you are on and compare your sketch and your circuit with it "
       "detail by detail. Note the first thing that differs.",
    4: "Fix the first difference you found, then compile and upload again. If it still fails, "
       "ask your instructor or peer mentor to look with you.",
}


@dataclass
class HintResponse:
    text: str
    step: int
    source: str  # curated | llm | none
    fault_id: str | None = None
    candidates: list[Match] = field(default_factory=list)
    guardrail_reasons: list[str] = field(default_factory=list)
    model_id: str | None = None
    prompt_hash: str | None = None
    latency_ms: int = 0
    detail: dict = field(default_factory=dict)


class Tutor:
    def __init__(self, policy: Policy, llm: LLM, system_prompt: str, skill: Skill,
                 logger: EventLogger, progress: ProgressStore):
        self.policy = policy
        self.llm = llm
        self.system_prompt = system_prompt
        self.skill = skill
        self.logger = logger
        self.progress = progress
        self.ladder = Ladder(policy)

    # ------------------------------------------------------------------ prompts
    def system(self) -> str:
        return build_system(self.system_prompt, self.skill)

    def user_prompt(self, ctx: Context, step: int) -> str:
        return build_user_prompt(ctx, step)

    # ------------------------------------------------------------------ events
    def note(self, ctx: Context, event_type: str, **fields) -> None:
        """Log a student action; actions in policy.unlock_events count as effort."""
        self.ladder.record_effort(ctx.card.id, event_type)
        self.logger.log(event_type, card_id=ctx.card.id, card_version=ctx.card.card.version,
                        step_id=ctx.step_id, code_hash=ctx.code_hash, **fields)

    def checks(self, ctx: Context) -> list[CheckResult]:
        results = run_checks(ctx.card.checks, ctx.compile_result, ctx.serial_lines)
        passed = [r.id for r in results if r.passed]
        self.logger.log("check_result", card_id=ctx.card.id, card_version=ctx.card.card.version,
                        code_hash=ctx.code_hash,
                        detail={r.id: {"passed": r.passed, "detail": r.detail} for r in results})
        self.progress.checks(self.logger.learner_id, ctx.card.id, passed,
                             all(r.passed for r in results))
        return results

    # ------------------------------------------------------------------ hints
    def request_hint(self, ctx: Context) -> HintResponse:
        t0 = time.time()
        self.logger.log("hint_request", card_id=ctx.card.id, card_version=ctx.card.card.version,
                        step_id=ctx.step_id, code_hash=ctx.code_hash,
                        compile_ok=ctx.compile_result.ok if ctx.compile_result else None,
                        compile_error_hash=ctx.compile_error_hash,
                        serial_summary=ctx.serial_summary(), student_text=ctx.student_text or None,
                        photo_findings=ctx.photo_findings or None)
        matches = match_faults(ctx)
        if matches:
            resp = self._curated(ctx, matches)
        else:
            resp = self._llm(ctx)
        resp.latency_ms = int((time.time() - t0) * 1000)
        self.logger.log("hint_shown", card_id=ctx.card.id, card_version=ctx.card.card.version,
                        step_id=ctx.step_id, fault_id=resp.fault_id, ladder_step=resp.step,
                        hint_source=resp.source, model_id=resp.model_id,
                        prompt_hash=resp.prompt_hash,
                        skill_versions={self.skill.name: self.skill.version},
                        latency_ms=resp.latency_ms,
                        detail={"channels": resp.candidates[0].channels if resp.candidates else [],
                                "guardrail": resp.guardrail_reasons, **resp.detail})
        self.progress.hint(self.logger.learner_id, ctx.card.id, resp.step, resp.source)
        return resp

    def _curated(self, ctx: Context, matches: list[Match]) -> HintResponse:
        fault: Fault = matches[0].fault
        decision = self.ladder.decide(ctx.card.id, fault)
        text = fault.hints[decision.step - 1]
        if decision.repeated and decision.step < self.policy.max_step:
            text = REPEAT_NUDGE + text
        self.ladder.record_hint(ctx.card.id, fault, decision.step)
        return HintResponse(text, decision.step, "curated", fault.id, matches)

    def _llm(self, ctx: Context) -> HintResponse:
        decision = self.ladder.decide(ctx.card.id, None)
        step = decision.step
        system, user = self.system(), self.user_prompt(ctx, step)
        reference = ctx.card.reference.read_text(encoding="utf-8")
        self.ladder.record_hint(ctx.card.id, None, step)
        try:
            reply = self.llm.generate(system, user)
        except Exception as e:  # network, auth, quota: fall back to a generic curated step
            return HintResponse(GENERIC[step], step, "curated", None, [], ["llm_error"],
                                detail={"llm_error": type(e).__name__})
        g = guardrail.apply(reply.text or GENERIC[step], reference, self.policy)
        fallback = g.blocked or not reply.text
        text = GENERIC[step] if fallback else g.text
        if decision.repeated and step < self.policy.max_step:
            text = REPEAT_NUDGE + text
        return HintResponse(
            text, step, "curated" if fallback else "llm", None, [], g.reasons, reply.model_id,
            prompt_hash(reply.model_id, system, user),
            detail={"stop_reason": reply.stop_reason, "cached": reply.cached,
                    "raw_reply_chars": len(reply.text), "llm_fallback_to_generic": fallback})


def load_prompt(root: Path) -> str:
    return (root / "prompts" / "tutor_system.md").read_text(encoding="utf-8")


def build_system(system_prompt: str, skill: Skill) -> str:
    return f"{system_prompt.strip()}\n\n# Skill: {skill.name}\n\n{skill.body}"


def build_user_prompt(ctx: Context, step: int) -> str:
    card = ctx.card.card
    current = next((s for s in card.steps if s.id == ctx.step_id), None)
    compiler = "\n".join(ctx.compiler_messages()) or "compiled OK or not compiled yet"
    return "\n\n".join([
        f"Card: {card.title} ({card.id})",
        f"Card step: {current.text if current else 'not specified'}",
        f"Allowed hint step: {step} ({STEP_NAMES[step]})",
        quote("student_code", ctx.code),
        quote("compiler_output", compiler),
        quote("serial_log", "\n".join(ctx.serial_lines[-15:]) or "no serial output"),
        quote("student_message", ctx.student_text or "(no message)"),
        "Write one hint at the allowed step.",
    ])
