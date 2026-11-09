"""All data formats in one place. Every file format carries a schema_version."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SKETCH_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,62}$")

FaultClass = Literal["compile", "wiring", "logic", "serial"]
StepKind = Literal["simulate", "build", "code", "run", "calibrate", "reflect"]
HintSource = Literal["curated", "llm", "generic", "none"]  # generic = fallback advice, not instructor-written


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- settings / policy


class BoardSettings(Strict):
    mode: Literal["fake", "real"] = "fake"
    fqbn: str = "arduino:avr:uno"
    serial_port: str = "auto"
    baud: int = 9600
    arduino_cli: str = "tools/arduino-cli/arduino-cli.exe"
    arduino_cli_config: str = "tools/arduino-cli.yaml"


class LLMSettings(Strict):
    provider: Literal["mock", "anthropic"] = "mock"
    model: str = "claude-opus-5-5"
    effort: Literal["low", "medium", "high"] = "low"
    max_tokens: int = 2000
    use_cache: bool = True


class UISettings(Strict):
    port: int = 8080


class PathSettings(Strict):
    data_dir: str = "data"


class Settings(Strict):
    schema_version: int = 1
    board: BoardSettings = BoardSettings()
    llm: LLMSettings = LLMSettings()
    ui: UISettings = UISettings()
    paths: PathSettings = PathSettings()


class Policy(Strict):
    schema_version: int = 1
    policy_version: str
    max_step: int = 4
    entry_step_by_class: dict[FaultClass, int]
    unlock_events: list[Literal["code_edit", "compile", "upload", "answered_question"]]
    reply_max_words: int = 160
    max_code_lines: int = 3
    reference_similarity_max: float = 0.6


# --------------------------------------------------------------------------- cards


class Part(Strict):
    name: str
    qty: int = 1


class Step(Strict):
    id: str
    kind: StepKind
    text: str


class Tinkercad(Strict):
    note: str
    url: str | None = None


class SerialRange(Strict):
    field: str  # key in "key=value" serial output, e.g. temp_c
    min: float
    max: float


class Card(Strict):
    schema_version: int = 1
    id: str
    title: str
    version: int
    stage: Literal["seed", "grow", "harvest"]
    learning_objectives: list[str]
    agriculture_connection: str
    parts: list[Part]
    safety: list[str] = []
    tinkercad: Tinkercad
    steps: list[Step]

    @field_validator("id")
    @classmethod
    def sketch_safe(cls, v: str) -> str:
        if not SKETCH_NAME.match(v):
            raise ValueError("card id must be a valid Arduino sketch name (letters, digits, _)")
        return v


class Evidence(Strict):
    """Trigger channels: a fault is a candidate when at least one of them matches.

    context_serial_regex never triggers a fault on its own; it only raises the score of a
    candidate (e.g. "the code is running" makes a wiring cause more likely).
    """

    compile_regex: str | None = None       # matched against compiler error messages
    code_regex: str | None = None          # pattern present in the student's code
    code_missing_regex: str | None = None  # pattern absent from the student's code
    serial_regex: str | None = None        # pattern in recent serial lines
    serial_out_of_range: SerialRange | None = None  # parsed values outside [min, max]
    photo_finding: str | None = None       # finding id produced by the photo check
    student_keywords: list[str] = []       # whole words/phrases in the student's own description
    context_serial_regex: str | None = None
    requires_context: bool = False         # candidate only if context_serial_regex also matches

    @model_validator(mode="after")
    def has_trigger(self) -> Evidence:
        if not any(
            [self.compile_regex, self.code_regex, self.code_missing_regex, self.serial_regex,
             self.serial_out_of_range, self.photo_finding, self.student_keywords]
        ):
            raise ValueError("a fault needs at least one trigger evidence channel")
        return self


class Fault(Strict):
    id: str
    fault_class: FaultClass = Field(alias="class")
    title: str
    evidence: Evidence
    hints: list[str]  # exactly 4: where, general check, specific issue, fix
    entry_step: int | None = None   # overrides policy default for this fault
    safety_critical: bool = False   # deliver the safety instruction immediately
    seed: str | None = None         # seeds/<fault_id>/<fault_id>.ino exists

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("hints")
    @classmethod
    def four_steps(cls, v: list[str]) -> list[str]:
        if len(v) != 4:
            raise ValueError("each fault needs exactly 4 hints (where, check, specific, fix)")
        return v


class FaultLibrary(Strict):
    schema_version: int = 1
    card_id: str
    faults: list[Fault]


class Check(Strict):
    id: str
    type: Literal["compile_ok", "serial_regex", "serial_range"]
    regex: str | None = None
    min_matches: int = 1
    field: str | None = None
    min: float | None = None
    max: float | None = None
    n_samples: int = 5


class CheckList(Strict):
    schema_version: int = 1
    checks: list[Check]


class Node(Strict):
    name: str
    members: list[str]  # "REF.pin", e.g. "UNO.D8", "R1.1", "LED1.anode"


class Component(Strict):
    ref: str
    type: str
    value: str | None = None


class Netlist(Strict):
    """Topology-level reference circuit (independent of breadboard row choices)."""

    schema_version: int = 1
    components: list[Component]
    nodes: list[Node]


# --------------------------------------------------------------------------- events / progress


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


class Event(Strict):
    schema_version: int = 1
    event_id: str = Field(default_factory=lambda: uuid4().hex)
    ts_utc: str = Field(default_factory=_now)
    session_id: str
    learner_id: str  # pseudonymous, e.g. l_3f9a2c; mapping kept outside the repo
    event_type: Literal[
        "session_start", "card_open", "code_edit", "compile", "upload", "serial_snapshot",
        "check_result", "hint_request", "hint_shown", "answered_question", "photo_check",
        "board_status", "card_leave", "sim_run", "work_discard",
    ]
    card_id: str | None = None
    card_version: int | None = None
    step_id: str | None = None
    fault_id: str | None = None
    ladder_step: int | None = None
    hint_source: HintSource | None = None
    model_id: str | None = None
    prompt_hash: str | None = None
    skill_versions: dict[str, str] | None = None
    policy_version: str | None = None
    tutor_mode: Literal["on", "off"] = "on"
    ab_arm: str | None = None
    code_hash: str | None = None
    compile_ok: bool | None = None
    compile_error_hash: str | None = None
    serial_summary: str | None = None
    photo_id: str | None = None
    photo_findings: list[str] | None = None
    student_text: str | None = None  # removed by scripts/export_events.py --redact
    latency_ms: int | None = None
    app_version: str | None = None
    git_commit: str | None = None
    detail: dict | None = None


class CardProgress(Strict):
    status: Literal["not_started", "in_progress", "completed"] = "not_started"
    checks_passed: list[str] = []
    highest_hint_step: int = 0
    hints_curated: int = 0
    hints_llm: int = 0
    hints_generic: int = 0
    first_opened: str | None = None
    completed_at: str | None = None


class LearnerProgress(Strict):
    """Human-readable progress file (YAML), one per learner."""

    schema_version: int = 1
    learner_id: str
    updated: str = Field(default_factory=_now)
    cards: dict[str, CardProgress] = {}
