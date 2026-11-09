"""Compile a sketch sent by the browser and return the Intel HEX image for upload."""

from __future__ import annotations

import json
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from ..hardware.board import ArduinoCliBoard, CompileResult

MAX_CODE_BYTES = 64_000
SKETCH = "weblab"  # arduino-cli needs <folder>/<folder>.ino

HELLO_SKETCH = """\
// SPROUT board check: needs only the UNO and a USB cable.
// The small light marked "L" (pin 13) blinks, and the board sends a message each time.

int count = 0;

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  Serial.println("Hello! Your board is working.");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
  count++;
  Serial.print("Your board is working! Blink ");
  Serial.println(count);
}
"""


@dataclass
class CompileService:
    """One stable sketch folder (so arduino-cli reuses its core build cache), one compile at a time."""

    board: ArduinoCliBoard
    work_dir: Path

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def available(self) -> bool:
        return Path(self.board.cli).exists()

    def compile(self, code: object) -> dict:
        return self.compile_full(code)[0]

    def compile_full(self, code: object) -> tuple[dict, CompileResult | None]:
        """The browser's JSON reply, plus the CompileResult (None if nothing was compiled)."""
        if not isinstance(code, str):
            return _fail("No code was sent."), None
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            return _fail(f"The sketch is longer than {MAX_CODE_BYTES // 1000} kB."), None
        if not self.available():
            return _fail("arduino-cli is not installed on the server "
                         "(run scripts/setup_arduino_cli.ps1)."), None
        t0 = time.time()
        with self._lock:
            sk = self.work_dir / SKETCH
            out = self.work_dir / "out"
            sk.mkdir(parents=True, exist_ok=True)
            shutil.rmtree(out, ignore_errors=True)
            (sk / f"{SKETCH}.ino").write_text(code, encoding="utf-8")
            r = self.board.compile(sk, output_dir=out)
            hex_file = out / f"{SKETCH}.ino.hex"
            hex_text = hex_file.read_text(encoding="ascii") if r.ok and hex_file.exists() else None
        errors = [{"line": d.line, "message": d.message} for d in r.errors]
        if not r.ok and not errors:
            first = (r.raw_error or "Compile failed.").strip().splitlines()
            errors = [{"line": 0, "message": first[0] if first else "Compile failed."}]
        ok = r.ok and hex_text is not None
        if r.ok and hex_text is None:
            errors = [{"line": 0, "message": "Compiled, but no .hex file was produced."}]
        return {"ok": ok, "errors": errors, "hex": hex_text, "flash_bytes": r.flash_bytes,
                "flash_max": r.flash_max, "compile_ms": round((time.time() - t0) * 1000)}, r


def _fail(message: str) -> dict:
    return {"ok": False, "errors": [{"line": 0, "message": message}], "hex": None,
            "flash_bytes": None, "flash_max": None, "compile_ms": 0}


TRIAL_FIELDS = {"ok": bool, "error_code": str, "upload_ms": int, "bytes": int, "attempt": int,
                "usb_vendor_id": int, "usb_product_id": int, "browser": str, "note": str}


def clean_trial(raw: object) -> dict | None:
    """Keep only known, typed fields of an upload-trial record (no learner data)."""
    if not isinstance(raw, dict):
        return None
    out: dict = {"t": time.strftime("%Y-%m-%dT%H:%M:%S")}
    for key, typ in TRIAL_FIELDS.items():
        v = raw.get(key)
        if isinstance(v, typ) and not (typ is int and isinstance(v, bool)):
            out[key] = v[:200] if isinstance(v, str) else v
    return out if "ok" in out else None


def append_trial(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
