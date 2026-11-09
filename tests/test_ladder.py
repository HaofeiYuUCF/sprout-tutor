from sprout.tutor.ladder import Ladder


def test_entry_step_by_fault_class(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_light_led"]
    assert lad.decide(c1.id, c1.fault("missing_semicolon")).step == 2  # compile starts at 2
    assert lad.decide(c1.id, c1.fault("led_not_lighting")).step == 1
    assert lad.decide(c1.id, None).step == 1


def test_step_rises_only_after_effort(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_light_led"]
    f = c1.fault("led_not_lighting")
    lad.record_hint(c1.id, f, lad.decide(c1.id, f).step, code_hash="h1", text="Check the rows.")
    again = lad.decide(c1.id, f)
    assert again.step == 1 and again.repeated
    lad.record_effort(c1.id, "serial_snapshot", "h1")   # not an unlock event
    assert lad.decide(c1.id, f).step == 1
    lad.record_effort(c1.id, "upload", "h2")            # upload of changed code
    up = lad.decide(c1.id, f)
    assert up.step == 2 and not up.repeated


def test_recompiling_unchanged_code_is_not_effort(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_light_led"]
    f = c1.fault("missing_semicolon")
    lad.record_hint(c1.id, f, 2, code_hash="same", text="Read the error.")
    for _ in range(4):
        lad.record_effort(c1.id, "compile", "same")
    assert lad.decide(c1.id, f).step == 2


def test_answer_counts_only_when_a_question_was_asked(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_light_led"]
    f = c1.fault("led_not_lighting")
    lad.record_hint(c1.id, f, 1, code_hash="h", text="Look at the circuit.")
    lad.record_effort(c1.id, "answered_question", "h")
    assert lad.decide(c1.id, f).step == 1
    lad.record_hint(c1.id, f, 1, code_hash="h", text="What does your serial log show?")
    lad.record_effort(c1.id, "answered_question", "h")
    assert lad.decide(c1.id, f).step == 2


def test_ladder_caps_at_max_step(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_light_led"]
    f = c1.fault("missing_semicolon")
    for i in range(6):
        d = lad.decide(c1.id, f)
        lad.record_hint(c1.id, f, d.step, code_hash=f"h{i}")
        lad.record_effort(c1.id, "code_edit", f"h{i + 1}")
    assert lad.decide(c1.id, f).step == policy.max_step


def test_safety_fault_escalates_without_effort(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_light_led"]
    f = c1.fault("led_no_resistor")
    d1 = lad.decide(c1.id, f)
    lad.record_hint(c1.id, f, d1.step)
    assert d1.step == 1 and lad.decide(c1.id, f).step == 2
