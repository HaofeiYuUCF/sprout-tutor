"""What the tutor knows when a student asks for help."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from ..content import CardBundle
from ..hardware.board import CompileResult

_LINE_COMMENT = re.compile(r"//[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_LINE_NO = re.compile(r":\d+(:\d+)?")


def strip_comments(code: str) -> str:
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", code))


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def code_hash(code: str) -> str:
    """Hash of the code ignoring comments and whitespace (detects unchanged re-uploads)."""
    return sha(re.sub(r"\s+", "", strip_comments(code)))


def compile_error_hash(result: CompileResult | None) -> str | None:
    """Hash of the error messages without line numbers (detects repeated identical errors)."""
    if result is None or result.ok:
        return None
    msgs = sorted(_LINE_NO.sub("", d.message) for d in result.errors) or [result.raw_error[:200]]
    return sha("\n".join(msgs))


def parse_field(lines: list[str], name: str) -> list[float]:
    pat = re.compile(rf"\b{re.escape(name)}=(-?\d+(?:\.\d+)?)")
    values = []
    for ln in lines:
        m = pat.search(ln)
        if m:
            values.append(float(m.group(1)))
    return values


def quote(tag: str, text: str, max_chars: int = 2500) -> str:
    """Wrap untrusted student-side text as data for the prompt."""
    text = text or ""
    if len(text) > max_chars:
        text = text[:max_chars] + "\n[... truncated ...]"
    text = text.replace(f"</{tag}>", f"</ {tag}>")
    return f"<{tag}>\n{text}\n</{tag}>"


@dataclass
class Context:
    card: CardBundle
    code: str
    compile_result: CompileResult | None = None
    serial_lines: list[str] = field(default_factory=list)
    student_text: str = ""
    photo_findings: list[str] = field(default_factory=list)
    step_id: str | None = None

    @property
    def code_hash(self) -> str:
        return code_hash(self.code)

    @property
    def compile_error_hash(self) -> str | None:
        return compile_error_hash(self.compile_result)

    def compiler_messages(self) -> list[str]:
        if not self.compile_result:
            return []
        return [d.message for d in self.compile_result.errors] or (
            [self.compile_result.raw_error] if not self.compile_result.ok else []
        )

    def serial_summary(self, n: int = 5) -> str:
        return " | ".join(self.serial_lines[-n:])[:300]
