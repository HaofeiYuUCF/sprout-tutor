"""Build boards and tutors from settings (shared by the CLI, the UI and the evaluation scripts)."""

from __future__ import annotations

import re
from pathlib import Path

from .config import data_dir, load_policy, load_settings, repo_root
from .content import load_skills
from .events import EventLogger
from .hardware.board import ArduinoCliBoard, Board, FakeBoard
from .hardware.ports import find_board_port
from .hardware.serial_broker import SerialBroker
from .progress import ProgressStore
from .tutor.context import strip_comments
from .tutor.llm import make_llm
from .tutor.orchestrator import Tutor, load_prompt


def demo_fake_board() -> FakeBoard:
    """A fake UNO that behaves plausibly for cards c01–c04 (for demos without hardware)."""

    def compiler(code: str) -> list[str]:
        body = strip_comments(code)
        errors = []
        for line in body.splitlines():
            s = line.strip()
            if re.match(r"^(pinMode|digitalWrite|Serial\.\w+|delay|analogRead)\s*\(.*\)\s*$", s):
                errors.append("expected ';' before '}' token")
                break
        return errors

    def behaviour(code: str) -> list[str]:
        body = strip_comments(code)
        if "fan=" in body and "alarm=" in body:          # card 04: controller
            fan_rev = re.search(r"tempC\s*<=?\s*FAN_ON_C", body)
            return [f"temp_c=24.{i} fan={'ON' if fan_rev else 'OFF'} alarm=OFF" for i in range(8)]
        if "temp_c" in body and "alarm" in body:          # card 03: alarm
            inverted = re.search(r"tempC\s*<=?\s*ALARM_C", body)
            return [f"temp_c=24.{i} alarm={'ON' if inverted else 'OFF'}" for i in range(8)]
        if "temp_c" in body:                              # card 02: thermistor
            if re.search(r"1023\s*/\s*raw", body):        # integer division: 1023 / 512 == 1
                return ["raw=512 temp_c=-273.1" for _ in range(8)]
            return [f"raw={505 + i} temp_c={24.6 + i / 10:.1f}" for i in range(8)]
        if "FAN ON" in body:                              # card 01: fan
            return ["FAN ON", "FAN OFF"] * 4
        return []

    return FakeBoard(compiler, behaviour)


def build_board(root: Path | None = None) -> Board:
    root = root or repo_root()
    s = load_settings(root)
    if s.board.mode == "fake":
        return demo_fake_board()
    port = find_board_port(s.board.serial_port)
    broker = SerialBroker(port.device if port else None, s.board.baud, preferred=s.board.serial_port)
    broker.start()
    return ArduinoCliBoard(root / s.board.arduino_cli, root / s.board.arduino_cli_config,
                           s.board.fqbn, broker)


def build_tutor(learner_id: str, root: Path | None = None, provider: str | None = None) -> Tutor:
    root = root or repo_root()
    s = load_settings(root)
    policy = load_policy(root)
    d = data_dir(root)
    llm = make_llm(provider or s.llm.provider, s.llm.model, s.llm.effort, s.llm.max_tokens,
                   d / "cache" if s.llm.use_cache else None)
    skill = load_skills(root)["hint-ladder"]
    logger = EventLogger(d / "events", learner_id, policy.policy_version, root)
    return Tutor(policy, llm, load_prompt(root), skill, logger, ProgressStore(d / "learners"))
