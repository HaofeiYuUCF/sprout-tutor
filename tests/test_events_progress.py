import json

import yaml

from sprout.events import EventLogger
from sprout.progress import ProgressStore
from sprout.tutor.context import code_hash


def test_event_log_is_valid_jsonl(tmp_path):
    log = EventLogger(tmp_path, "l_abc123", "0.1.0")
    log.log("compile", card_id="c01_vent_fan", compile_ok=False, compile_error_hash="h")
    lines = (tmp_path / "l_abc123.jsonl").read_text().splitlines()
    first, second = (json.loads(x) for x in lines)
    assert first["event_type"] == "session_start" and second["policy_version"] == "0.1.0"
    assert second["learner_id"] == "l_abc123" and "student_text" not in second


def test_code_hash_ignores_comments_and_whitespace():
    a = "void setup(){\n  pinMode(8, OUTPUT); // set pin\n}"
    b = "void setup(){pinMode(8,OUTPUT);}\n/* note */"
    assert code_hash(a) == code_hash(b)
    assert code_hash(a) != code_hash(a.replace("8", "9"))


def test_progress_file_is_readable_yaml(tmp_path):
    store = ProgressStore(tmp_path)
    store.opened("l_x", "c01_vent_fan")
    store.hint("l_x", "c01_vent_fan", 2, "curated")
    store.checks("l_x", "c01_vent_fan", ["compiles", "fan_messages"], True)
    text = (tmp_path / "l_x.yaml").read_text(encoding="utf-8")
    assert text.startswith("# SPROUT learner progress")
    data = yaml.safe_load(text)
    card = data["cards"]["c01_vent_fan"]
    assert card["status"] == "completed" and card["highest_hint_step"] == 2
