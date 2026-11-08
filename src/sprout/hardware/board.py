"""Board interface: the real UNO via arduino-cli, or a fake board for hardware-free tests."""

from __future__ import annotations

import json
import re
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from .serial_broker import SerialBroker, SerialLine

DIAG = re.compile(
    r"^(?P<file>.*?):(?P<line>\d+):(?:(?P<col>\d+):)?\s*"
    r"(?P<sev>error|warning|fatal error):\s*(?P<msg>.*)$"
)


@dataclass
class Diagnostic:
    file: str
    line: int
    col: int | None
    severity: str
    message: str


@dataclass
class CompileResult:
    ok: bool
    diagnostics: list[Diagnostic] = field(default_factory=list)
    raw_error: str = ""
    duration_s: float = 0.0

    @property
    def errors(self) -> list[Diagnostic]:
        return [d for d in self.diagnostics if d.severity != "warning"]


@dataclass
class UploadResult:
    ok: bool
    message: str = ""
    duration_s: float = 0.0


def parse_diagnostics(text: str) -> list[Diagnostic]:
    out = []
    for line in text.splitlines():
        m = DIAG.match(line.strip())
        if m:
            out.append(Diagnostic(Path(m["file"]).name, int(m["line"]),
                                  int(m["col"]) if m["col"] else None, m["sev"], m["msg"]))
    return out


class Board(Protocol):
    name: str

    def compile(self, sketch_dir: Path) -> CompileResult: ...
    def upload(self, sketch_dir: Path) -> UploadResult: ...
    def recent_serial(self, seconds: float | None = None) -> list[SerialLine]: ...
    def status(self) -> str: ...


class ArduinoCliBoard:
    """Real board. Compile works without hardware; upload and serial need the UNO plugged in."""

    name = "real"

    def __init__(self, cli: Path, config_file: Path, fqbn: str, broker: SerialBroker | None):
        self.cli = cli
        self.config_file = config_file
        self.fqbn = fqbn
        self.broker = broker

    def _run(self, args: list[str], timeout: int = 180) -> subprocess.CompletedProcess:
        cmd = [str(self.cli), "--config-file", str(self.config_file), *args]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

    def compile(self, sketch_dir: Path) -> CompileResult:
        t0 = time.time()
        proc = self._run(["compile", "--fqbn", self.fqbn, "--format", "json", str(sketch_dir)])
        err_text = proc.stderr or ""
        ok = proc.returncode == 0
        try:
            data = json.loads(proc.stdout) if proc.stdout.strip() else {}
            err_text = data.get("compiler_err") or err_text
            ok = bool(data.get("success", ok))
        except json.JSONDecodeError:
            err_text = (proc.stdout or "") + err_text
        return CompileResult(ok, parse_diagnostics(err_text), err_text, time.time() - t0)

    def upload(self, sketch_dir: Path) -> UploadResult:
        if not self.broker or not self.broker.port:
            return UploadResult(False, "No board port found. Plug in the UNO and run `sprout doctor`.")
        t0 = time.time()
        with self.broker.paused():
            proc = self._run(["upload", "-p", self.broker.port, "--fqbn", self.fqbn, str(sketch_dir)])
        self.broker.clear()
        msg = (proc.stderr or proc.stdout or "").strip()
        return UploadResult(proc.returncode == 0, msg, time.time() - t0)

    def recent_serial(self, seconds: float | None = None) -> list[SerialLine]:
        return self.broker.recent(seconds) if self.broker else []

    def status(self) -> str:
        if not self.broker:
            return "no serial"
        return f"{self.broker.port or 'no port'}: {self.broker.state}"


class FakeBoard:
    """Simulates compile errors and serial output from functions of the sketch source.

    compiler: code -> list of error messages (empty = compiles)
    behaviour: code -> list of serial lines the 'board' prints after upload
    """

    name = "fake"

    def __init__(self, compiler: Callable[[str], list[str]] | None = None,
                 behaviour: Callable[[str], list[str]] | None = None):
        self.compiler = compiler or (lambda code: [])
        self.behaviour = behaviour or (lambda code: [])
        self._lines: list[SerialLine] = []
        self._uploaded: str | None = None

    @staticmethod
    def _read(sketch_dir: Path) -> str:
        return (sketch_dir / f"{sketch_dir.name}.ino").read_text(encoding="utf-8")

    def compile(self, sketch_dir: Path) -> CompileResult:
        msgs = self.compiler(self._read(sketch_dir))
        diags = [Diagnostic(f"{sketch_dir.name}.ino", 1, None, "error", m) for m in msgs]
        raw = "\n".join(f"{sketch_dir.name}.ino:1: error: {m}" for m in msgs)
        return CompileResult(not msgs, diags, raw, 0.0)

    def upload(self, sketch_dir: Path) -> UploadResult:
        result = self.compile(sketch_dir)
        if not result.ok:
            return UploadResult(False, "compile failed")
        code = self._read(sketch_dir)
        now = time.time()
        self._lines = [SerialLine(now, s) for s in self.behaviour(code)]
        self._uploaded = code
        return UploadResult(True, "uploaded (fake)")

    def set_serial(self, lines: list[str]) -> None:
        now = time.time()
        self._lines = [SerialLine(now, s) for s in lines]

    def recent_serial(self, seconds: float | None = None) -> list[SerialLine]:
        return list(self._lines)

    def status(self) -> str:
        return "fake board"
