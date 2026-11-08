import csv

from sprout.app.main import LEARNER_ID
from sprout.app.workbench import merge_new_lines
from sprout.evaluation import guardrail_eval
from sprout.hardware.serial_broker import SerialLine
from sprout.tutor.context import Context


def test_learner_id_validation():
    assert LEARNER_ID.match("l_ab12")
    for bad in ["../x", "l_../../etc", "student1", "l_A1", "l_" + "a" * 20]:
        assert not LEARNER_ID.match(bad)


def test_serial_merge_pushes_only_new_lines():
    lines = [SerialLine(i, 0.0, f"v={i}") for i in range(1, 6)]
    buf, last, shown = merge_new_lines([], 0, lines)
    assert shown == [f"v={i}" for i in range(1, 6)] and last == 5
    # The broker window slides (oldest lines dropped) and one new line arrives.
    buf, last, shown = merge_new_lines(buf, last, lines[2:] + [SerialLine(6, 0.0, "v=6")])
    assert shown == ["v=6"] and last == 6 and buf[-1] == "v=6"
    assert merge_new_lines(buf, last, lines)[2] == []


def test_llm_failure_is_logged_as_generic(cards, make_tutor):
    class Broken:
        model_id = "broken"

        def generate(self, system, user, images=None):
            raise RuntimeError("network down")

    tutor = make_tutor(llm=Broken())
    c = cards["c01_pump_light"]
    resp = tutor.request_hint(Context(c, c.reference.read_text(), None, [], "make it faster?"))
    assert resp.source == "generic" and "llm_error" in resp.guardrail_reasons
    assert '"hint_source":"generic"' in tutor.logger.path.read_text()


def test_guardrail_eval_mock_run_is_paired(root, tmp_path):
    out = guardrail_eval.run(root, "mock", 2, tmp_path)
    rows = list(csv.DictReader(open(out, encoding="utf-8")))
    assert len(rows) == 20 * 2 * 2
    keys = {(r["request_id"], r["sample"]) for r in rows if r["arm"] == "prompt_only"}
    assert keys == {(r["request_id"], r["sample"]) for r in rows if r["arm"] == "prompt_plus_filter"}
    assert all(r["policy_version"] and r["skill_version"] for r in rows)
    summary = guardrail_eval.summarize(out)
    assert summary["prompt_only"]["n"] == 20


def test_auto_leak_screen_is_reference_free():
    full = "void setup() {\n pinMode(8, OUTPUT);\n}\nvoid loop() {\n digitalWrite(8, HIGH);\n}"
    assert guardrail_eval.auto_leak(full) == 1
    assert guardrail_eval.auto_leak("Check which leg is in which row. What do you see?") == 0
