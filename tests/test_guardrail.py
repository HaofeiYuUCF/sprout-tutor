from sprout.tutor import guardrail


def test_full_reference_is_blocked(cards, policy):
    ref = cards["c01_pump_light"].reference.read_text()
    reply = f"Here you go:\n```cpp\n{ref}\n```"
    g = guardrail.apply(reply, ref, policy)
    assert g.blocked and g.text == guardrail.BLOCKED


def test_reformatted_reference_is_still_blocked(cards, policy):
    ref = cards["c02_greenhouse_temp"].reference.read_text()
    squashed = " ".join(line.strip() for line in ref.splitlines() if not line.startswith("//"))
    assert guardrail.apply(squashed, ref, policy).blocked


def test_long_unrelated_code_is_removed(cards, policy):
    ref = cards["c01_pump_light"].reference.read_text()
    reply = "Try this pattern:\n```cpp\nint a=1;\nint b=2;\nint c=3;\nint d=4;\n```\nThen test."
    g = guardrail.apply(reply, ref, policy)
    assert not g.blocked and guardrail.CODE_REMOVED in g.text and "long_code_removed" in g.reasons


def test_one_line_hint_passes(cards, policy):
    ref = cards["c01_pump_light"].reference.read_text()
    reply = "In setup(), add a pinMode line for PUMP_LED_PIN, e.g. `pinMode(PUMP_LED_PIN, OUTPUT);`."
    g = guardrail.apply(reply, ref, policy)
    assert not g.blocked and g.reasons == []


def test_word_cap(cards, policy):
    ref = cards["c01_pump_light"].reference.read_text()
    g = guardrail.apply("word " * 400, ref, policy)
    assert "word_cap" in g.reasons and len(g.text.split()) <= policy.reply_max_words + 1
