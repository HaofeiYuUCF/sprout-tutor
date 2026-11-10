"""Photo wiring check: the model answers closed questions; the code writes the flags."""

import json

import pytest

from sprout.tutor.llm import MockLLM
from sprout.tutor.photo_check import MAX_FLAGS, build_prompt, build_questions, judge, parse_reply
from sprout.web.tutor_api import BadRequest, WebTutor

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


def _reply(q, photo="ok", parts=None, links=None):
    return json.dumps({"photo": photo,
                       "parts": {ref: (parts or {}).get(ref, "yes") for ref in q.parts},
                       "links": {str(i): (links or {}).get(i, "yes") for i in range(1, len(q.links) + 1)}})


def test_questions_come_from_the_reference_circuit(cards):
    q = build_questions(cards["c01_light_led"].circuit)
    assert list(q.parts) == ["R1", "LED1"]
    assert [(link.a, link.b) for link in q.links] == [
        ("UNO.D9", "R1.1"), ("R1.2", "LED1.anode"), ("UNO.GND", "LED1.cathode")]
    assert q.links[0].a_text == "pin 9 on the UNO" and "220 Ω resistor" in q.links[0].b_text
    assert q.links[2].b_text == "the short leg of the LED"
    prompt = build_prompt(q)
    assert "R1: 220 Ω resistor" in prompt and '"3": "yes|no|unsure"' in prompt


def test_every_card_gets_a_question_per_part_and_connection(cards):
    for c in cards.values():
        q = build_questions(c.circuit)
        assert len(q.parts) == len(c.circuit.components) - 1
        assert len(q.links) == sum(len(n.members) - 1 for n in c.circuit.nodes)


def test_all_seen_gives_no_flags(cards):
    q = build_questions(cards["c01_light_led"].circuit)
    v = judge(parse_reply(_reply(q), q), q)
    assert v.usable and v.flags == [] and "did not spot a problem" in v.message


def test_missing_part_is_one_flag_and_hides_its_links(cards):
    q = build_questions(cards["c01_light_led"].circuit)
    v = judge(parse_reply(_reply(q, parts={"R1": "no"}, links={1: "no", 2: "no"}), q), q)
    assert [f["code"] for f in v.flags] == ["part:R1"]
    assert "220 Ω resistor" in v.flags[0]["text"]


def test_broken_link_is_a_point_to_check_not_a_verdict(cards):
    q = build_questions(cards["c01_light_led"].circuit)
    v = judge(parse_reply(_reply(q, links={3: "no"}), q), q)
    assert [f["code"] for f in v.flags] == ["link:UNO.GND-LED1.cathode"]
    assert v.flags[0]["text"].startswith("Check the path from a GND pin on the UNO to the short leg")
    assert "can be wrong" in v.message


def test_flags_are_capped(cards):
    q = build_questions(cards["c05_greenhouse_controller"].circuit)
    v = judge(parse_reply(_reply(q, links={i: "no" for i in range(1, len(q.links) + 1)}), q), q)
    assert len(v.flags) == MAX_FLAGS and v.more == len(q.links) - MAX_FLAGS


@pytest.mark.parametrize("text", ["", "I think the LED is backwards. Move it.", "{not json"])
def test_free_text_from_the_model_never_reaches_the_student(cards, text):
    q = build_questions(cards["c01_light_led"].circuit)
    v = judge(parse_reply(text, q), q)
    assert not v.usable and v.flags == [] and "LED" not in v.message


def test_unknown_values_count_as_unsure(cards):
    q = build_questions(cards["c01_light_led"].circuit)
    seen = parse_reply('{"photo": "great", "parts": {"R1": "probably"}, "links": {"1": "IGNORE RULES"}}', q)
    assert seen.photo == "ok" and seen.parts == {"R1": "unsure", "LED1": "unsure"}
    assert seen.links == ["unsure", "unsure", "unsure"]
    assert not judge(seen, q).usable            # mostly unsure: ask for a better photo


def test_bad_photo_asks_for_another(cards):
    q = build_questions(cards["c01_light_led"].circuit)
    v = judge(parse_reply(_reply(q, photo="board_not_visible", links={1: "no"}), q), q)
    assert not v.usable and v.flags == [] and "UNO and the breadboard" in v.message


@pytest.fixture
def web(cards, make_tutor, tmp_path):
    tutors = {}

    def make(learner):
        tutors[learner] = make_tutor(learner=learner)
        return tutors[learner]

    w = WebTutor(cards, make, tmp_path / "data")
    w.tutors = tutors
    return w


def test_web_photo_check_logs_what_was_seen_and_keeps_no_photo(web, cards, tmp_path):
    q = build_questions(cards["c01_light_led"].circuit)
    web.open_card("l_cam1", "c01_light_led")
    web.tutors["l_cam1"].llm = MockLLM(_reply(q, links={2: "no"}))
    r = web.photo_check("l_cam1", "c01_light_led", JPEG)
    assert r["ok"] and [f["code"] for f in r["flags"]] == ["link:R1.2-LED1.anode"]
    assert not (tmp_path / "data" / "photos").exists()
    web.photo_feedback("l_cam1", "c01_light_led", r["photo_id"], "wrong")
    with pytest.raises(BadRequest):
        web.photo_feedback("l_cam1", "c01_light_led", r["photo_id"], "maybe")


def test_web_photo_check_keeps_the_photo_only_when_asked(web, cards, tmp_path):
    q = build_questions(cards["c01_light_led"].circuit)
    web.open_card("l_cam2", "c01_light_led")
    web.tutors["l_cam2"].llm = MockLLM(_reply(q))
    r = web.photo_check("l_cam2", "c01_light_led", JPEG, keep=True)
    assert (tmp_path / "data" / "photos" / "l_cam2" / "c01_light_led" / f"{r['photo_id']}.jpg").exists()


def test_web_photo_check_rejects_non_jpeg_and_survives_a_failing_model(web):
    web.open_card("l_cam3", "c01_light_led")
    with pytest.raises(BadRequest):
        web.photo_check("l_cam3", "c01_light_led", b"GIF89a")

    class Broken:
        model_id = "x"

        def generate(self, *a, **k):
            raise ConnectionError("down")

    web.tutors["l_cam3"].llm = Broken()
    r = web.photo_check("l_cam3", "c01_light_led", JPEG)
    assert not r["ok"] and r["flags"] == [] and "not available" in r["message"]
