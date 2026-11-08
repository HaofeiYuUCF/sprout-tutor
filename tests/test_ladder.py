from sprout.tutor.ladder import Ladder


def test_entry_step_by_fault_class(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_pump_light"]
    assert lad.decide(c1.id, c1.fault("missing_semicolon")).step == 2  # compile starts at 2
    assert lad.decide(c1.id, c1.fault("led_not_lighting")).step == 1
    assert lad.decide(c1.id, None).step == 1


def test_step_rises_only_after_effort(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_pump_light"]
    f = c1.fault("led_not_lighting")
    d = lad.decide(c1.id, f)
    lad.record_hint(c1.id, f, d.step)
    again = lad.decide(c1.id, f)
    assert again.step == 1 and again.repeated
    lad.record_effort(c1.id, "serial_snapshot")  # not an unlock event
    assert lad.decide(c1.id, f).step == 1
    lad.record_effort(c1.id, "upload")
    up = lad.decide(c1.id, f)
    assert up.step == 2 and not up.repeated


def test_ladder_caps_at_max_step(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_pump_light"]
    f = c1.fault("missing_semicolon")
    for _ in range(6):
        d = lad.decide(c1.id, f)
        lad.record_hint(c1.id, f, d.step)
        lad.record_effort(c1.id, "compile")
    assert lad.decide(c1.id, f).step == policy.max_step


def test_safety_fault_escalates_without_effort(cards, policy):
    lad = Ladder(policy)
    c1 = cards["c01_pump_light"]
    f = c1.fault("missing_resistor")
    d1 = lad.decide(c1.id, f)
    lad.record_hint(c1.id, f, d1.step)
    assert d1.step == 1 and lad.decide(c1.id, f).step == 2
