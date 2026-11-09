"""End-to-end without hardware: seeded fault → curated hints up the ladder → fix → checks pass."""

import json

from sprout.runtime import demo_fake_board
from sprout.tutor.context import Context
from sprout.tutor.llm import CachedLLM, MockLLM
from sprout.workspace import write_sketch


def test_seeded_fault_to_passing_checks(tmp_path, cards, make_tutor):
    card = cards["c02_greenhouse_temp"]
    board = demo_fake_board()
    tutor = make_tutor()

    # 1. Student uploads code with the integer-division bug.
    code = card.seeds["integer_division"].read_text()
    sk = write_sketch(tmp_path, "l_test", card.id, code)
    compiled = board.compile(sk)
    assert compiled.ok
    assert board.upload(sk).ok
    serial = [ln.text for ln in board.recent_serial()]
    ctx = Context(card, code, compiled, serial, "it always says -273.1")
    tutor.note(ctx, "upload")
    assert not all(r.passed for r in tutor.checks(ctx))

    # 2. First hint: curated, logic fault starts at step 1.
    h1 = tutor.request_hint(ctx)
    assert (h1.source, h1.fault_id, h1.step) == ("curated", "integer_division", 1)

    # 3. Asking again without trying anything repeats step 1 with a nudge.
    h1b = tutor.request_hint(ctx)
    assert h1b.step == 1 and h1b.text.startswith("Try the last suggestion first")

    # 4. After an edit, the next step unlocks.
    tutor.note(ctx, "code_edit")
    assert tutor.request_hint(ctx).step == 2

    # 5. Student fixes the bug; checks pass and progress is completed.
    fixed = card.reference.read_text()
    sk = write_sketch(tmp_path, "l_test", card.id, fixed)
    compiled = board.compile(sk)
    board.upload(sk)
    ctx2 = Context(card, fixed, compiled, [ln.text for ln in board.recent_serial()])
    results = tutor.checks(ctx2)
    assert all(r.passed for r in results), results

    prog = tutor.progress.load("l_test")
    assert prog.cards[card.id].status == "completed"
    events = [json.loads(x)["event_type"] for x in tutor.logger.path.read_text().splitlines()]
    assert events.count("hint_shown") == 3 and "check_result" in events


def test_unknown_problem_goes_to_llm_with_guardrail(tmp_path, cards, make_tutor):
    card = cards["c01_vent_fan"]
    ref = card.reference.read_text()
    leaky = MockLLM(reply=f"Sure!\n```cpp\n{ref}\n```")
    tutor = make_tutor(llm=leaky)
    # Student configured the pin but has not written the blink logic yet (no curated fault fits).
    code = card.starter.read_text().replace(
        "// TODO: set FAN_PIN as an output", "pinMode(FAN_PIN, OUTPUT);", 1)
    ctx = Context(card, code, None, [], "how do I make it blink faster?")
    h = tutor.request_hint(ctx)
    assert h.fault_id is None
    assert "resembles_reference_solution" in h.guardrail_reasons and h.source == "generic"
    assert "void setup" not in h.text


def test_cached_llm_reuses_reply(tmp_path):
    calls = []

    class Counting(MockLLM):
        def generate(self, system, user, images=None):
            calls.append(1)
            return super().generate(system, user, images)

    llm = CachedLLM(Counting(), tmp_path)
    a = llm.generate("s", "Allowed hint step: 2")
    b = llm.generate("s", "Allowed hint step: 2")
    assert a.text == b.text and b.cached and len(calls) == 1
