"""Web Lab server side: compile-to-hex, request guard, trial records. Browser-side uploader tests
live in tests/js/stk500_test.html (run them in Chrome/Edge against `sprout run`)."""

import json
from pathlib import Path

import pytest
from starlette.requests import Request

from sprout.config import load_settings
from sprout.hardware.board import ArduinoCliBoard, CompileResult, Diagnostic
from sprout.web.compile_service import HELLO_SKETCH, MAX_CODE_BYTES, CompileService, clean_trial
from sprout.web.routes import is_local, sketch_list


class _StubBoard:
    """Pretends to be arduino-cli: writes a hex file when the code contains 'setup'."""

    def __init__(self, tmp: Path):
        self.cli = tmp / "arduino-cli.exe"
        self.cli.write_text("")
        self.calls = []

    def compile(self, sketch_dir: Path, output_dir: Path | None = None) -> CompileResult:
        code = (sketch_dir / f"{sketch_dir.name}.ino").read_text(encoding="utf-8")
        self.calls.append(code)
        if "setup" not in code:
            return CompileResult(False, [Diagnostic("weblab.ino", 3, 1, "error", "'x' was not declared")],
                                 "weblab.ino:3:1: error: 'x' was not declared")
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / f"{sketch_dir.name}.ino.hex").write_text(":00000001FF\n", encoding="ascii")
        return CompileResult(True, flash_bytes=10, flash_max=32256)


def test_compile_returns_hex_and_size(tmp_path):
    svc = CompileService(_StubBoard(tmp_path), tmp_path / "work")
    r = svc.compile(HELLO_SKETCH)
    assert r["ok"] and r["hex"].startswith(":") and r["flash_bytes"] == 10


def test_compile_error_has_line_and_no_hex(tmp_path):
    svc = CompileService(_StubBoard(tmp_path), tmp_path / "work")
    r = svc.compile("int y = x;")
    assert not r["ok"] and r["hex"] is None
    assert r["errors"] == [{"line": 3, "message": "'x' was not declared"}]


def test_stale_hex_is_not_returned_after_a_failed_compile(tmp_path):
    svc = CompileService(_StubBoard(tmp_path), tmp_path / "work")
    assert svc.compile(HELLO_SKETCH)["ok"]
    assert svc.compile("broken")["hex"] is None


@pytest.mark.parametrize("bad", [None, 42, "x" * (MAX_CODE_BYTES + 1)])
def test_bad_input_is_refused_without_compiling(tmp_path, bad):
    board = _StubBoard(tmp_path)
    r = CompileService(board, tmp_path / "work").compile(bad)
    assert not r["ok"] and board.calls == []


def _request(host: str, origin: str | None = None) -> Request:
    headers = [(b"host", host.encode())]
    if origin:
        headers.append((b"origin", origin.encode()))
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers})


@pytest.mark.parametrize("host,origin,ok", [
    ("127.0.0.1:8080", None, True),
    ("localhost:8080", "http://localhost:8080", True),
    ("evil.example:8080", None, False),                 # DNS rebinding
    ("127.0.0.1:8080", "https://evil.example", False),  # cross-site page
])
def test_only_local_requests_are_accepted(host, origin, ok):
    assert is_local(_request(host, origin)) is ok


def test_trial_record_keeps_only_known_typed_fields():
    rec = clean_trial({"ok": True, "upload_ms": 2100, "bytes": 2266, "usb_vendor_id": 0x2341,
                       "student": "Maria", "error_code": 5, "attempt": True})
    assert rec["ok"] is True and rec["upload_ms"] == 2100 and rec["usb_vendor_id"] == 0x2341
    assert "student" not in rec and "error_code" not in rec and "attempt" not in rec
    assert clean_trial({"upload_ms": 1}) is None and clean_trial("x") is None


def test_sketch_list_has_hello_and_starters_but_no_solutions(root, cards):
    items = sketch_list(root)
    assert items[0]["id"] == "hello"
    for c in cards.values():
        entry = next(x for x in items if x["id"] == c.id)
        assert entry["code"] == c.starter.read_text(encoding="utf-8")
        assert entry["code"] != c.reference.read_text(encoding="utf-8")


def test_real_arduino_cli_produces_matching_hex(root, tmp_path):
    s = load_settings(root)
    cli = root / s.board.arduino_cli
    if not cli.exists():
        pytest.skip("arduino-cli not installed")
    board = ArduinoCliBoard(cli, root / s.board.arduino_cli_config, s.board.fqbn, None)
    r = CompileService(board, tmp_path / "work").compile(HELLO_SKETCH)
    assert r["ok"], json.dumps(r["errors"])
    lines = r["hex"].strip().splitlines()
    assert lines[-1] == ":00000001FF"
    data_bytes = sum(int(ln[1:3], 16) for ln in lines if ln[7:9] == "00")
    assert data_bytes == r["flash_bytes"]
