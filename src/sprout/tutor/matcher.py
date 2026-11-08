"""Match the current situation to known faults using several evidence channels."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..schemas import Fault
from .context import Context, parse_field, strip_comments


@dataclass
class Match:
    fault: Fault
    channels: list[str]  # which evidence channels matched (feeds the fault-by-channel table)
    score: float


def _channels(fault: Fault, ctx: Context) -> tuple[list[str], float]:
    ev = fault.evidence
    code = strip_comments(ctx.code)
    student = (ctx.student_text or "").lower()
    hits: list[str] = []

    if ev.compile_regex and any(re.search(ev.compile_regex, m) for m in ctx.compiler_messages()):
        hits.append("compile")
    if ev.code_regex and re.search(ev.code_regex, code):
        hits.append("code")
    if ev.code_missing_regex and not re.search(ev.code_missing_regex, code):
        hits.append("code_missing")
    if ev.serial_regex and any(re.search(ev.serial_regex, ln) for ln in ctx.serial_lines):
        hits.append("serial")
    if ev.serial_out_of_range:
        r = ev.serial_out_of_range
        values = parse_field(ctx.serial_lines, r.field)[-5:]
        if values and any(v < r.min or v > r.max for v in values):
            hits.append("serial_range")
    if ev.photo_finding and ev.photo_finding in ctx.photo_findings:
        hits.append("photo")
    if ev.student_keywords and any(k.lower() in student for k in ev.student_keywords):
        hits.append("student")

    score = float(len(hits))
    if hits and ev.context_serial_regex and any(
        re.search(ev.context_serial_regex, ln) for ln in ctx.serial_lines
    ):
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
