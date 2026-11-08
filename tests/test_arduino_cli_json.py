"""Parse real arduino-cli 1.1.1 JSON output (fixtures captured 2026-11-08, paths scrubbed)."""

import subprocess
from pathlib import Path

from sprout.hardware.board import ArduinoCliBoard

FIX = Path(__file__).parent / "fixtures" / "arduino_cli"


def _board_returning(stdout: str = "", stderr: str = "", code: int = 0) -> ArduinoCliBoard:
    board = ArduinoCliBoard(Path("arduino-cli"), Path("cfg.yaml"), "arduino:avr:uno", None)
    board._run = lambda args, timeout=180: subprocess.CompletedProcess(args, code, stdout, stderr)
    return board


def test_compile_error_gives_line_and_clean_message():
    r = _board_returning(stdout=(FIX / "compile_error.json").read_text(encoding="utf-8"),
                         code=1).compile(Path("x"))
    assert not r.ok
    assert len(r.errors) == 1
    d = r.errors[0]
    assert d.line == 8 and d.message == "expected ';' before '}' token"
    assert d.file == "missing_semicolon.ino"


def test_compile_ok():
    r = _board_returning(stdout=(FIX / "compile_ok.json").read_text(encoding="utf-8")).compile(Path("x"))
    assert r.ok and r.errors == []


def test_tool_error_reported_on_stderr_is_shown():
    r = _board_returning(stderr=(FIX / "compile_tool_error_stderr.json").read_text(encoding="utf-8"),
                         code=1).compile(Path("x"))
    assert not r.ok and "Can't open sketch" in r.raw_error
