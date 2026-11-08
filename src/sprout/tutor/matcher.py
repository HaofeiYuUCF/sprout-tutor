"""Match the current situation to known faults using several evidence channels."""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from ..schemas import Fault
from .context import Context, code_hash, parse_field, strip_comments

# Explicit symptoms (what the student says, what the board prints) outweigh inferences from
# missing code, so a stated symptom wins ties.
WEIGHTS = {"compile": 1.0, "code": 1.0, "serial": 1.0, "serial_range": 1.0, "photo": 1.0,
           "student": 1.0, "code_missing": 0.75}


@dataclass
class Match:
    fault: Fault
    channels: list[str]  # which evidence channels matched (feeds the fault-by-channel table)
    score: float


@lru_cache(maxsize=256)
def _keyword_re(keyword: str) -> re.Pattern:
    return re.compile(r"(?<!\w)" + re.escape(keyword.lower()) + r"(?!\w)")


@lru_cache(maxsize=64)
def _starter_hash(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return code_hash(f.read())


def _channels(fault: Fault, ctx: Context) -> tuple[list[str], float]:
    ev = fault.evidence
    code = strip_comments(ctx.code)
    student = (ctx.student_text or "").lower()
    untouched_starter = ctx.code_hash == _starter_hash(str(ctx.card.starter))
    context_hit = bool(ev.context_serial_regex) and any(
        re.search(ev.context_serial_regex, ln) for ln in ctx.serial_lines)
    if ev.requires_context and not context_hit:
        return [], 0.0
    hits: list[str] = []

    if ev.compile_regex and any(re.search(ev.compile_regex, m) for m in ctx.compiler_messages()):
        hits.append("compile")
    if ev.code_regex and re.search(ev.code_regex, code):
        hits.append("code")
    # Missing code means nothing while the student has not started editing the starter.
    if ev.code_missing_regex and not untouched_starter and not re.search(ev.code_missing_regex, code):
        hits.append("code_missing")
    if ev.serial_regex and any(re.search(ev.serial_regex, ln) for ln in ctx.serial_lines):
        hits.append("serial")
    if ev.serial_out_of_range:
        r = ev.serial_out_of_range
        values = parse_field(ctx.serial_lines, r.field)[-5:]
        if values and sum(1 for v in values if v < r.min or v > r.max) >= min(3, len(values)):
            hits.append("serial_range")
    if ev.photo_finding and ev.photo_finding in ctx.photo_findings:
        hits.append("photo")
    if ev.student_keywords and any(_keyword_re(k).search(student) for k in ev.student_keywords):
        hits.append("student")

    score = sum(WEIGHTS[h] for h in hits)
    if hits and context_hit:
        score += 0.5
    return hits, score


def match_faults(ctx: Context) -> list[Match]:
    """Candidates ranked: safety-critical first, then score, then order in faults.yaml."""
    out: list[tuple[int, int, Match]] = []
    for order, fault in enumerate(ctx.card.faults.faults):
        hits, score = _channels(fault, ctx)
        # A compile error outranks everything else: nothing else can be judged until it compiles.
        if ctx.compile_result is not None and not ctx.compile_result.ok and "compile" not in hits:
            continue
        if hits:
            out.append((0 if fault.safety_critical else 1, order, Match(fault, hits, score)))
    out.sort(key=lambda t: (t[0], -t[2].score, t[1]))
    return [m for _, _, m in out]
