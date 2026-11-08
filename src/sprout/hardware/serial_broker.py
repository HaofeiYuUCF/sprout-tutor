"""One owner of the COM port: a reader thread fills a buffer; uploads pause it."""

from __future__ import annotations

import contextlib
import threading
import time
from collections import deque
from dataclasses import dataclass

import serial


@dataclass
class SerialLine:
    t: float  # time.time()
    text: str


class SerialBroker:
    """Reads lines in a daemon thread. Use paused() around uploads (avrdude needs the port).

    States: stopped, connected, disconnected (retrying every 2 s), paused.
    """

    RESET_DISCARD_S = 2.0  # opening the port resets the UNO; drop its boot noise

    def __init__(self, port: str | None, baud: int = 9600, maxlen: int = 5000):
        self.port = port
        self.baud = baud
        self._lines: deque[SerialLine] = deque(maxlen=maxlen)
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
    def paused(self):
        """Release the port (for upload), then resume reading."""
        self._pause.set()
        deadline = time.time() + 3
        while self.state not in ("paused", "stopped", "disconnected") and time.time() < deadline:
            time.sleep(0.05)
        try:
            yield
        finally:
            self._pause.clear()

    # ------------------------------------------------------------------ data
    def recent(self, seconds: float | None = None) -> list[SerialLine]:
        with self._lock:
            lines = list(self._lines)
        if seconds is None:
            return lines
        cutoff = time.time() - seconds
        return [ln for ln in lines if ln.t >= cutoff]

    def clear(self) -> None:
        with self._lock:
            self._lines.clear()

    # ------------------------------------------------------------------ thread
    def _run(self) -> None:
        while not self._stop.is_set():
            if self._pause.is_set():
                self.state = "paused"
                time.sleep(0.1)
                continue
            if not self.port:
                self.state = "disconnected"
                self.last_error = "no port"
                time.sleep(2)
                continue
            try:
                with serial.Serial(self.port, self.baud, timeout=0.5) as ser:
                    self.state = "connected"
                    self.last_error = None
                    opened = time.time()
                    while not self._stop.is_set() and not self._pause.is_set():
                        raw = ser.readline()
                        if not raw:
                            continue
                        if time.time() - opened < self.RESET_DISCARD_S:
                            continue
                        text = raw.decode("utf-8", errors="replace").strip()
                        if text:
                            with self._lock:
                                self._lines.append(SerialLine(time.time(), text))
            except (serial.SerialException, OSError) as e:
                self.state = "disconnected"
                self.last_error = str(e)
                time.sleep(2)
