"""Run a card's checks against the latest compile result and serial output."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..hardware.board import CompileResult
from ..schemas import CheckList
from .context import parse_field


@dataclass
class CheckResult:
    id: str
    passed: bool
    detail: str


def run_checks(checks: CheckList, compile_result: CompileResult | None,
               serial_lines: list[str]) -> list[CheckResult]:
    out = []
    for c in checks.checks:
        if c.type == "compile_ok":
            ok = bool(compile_result and compile_result.ok)
            out.append(CheckResult(c.id, ok, "compiles" if ok else "does not compile yet"))
        elif c.type == "serial_regex":
            n = sum(1 for ln in serial_lines if re.search(c.regex or "", ln))
            out.append(CheckResult(c.id, n >= c.min_matches,
                                   f"{n} matching lines (need {c.min_matches})"))
        elif c.type == "serial_range":
            values = parse_field(serial_lines, c.field or "")[-c.n_samples:]
            ok = len(values) >= c.n_samples and all(c.min <= v <= c.max for v in values)
            shown = ", ".join(f"{v:g}" for v in values) or "no values"
            out.append(CheckResult(c.id, ok,
                                   f"last {len(values)} {c.field}: {shown} (expect {c.min:g}–{c.max:g})"))
    return out
