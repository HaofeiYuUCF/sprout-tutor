"""Guardrails enforced in code on every LLM reply (prompt instructions alone leak solutions)."""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

from ..schemas import Policy
from .context import strip_comments

FENCE = re.compile(r"```[a-zA-Z0-9_+-]*\s*\n?(.*?)```", re.S)
INLINE = re.compile(r"`([^`\n]+)`")
STATEMENT = re.compile(r"[;{]\s*$")
CODE_REMOVED = "[code removed: try writing this part yourself, then ask again if you are stuck]"
BLOCKED = (
    "Let's work through this step by step instead of looking at a finished sketch. "
    "Tell me what you expected to happen and what you see now."
)
# Lines present in every sketch; they say nothing about whether a solution leaked.
BOILERPLATE = re.compile(r"^(voidsetup\(\)\{|voidloop\(\)\{|delay\(\d+\);|Serial\.begin\(\d+\);)$")


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


def solution_lines(reference: str, student_code: str = "") -> list[str]:
    """Distinct, non-boilerplate reference lines the student has not already written."""
    have = set(_norm_lines(student_code))
    out = []
    for ln in dict.fromkeys(_norm_lines(reference)):
        if not BOILERPLATE.match(ln) and ln not in have:
            out.append(ln)
    return out


def reference_coverage(reply: str, reference: str, student_code: str = "") -> float:
    """Share of the solution lines the student still has to write that appear in the reply."""
    target = solution_lines(reference, student_code)
    if not target:
        return 0.0
    reply_norm = re.sub(r"\s+", "", reply)
    return sum(1 for ln in target if ln in reply_norm) / len(target)


def block_similarity(reply: str, reference: str) -> float:
    """Highest similarity between any fenced code block and the reference."""
    ref = "\n".join(_norm_lines(reference))
    best = 0.0
    for block in FENCE.findall(reply):
        best = max(best, difflib.SequenceMatcher(None, "\n".join(_norm_lines(block)), ref).ratio())
    return best


def count_statements(text: str) -> int:
    """Statement-like lines anywhere: fenced blocks, inline code spans, or bare lines."""
    n = 0
    for block in FENCE.findall(text):
        n += sum(1 for ln in block.splitlines() if STATEMENT.search(ln.strip()))
    outside = FENCE.sub("", text)
    n += sum(1 for span in INLINE.findall(outside) if STATEMENT.search(span.strip()))
    no_inline = INLINE.sub("", outside)
    n += sum(1 for ln in no_inline.splitlines()
             if STATEMENT.search(ln.strip()) and re.search(r"\w+\s*\(.*\)", ln))
    return n


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
    out = " ".join(words[:max_words]) + " …"
    if out.count("```") % 2:
        out += "\n```"
    return out, True


def apply(text: str, reference: str, policy: Policy, student_code: str = "") -> GuardrailResult:
    reasons: list[str] = []
    coverage = reference_coverage(text, reference, student_code)
    # A fenced block that mirrors the reference only counts if it adds lines the student lacks
    # (echoing the student's own near-complete sketch to point at a bug is allowed through).
    if coverage >= policy.reference_similarity_max or (
            block_similarity(text, reference) >= policy.reference_similarity_max and coverage > 0):
        return GuardrailResult(BLOCKED, True, ["resembles_reference_solution"])
    text, removed = strip_long_code(text, policy.max_code_lines)
    if removed:
        reasons.append("long_code_removed")
    if count_statements(text) > policy.max_code_lines:
        return GuardrailResult(BLOCKED, True, ["too_many_code_statements"])
    text, capped = cap_words(text, policy.reply_max_words)
    if capped:
        reasons.append("word_cap")
    return GuardrailResult(text, False, reasons)
