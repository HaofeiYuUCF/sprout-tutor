"""Web Lab tutor: the same ladder and checks as the desktop workbench, driven by browser requests."""

import json

import pytest

from sprout.hardware.board import CompileResult, Diagnostic
from sprout.web.tutor_api import MAX_SERIAL_LINES, BadRequest, WebTutor, card_view, clean_serial


@pytest.fixture
def web(cards, make_tutor):
    tutors = {}

    def make(learner):
        tutors[learner] = make_tutor(learner=learner)
        return tutors[learner]

    w = WebTutor(cards, make)
    w.tutors = tutors
    return w


def _compile_error():
    return CompileResult(False, [Diagnostic("weblab.ino", 8, 1, "error", "expected ';' before '}' token")],
                         "weblab.ino:8:1: error: expected ';' before '}' token")


def test_compile_error_walks_the_ladder_with_effort(web, cards):
    seed = cards["c01_pump_light"].seeds["missing_semicolon"].read_text(encoding="utf-8")
    web.open_card("l_web1", "c01_pump_light")
    web.record_compile("l_web1", "c01_pump_light", seed, _compile_error())

    h1 = web.hint("l_web1", "c01_pump_light", seed, [], "it says error")
    assert (h1["source"], h1["fault_id"], h1["step"]) == ("curated", "missing_semicolon", 2)
    assert h1["source_label"] == "instructor hint" and h1["max_step"] == 4

    again = web.hint("l_web1", "c01_pump_light", seed, [])
    assert again["step"] == 2 and again["text"].startswith("Try the last suggestion first")

    edited = seed.replace("delay(1000)", "delay(1001)", 1)  # an edit counts as effort
    web.record_compile("l_web1", "c01_pump_light", edited, _compile_error())
    assert web.hint("l_web1", "c01_pump_light", edited, [])["step"] == 3


def test_stale_compile_result_is_ignored_after_an_edit(web, cards):
    seed = cards["c01_pump_light"].seeds["missing_semicolon"].read_text(encoding="utf-8")
    web.record_compile("l_web2", "c01_pump_light", seed, _compile_error())
    fixed = seed.replace("OUTPUT)\n", "OUTPUT);\n", 1)
    r = web.check("l_web2", "c01_pump_light", fixed, ["PUMP ON", "PUMP OFF"])
    compiles = next(x for x in r["results"] if x["id"] == "compiles")
    assert not compiles["passed"]  # the error belongs to the old code; this code is not compiled yet


def test_checks_pass_with_the_right_serial_output(web, cards):
    ref = cards["c01_pump_light"].reference.read_text(encoding="utf-8")
    web.record_compile("l_web3", "c01_pump_light", ref, CompileResult(True))
    r = web.check("l_web3", "c01_pump_light", ref, ["PUMP ON", "PUMP OFF"] * 3)
    assert r["all_passed"]
    prog = web.tutors["l_web3"].progress.load("l_web3")
    assert prog.cards["c01_pump_light"].status == "completed"


def test_events_are_logged_per_learner(web, cards):
    ref = cards["c01_pump_light"].reference.read_text(encoding="utf-8")
    web.open_card("l_web4", "c01_pump_light")
    web.record_upload("l_web4", "c01_pump_light", ref, ok=True)
    log = web.tutors["l_web4"].logger.path.read_text(encoding="utf-8").splitlines()
    kinds = [json.loads(x)["event_type"] for x in log]
    assert [k for k in kinds if k != "session_start"][:2] == ["card_open", "upload"]


def test_leaving_a_card_is_logged_and_clears_its_compile_result(web, cards):
    ref = cards["c01_pump_light"].reference.read_text(encoding="utf-8")
    web.record_compile("l_web6", "c01_pump_light", ref, CompileResult(True))
    web.leave_card("l_web6", "c01_pump_light", ref, changed=True)
    log = [json.loads(x) for x in web.tutors["l_web6"].logger.path.read_text(encoding="utf-8").splitlines()]
    leave = next(e for e in log if e["event_type"] == "card_leave")
    assert leave["detail"]["changed"] is True and leave["card_id"] == "c01_pump_light"
    r = web.check("l_web6", "c01_pump_light", ref, [])
    assert not next(x for x in r["results"] if x["id"] == "compiles")["passed"]


@pytest.mark.parametrize("learner,card,code", [
    ("../../etc", "c01_pump_light", "x"),   # learner IDs become file names
    ("L_UPPER", "c01_pump_light", "x"),
    ("l_web5", "no_such_card", "x"),
    ("l_web5", "c01_pump_light", 42),
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
