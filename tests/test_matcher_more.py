"""Regression tests for issues found in the 2026-11-07 code review."""

import pytest

from sprout.hardware.board import CompileResult
from sprout.tutor.context import Context
from sprout.tutor.matcher import match_faults

OK = CompileResult(True)


@pytest.mark.parametrize("text", ["I took a photo of my circuit", "the hotel wifi is slow",
                                  "what are the dimensions of the breadboard", "nice shot"])
def test_keywords_match_whole_words_only(cards, text):
    c = cards["c02_greenhouse_temp"]
    ctx = Context(c, c.reference.read_text(), OK, ["raw=150 temp_c=23.4"] * 5, text)
    assert [m.fault.id for m in match_faults(ctx)] == []


def test_raw_zero_with_correct_code_is_wiring_not_calculation(cards):
    c = cards["c02_greenhouse_temp"]
    ctx = Context(c, c.reference.read_text(), OK, ["raw=0 temp_c=-273.1"] * 5)
    ids = [m.fault.id for m in match_faults(ctx)]
    assert ids[0] == "signal_unconnected" and "integer_division" not in ids


def test_untouched_starter_does_not_trigger_missing_code_faults(cards):
    for cid in ("c01_vent_fan", "c02_greenhouse_temp"):
        c = cards[cid]
        ctx = Context(c, c.starter.read_text(), None, [], "how do I start?")
        assert match_faults(ctx) == [], cid


def test_stated_symptom_beats_missing_code_inference(cards):
    c = cards["c01_vent_fan"]
    edited = c.starter.read_text().replace("// TODO: wait three seconds", "delay(10);", 1)
    ctx = Context(c, edited, OK, [], "the fan does not spin")
    assert match_faults(ctx)[0].fault.id == "fan_not_running"


def test_alarm_never_on_requires_alarm_off_in_log(cards):
    c = cards["c03_heat_alarm"]
    ctx = Context(c, c.reference.read_text(), OK, ["temp_c=31.2 alarm=ON"] * 5, "the buzzer is silent")
    ids = [m.fault.id for m in match_faults(ctx)]
    assert "alarm_never_on" not in ids and ids[0] == "buzzer_silent"


def test_out_of_range_needs_repeated_values(cards):
    c = cards["c02_greenhouse_temp"]
    lines = ["raw=900 temp_c=170.0"] + ["raw=150 temp_c=23.4"] * 4
    assert match_faults(Context(c, c.reference.read_text(), OK, lines)) == []
