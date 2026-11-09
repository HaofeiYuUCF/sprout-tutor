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

from .serial_broker import PortBusy, SerialBroker, SerialLine

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
    flash_bytes: int | None = None  # program size, from arduino-cli's size report
    flash_max: int | None = None

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
    def serial_since(self, seq: int) -> list[SerialLine]: ...
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

    @staticmethod
    def _json(proc: subprocess.CompletedProcess) -> dict:
        """arduino-cli 1.x prints build results to stdout, but tool errors as JSON on stderr."""
        for stream in (proc.stdout, proc.stderr):
            if stream and stream.strip().startswith("{"):
                try:
                    return json.loads(stream)
                except json.JSONDecodeError:
                    continue
        return {}

    def compile(self, sketch_dir: Path, output_dir: Path | None = None) -> CompileResult:
        """Compile; with output_dir, arduino-cli also copies <sketch>.ino.hex there (web upload)."""
        t0 = time.time()
        extra = ["--output-dir", str(output_dir)] if output_dir else []
        proc = self._run(["compile", "--fqbn", self.fqbn, "--format", "json", *extra, str(sketch_dir)])
        data = self._json(proc)
        ok = bool(data.get("success", proc.returncode == 0))
        # arduino-cli 1.x: compiler messages in compiler_err; tool failures (sketch not found,
        # core missing, bad FQBN) in error.
        err_text = (data.get("compiler_err") or data.get("error")
                    or ("" if data else (proc.stderr or proc.stdout)) or "")
        diags = []
        for d in (data.get("builder_result") or {}).get("diagnostics") or []:
            # The message carries the source line and a caret on extra lines; keep the first.
            message = str(d.get("message", "")).splitlines()[0] if d.get("message") else ""
            diags.append(Diagnostic(Path(str(d.get("file", ""))).name, int(d.get("line") or 0),
                                    d.get("column"), str(d.get("severity", "error")).lower(),
                                    message))
        flash = next((x for x in (data.get("builder_result") or {}).get("executable_sections_size") or []
                      if x.get("name") == "text"), {})
        return CompileResult(ok, diags or parse_diagnostics(err_text), err_text, time.time() - t0,
                             flash.get("size"), flash.get("max_size"))

    def upload(self, sketch_dir: Path) -> UploadResult:
        if not self.broker:
            return UploadResult(False, "Serial is not available in this mode.")
        if not self.broker.port and not self.broker.rediscover():
            return UploadResult(False, "No board found. Plug in the UNO with the USB cable and try again.")
        t0 = time.time()
        try:
            with self.broker.paused():
                proc = self._run(["upload", "-p", self.broker.port, "--fqbn", self.fqbn,
                                  "--format", "json", str(sketch_dir)])
        except PortBusy as e:
            return UploadResult(False, str(e), time.time() - t0)
        data = self._json(proc)
        ok = proc.returncode == 0 and not data.get("error")
        msg = str(data.get("error") or proc.stderr or "").strip()
        return UploadResult(ok, msg, time.time() - t0)

    def recent_serial(self, seconds: float | None = None) -> list[SerialLine]:
        return self.broker.recent(seconds) if self.broker else []

    def serial_since(self, seq: int) -> list[SerialLine]:
        return self.broker.since(seq) if self.broker else []

    def status(self) -> str:
        if not self.broker:
            return "no serial"
        extra = f" ({self.broker.last_error})" if self.broker.last_error else ""
        return f"{self.broker.port or 'no board'}: {self.broker.state}{extra}"


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
        self._seq = 0
        self._uploaded: str | None = None

    def _make_lines(self, texts: list[str]) -> list[SerialLine]:
        now, out = time.time(), []
        for s in texts:
            self._seq += 1
            out.append(SerialLine(self._seq, now, s))
        return out

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
        self._lines = self._make_lines(self.behaviour(code))
        self._uploaded = code
        return UploadResult(True, "uploaded (fake)")

    def set_serial(self, lines: list[str]) -> None:
        self._lines = self._make_lines(lines)

    def recent_serial(self, seconds: float | None = None) -> list[SerialLine]:
        return list(self._lines)

    def serial_since(self, seq: int) -> list[SerialLine]:
        return [ln for ln in self._lines if ln.seq > seq]

    def status(self) -> str:
        return "fake board"
