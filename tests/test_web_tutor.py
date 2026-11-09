"""Web Lab tutor: the same ladder and checks as the desktop workbench, driven by browser requests."""

import json

import pytest

from sprout.hardware.board import CompileResult, Diagnostic
from sprout.web.tutor_api import MAX_SERIAL_LINES, BadRequest, WebTutor, card_view, clean_serial


@pytest.fixture
def web(cards, make_tutor, tmp_path):
    tutors = {}

    def make(learner):
        tutors[learner] = make_tutor(learner=learner)
        return tutors[learner]

    w = WebTutor(cards, make, tmp_path / "data")
    w.tutors = tutors
    return w


def _compile_error():
    return CompileResult(False, [Diagnostic("weblab.ino", 8, 1, "error", "expected ';' before '}' token")],
                         "weblab.ino:8:1: error: expected ';' before '}' token")


def test_compile_error_walks_the_ladder_with_effort(web, cards):
    seed = cards["c01_light_led"].seeds["missing_semicolon"].read_text(encoding="utf-8")
    web.open_card("l_web1", "c01_light_led")
    web.record_compile("l_web1", "c01_light_led", seed, _compile_error())

    h1 = web.hint("l_web1", "c01_light_led", seed, [], "it says error")
    assert (h1["source"], h1["fault_id"], h1["step"]) == ("curated", "missing_semicolon", 2)
    assert h1["source_label"] == "instructor hint" and h1["max_step"] == 4

    again = web.hint("l_web1", "c01_light_led", seed, [])
    assert again["step"] == 2 and again["text"].startswith("Try the last suggestion first")

    edited = seed.replace("delay(1000)", "delay(1001)", 1)  # an edit counts as effort
    web.record_compile("l_web1", "c01_light_led", edited, _compile_error())
    assert web.hint("l_web1", "c01_light_led", edited, [])["step"] == 3


def test_stale_compile_result_is_ignored_after_an_edit(web, cards):
    seed = cards["c01_light_led"].seeds["missing_semicolon"].read_text(encoding="utf-8")
    web.record_compile("l_web2", "c01_light_led", seed, _compile_error())
    fixed = seed.replace("OUTPUT)\n", "OUTPUT);\n", 1)
    r = web.check("l_web2", "c01_light_led", fixed, ["LED ON", "LED OFF"])
    compiles = next(x for x in r["results"] if x["id"] == "compiles")
    assert not compiles["passed"]  # the error belongs to the old code; this code is not compiled yet


def test_checks_pass_with_the_right_serial_output(web, cards):
    ref = cards["c01_light_led"].reference.read_text(encoding="utf-8")
    web.record_compile("l_web3", "c01_light_led", ref, CompileResult(True))
    r = web.check("l_web3", "c01_light_led", ref, ["LED ON", "LED OFF"] * 3)
    assert r["all_passed"]
    prog = web.tutors["l_web3"].progress.load("l_web3")
    assert prog.cards["c01_light_led"].status == "completed"


def test_events_are_logged_per_learner(web, cards):
    ref = cards["c01_light_led"].reference.read_text(encoding="utf-8")
    web.open_card("l_web4", "c01_light_led")
    web.record_upload("l_web4", "c01_light_led", ref, ok=True)
    log = web.tutors["l_web4"].logger.path.read_text(encoding="utf-8").splitlines()
    kinds = [json.loads(x)["event_type"] for x in log]
    assert [k for k in kinds if k != "session_start"][:2] == ["card_open", "upload"]


def test_leaving_a_card_is_logged_and_clears_its_compile_result(web, cards):
    ref = cards["c01_light_led"].reference.read_text(encoding="utf-8")
    web.record_compile("l_web6", "c01_light_led", ref, CompileResult(True))
    web.leave_card("l_web6", "c01_light_led", ref, changed=True)
    log = [json.loads(x) for x in web.tutors["l_web6"].logger.path.read_text(encoding="utf-8").splitlines()]
    leave = next(e for e in log if e["event_type"] == "card_leave")
    assert leave["detail"]["changed"] is True and leave["card_id"] == "c01_light_led"
    r = web.check("l_web6", "c01_light_led", ref, [])
    assert not next(x for x in r["results"] if x["id"] == "compiles")["passed"]


@pytest.mark.parametrize("learner,card,code", [
    ("../../etc", "c01_light_led", "x"),   # learner IDs become file names
    ("L_UPPER", "c01_light_led", "x"),
    ("l_web5", "no_such_card", "x"),
    ("l_web5", "c01_light_led", 42),
])
def test_bad_requests_are_refused(web, learner, card, code):
    with pytest.raises(BadRequest):
        web.hint(learner, card, code, [])


