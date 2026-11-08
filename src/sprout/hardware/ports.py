"""Find the UNO's COM port by USB VID/PID.

arduino-cli identifies official 16U2 boards but not CH340 clones, so discovery uses pyserial.
"""

from __future__ import annotations

from dataclasses import dataclass

from serial.tools import list_ports

KNOWN = {
    (0x2341, 0x0043): "UNO R3 (ATmega16U2, Arduino LLC)",
    (0x2341, 0x0001): "UNO (ATmega8U2, Arduino LLC)",
    (0x2A03, 0x0043): "UNO R3 (ATmega16U2, Arduino SRL)",
    (0x1A86, 0x7523): "UNO-compatible (CH340)",
}


@dataclass
class PortInfo:
    device: str
    vid: int | None
    pid: int | None
    description: str
    kind: str | None  # name from KNOWN, or None if not a recognized board

    @property
    def vid_pid(self) -> str:
        if self.vid is None or self.pid is None:
            return "-"
        return f"{self.vid:04X}:{self.pid:04X}"


def list_all() -> list[PortInfo]:
    out = []
    for p in list_ports.comports():
        out.append(PortInfo(p.device, p.vid, p.pid, p.description or "",
                            KNOWN.get((p.vid, p.pid)) if p.vid is not None else None))
    return out


def find_board_port(preferred: str = "auto") -> PortInfo | None:
    """Return the configured port, or the first recognized UNO, or None."""
    ports = list_all()
    if preferred and preferred != "auto":
        for p in ports:
            if p.device.upper() == preferred.upper():
                return p
        return PortInfo(preferred, None, None, "configured (not currently present)", None)
    for p in ports:
        if p.kind:
            return p
    return None
