"""Guardrails enforced in code on every LLM reply (prompt instructions alone leak solutions)."""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

from ..schemas import Policy
from .context import strip_comments

FENCE = re.compile(r"```[a-zA-Z0-9_+-]*\n(.*?)```", re.S)
CODE_REMOVED = "[code removed: try writing this part yourself, then ask again if you are stuck]"
BLOCKED = (
    "Let's work through this step by step instead of looking at a finished sketch. "
    "Tell me what you expected to happen and what you see now."
)


@dataclass
class GuardrailResult:
    text: str
    blocked: bool
    reasons: list[str] = field(default_factory=list)


def _norm_lines(code: str) -> list[str]:
    lines = []
    for ln in strip_comments(code).splitlines():
        ln = re.sub(r"\s+", "", ln)
        if ln and ln not in ("{", "}", "};"):
            lines.append(ln)
    return lines


def reference_coverage(reply: str, reference: str) -> float:
    """Share of the reference's significant lines that appear in the reply (whitespace-blind)."""
    ref = _norm_lines(reference)
    if not ref:
        return 0.0
    reply_norm = re.sub(r"\s+", "", strip_comments(reply))
    return sum(1 for ln in ref if ln in reply_norm) / len(ref)


def block_similarity(reply: str, reference: str) -> float:
    """Highest similarity between any fenced code block and the reference."""
    ref = "\n".join(_norm_lines(reference))
    best = 0.0
    for block in FENCE.findall(reply):
        best = max(best, difflib.SequenceMatcher(None, "\n".join(_norm_lines(block)), ref).ratio())
    return best


def strip_long_code(text: str, max_lines: int) -> tuple[str, bool]:
    removed = False

    def repl(m: re.Match) -> str:
        nonlocal removed
        if len([ln for ln in m.group(1).splitlines() if ln.strip()]) > max_lines:
            removed = True
            return CODE_REMOVED
        return m.group(0)

    return FENCE.sub(repl, text), removed


def cap_words(text: str, max_words: int) -> tuple[str, bool]:
    words = text.split()
    if len(words) <= max_words:
        return text, False
    return " ".join(words[:max_words]) + " …", True


def apply(text: str, reference: str, policy: Policy) -> GuardrailResult:
    reasons: list[str] = []
    if (reference_coverage(text, reference) >= policy.reference_similarity_max
            or block_similarity(text, reference) >= policy.reference_similarity_max):
        return GuardrailResult(BLOCKED, True, ["resembles_reference_solution"])
    text, removed = strip_long_code(text, policy.max_code_lines)
    if removed:
        reasons.append("long_code_removed")
    text, capped = cap_words(text, policy.reply_max_words)
    if capped:
        reasons.append("word_cap")
    return GuardrailResult(text, False, reasons)
