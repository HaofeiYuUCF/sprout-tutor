"""One owner of the COM port: a reader thread fills a buffer; uploads pause it."""

from __future__ import annotations

import contextlib
import itertools
import threading
import time
from collections import deque
from dataclasses import dataclass

import serial

from .ports import find_board_port


@dataclass
class SerialLine:
    seq: int    # increases by one per line; lets the UI fetch only new lines
    t: float    # time.time()
    text: str


class PortBusy(RuntimeError):
    pass


class SerialBroker:
    """Reads lines in a daemon thread. Use paused() around uploads (avrdude needs the port).

    States: stopped, connected, disconnected (re-discovering every 2 s), paused.
    """

    RESET_DISCARD_S = 1.5  # opening the port resets the UNO; drop its boot noise

    def __init__(self, port: str | None, baud: int = 9600, preferred: str = "auto",
                 maxlen: int = 5000):
        self.port = port
        self.preferred = preferred
        self.baud = baud
        self._lines: deque[SerialLine] = deque(maxlen=maxlen)
        self._seq = itertools.count(1)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._pause = threading.Event()
        self._thread: threading.Thread | None = None
        self.state = "stopped"
        self.last_error: str | None = None

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="serial-broker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        self.state = "stopped"

    @contextlib.contextmanager
    def paused(self, timeout: float = 3.0):
        """Release the port (for upload), then resume reading. Raises PortBusy on timeout."""
        self._pause.set()
        deadline = time.time() + timeout
        while self.state == "connected" and time.time() < deadline:
            time.sleep(0.05)
        try:
            if self.state == "connected":
                raise PortBusy("serial port could not be released for upload")
            yield
        finally:
            self._pause.clear()

    def rediscover(self) -> str | None:
        p = find_board_port(self.preferred)
        if p and p.device != self.port:
            self.port = p.device
        return self.port

    # ------------------------------------------------------------------ data
    def recent(self, seconds: float | None = None) -> list[SerialLine]:
        with self._lock:
            lines = list(self._lines)
        if seconds is None:
            return lines
        cutoff = time.time() - seconds
        return [ln for ln in lines if ln.t >= cutoff]

    def since(self, seq: int) -> list[SerialLine]:
        with self._lock:
            return [ln for ln in self._lines if ln.seq > seq]

    def clear(self) -> None:
        with self._lock:
            self._lines.clear()

    def _append(self, text: str) -> None:
        with self._lock:
            self._lines.append(SerialLine(next(self._seq), time.time(), text))

    # ------------------------------------------------------------------ thread
    def _run(self) -> None:
        while not self._stop.is_set():
            if self._pause.is_set():
                self.state = "paused"
                time.sleep(0.1)
                continue
            if not self.port and not self.rediscover():
                self.state = "disconnected"
                self.last_error = "no board found"
                time.sleep(2)
                continue
            try:
                with serial.Serial(self.port, self.baud, timeout=0.5) as ser:
                    self.state = "connected"
                    self.last_error = None
                    opened = time.time()
                    pending = b""
                    while not self._stop.is_set() and not self._pause.is_set():
                        chunk = ser.readline()
                        if not chunk:
                            continue
                        pending += chunk
                        if not pending.endswith(b"\n"):
                            continue  # partial line: wait for the rest
                        raw, pending = pending, b""
                        if time.time() - opened < self.RESET_DISCARD_S:
                            continue
                        text = raw.decode("utf-8", errors="replace").strip()
                        if text:
                            self._append(text)
            except (serial.SerialException, OSError) as e:
                self.state = "disconnected"
                self.last_error = str(e)
                self.port = None if self.preferred == "auto" else self.port
                time.sleep(2)