def test_serial_from_the_browser_is_bounded():
    lines = clean_serial(["x" * 1000] + ["ok"] * (MAX_SERIAL_LINES + 50) + [7])
    assert len(lines) == MAX_SERIAL_LINES and all(len(x) <= 300 for x in lines)
    assert clean_serial("not a list") == []


def test_card_view_never_includes_the_reference(cards):
    for c in cards.values():
        view = json.dumps(card_view(c))
        assert c.reference.read_text(encoding="utf-8").strip()[:80] not in view
        assert [s["id"] for s in card_view(c)["steps"]] == [s.id for s in c.card.steps]


def test_simulator_pass_does_not_complete_the_card(web, cards):
    ref = cards["c01_light_led"].reference.read_text(encoding="utf-8")
    web.record_compile("l_web7", "c01_light_led", ref, CompileResult(True))
    r = web.check("l_web7", "c01_light_led", ref, ["LED ON", "LED OFF"] * 3, source="sim")
    assert r["all_passed"] and r["source"] == "sim" and not r["completes_card"]
    prog = web.tutors["l_web7"].progress.load("l_web7")
    assert "c01_light_led" not in prog.cards or prog.cards["c01_light_led"].status != "completed"
    log = [json.loads(x) for x in web.tutors["l_web7"].logger.path.read_text(encoding="utf-8").splitlines()]
    assert next(e for e in log if e["event_type"] == "check_result")["detail"]["source"] == "sim"
    board = web.check("l_web7", "c01_light_led", ref, ["LED ON", "LED OFF"] * 3, source="board")
    assert board["completes_card"]
    assert web.tutors["l_web7"].progress.load("l_web7").cards["c01_light_led"].status == "completed"
    with pytest.raises(BadRequest):
        web.check("l_web7", "c01_light_led", ref, [], source="phone")


def test_work_is_saved_loaded_and_discarded(web):
    assert web.load_work("l_web8", "c01_light_led") == {"code": None, "sim": None, "reflection": None}
    sim = {"parts": {"led": {"x": 510, "y": 152, "flipped": False}}, "wires": [["pin:D8:6", "bb:5:a"]]}
    web.save_work("l_web8", "c01_light_led", code="void setup(){}\nvoid loop(){}", sim=sim)
    got = web.load_work("l_web8", "c01_light_led")
    assert got["code"].startswith("void setup") and got["sim"] == sim
    web.save_work("l_web8", "c01_light_led", reflection="Water in the morning.")
    assert web.load_work("l_web8", "c01_light_led")["reflection"] == "Water in the morning."
    web.discard_work("l_web8", "c01_light_led")
    assert web.load_work("l_web8", "c01_light_led") == {"code": None, "sim": None, "reflection": None}
    with pytest.raises(BadRequest):
        web.save_work("l_web8", "c01_light_led", sim={"x": "y" * 30_000})
    with pytest.raises(BadRequest):
        web.save_work("../evil", "c01_light_led", code="x")


def test_progress_summary_shows_sim_pass_and_completion(web, cards):
    ref = cards["c01_light_led"].reference.read_text(encoding="utf-8")
    assert web.progress_summary("l_web9")["cards"]["c01_light_led"] == {"status": "not_started",
                                                                         "sim_passed": False}
    web.record_compile("l_web9", "c01_light_led", ref, CompileResult(True))
    web.check("l_web9", "c01_light_led", ref, ["LED ON", "LED OFF"] * 3, source="sim")
    assert web.progress_summary("l_web9")["cards"]["c01_light_led"] == {"status": "in_progress",
                                                                         "sim_passed": True}
    web.check("l_web9", "c01_light_led", ref, ["LED ON", "LED OFF"] * 3, source="board")
    assert web.progress_summary("l_web9")["cards"]["c01_light_led"]["status"] == "completed"


def test_learning_events_are_logged(web):
    web.record_learning("l_web10", "c01_light_led", "quiz", "c01.q1", correct=True)
    web.record_learning("l_web10", None, "explain", "glossary.voltage")
    log = [json.loads(x) for x in web.tutors["l_web10"].logger.path.read_text(encoding="utf-8").splitlines()]
    quiz = next(e for e in log if e["event_type"] == "quiz_answer")
    assert quiz["detail"] == {"item": "c01.q1", "client": "weblab", "correct": True}
    assert any(e["event_type"] == "explain_open" and e.get("card_id") is None for e in log)
    with pytest.raises(BadRequest):
        web.record_learning("l_web10", "c01_light_led", "quiz", "../bad id")
