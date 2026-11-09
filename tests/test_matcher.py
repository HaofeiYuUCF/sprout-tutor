from sprout.hardware.board import CompileResult, Diagnostic
from sprout.tutor.context import Context
from sprout.tutor.matcher import match_faults


def _err(msg):
    return CompileResult(False, [Diagnostic("x.ino", 7, 1, "error", msg)], msg)


def test_compile_error_matches_curated_fault(cards):
    c = cards["c01_vent_fan"]
    ctx = Context(c, c.seeds["missing_semicolon"].read_text(),
                  compile_result=_err("expected ';' before '}' token"))
    m = match_faults(ctx)
    assert m and m[0].fault.id == "missing_semicolon" and m[0].channels == ["compile"]


def test_compile_error_suppresses_non_compile_faults(cards):
    c = cards["c01_vent_fan"]
    ctx = Context(c, "void setup(){} void loop(){}", compile_result=_err("some other error"),
                  student_text="the LED does not light")
    assert match_faults(ctx) == []


def test_integer_division_beats_generic_out_of_range(cards):
    c = cards["c02_greenhouse_temp"]
    ctx = Context(c, c.seeds["integer_division"].read_text(),
                  compile_result=CompileResult(True),
                  serial_lines=["raw=512 temp_c=-273.1"] * 5)
    m = match_faults(ctx)
    assert m[0].fault.id == "integer_division"
    assert m[0].channels == ["code"] and m[0].score == 1.5  # serial -273.1 only adds context
    assert "signal_unconnected" in [x.fault.id for x in m]


def test_safety_fault_ranks_first(cards):
    c = cards["c01_vent_fan"]
    ctx = Context(c, c.reference.read_text(), compile_result=CompileResult(True),
                  serial_lines=["FAN ON", "FAN OFF"],
                  student_text="the transistor gets hot and the fan does not spin")
    assert match_faults(ctx)[0].fault.id == "diode_problem"  # safety first, even with a stronger match


def test_context_channel_alone_does_not_trigger(cards):
    c = cards["c01_vent_fan"]
    ctx = Context(c, c.reference.read_text(), compile_result=CompileResult(True),
                  serial_lines=["FAN ON", "FAN OFF"])
    assert match_faults(ctx) == []


def test_comments_do_not_count_as_code(cards):
    c = cards["c01_vent_fan"]
    code = c.seeds["pin_mode_missing"].read_text() + "\n// pinMode(FAN_PIN, OUTPUT);"
    ctx = Context(c, code, compile_result=CompileResult(True), serial_lines=["FAN ON"])
    assert match_faults(ctx)[0].fault.id == "pin_mode_missing"
