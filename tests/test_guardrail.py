from sprout.tutor import guardrail


def test_full_reference_is_blocked(cards, policy):
    ref = cards["c01_light_led"].reference.read_text()
    reply = f"Here you go:\n```cpp\n{ref}\n```"
    g = guardrail.apply(reply, ref, policy)
    assert g.blocked and g.text == guardrail.BLOCKED


def test_reformatted_reference_is_still_blocked(cards, policy):
    ref = cards["c02_greenhouse_temp"].reference.read_text()
    squashed = " ".join(line.strip() for line in ref.splitlines() if not line.startswith("//"))
    assert guardrail.apply(squashed, ref, policy).blocked


def test_long_unrelated_code_is_removed(cards, policy):
    ref = cards["c01_light_led"].reference.read_text()
    reply = "Try this pattern:\n```cpp\nint a=1;\nint b=2;\nint c=3;\nint d=4;\n```\nThen test."
    g = guardrail.apply(reply, ref, policy)
    assert not g.blocked and guardrail.CODE_REMOVED in g.text and "long_code_removed" in g.reasons


def test_one_line_hint_passes(cards, policy):
    ref = cards["c01_light_led"].reference.read_text()
    reply = "In setup(), add a pinMode line for LED_PIN, e.g. `pinMode(LED_PIN, OUTPUT);`."
    g = guardrail.apply(reply, ref, policy)
    assert not g.blocked and g.reasons == []


def test_inline_backtick_solution_is_blocked(cards, policy):
    c = cards["c02_greenhouse_temp"]
    reply = ("Add these lines: `int raw = analogRead(TEMP_PIN);` then "
             "`float volts = raw * 5.0 / 1023.0;` then `float tempC = (volts - 0.5) * 100.0;` "
             "then `Serial.print(\"raw=\");` and `Serial.println(tempC, 1);`")
    g = guardrail.apply(reply, c.reference.read_text(), policy, student_code=c.starter.read_text())
    assert g.blocked


def test_echoing_students_near_complete_code_is_not_blocked(cards, policy):
    c = cards["c04_heat_alarm"]
    student = c.seeds["threshold_inverted"].read_text()
    reply = f"Here is your sketch; look at the line marked HERE:\n```cpp\n{student}\n```"
    g = guardrail.apply(reply, c.reference.read_text(), policy, student_code=student)
    assert not g.blocked and guardrail.CODE_REMOVED in g.text


def test_word_cap_never_leaves_an_open_fence(cards, policy):
    ref = cards["c01_light_led"].reference.read_text()
    reply = ("word " * 115) + "\n```cpp\nint x = 1;\n```\n" + "more " * 50
    g = guardrail.apply(reply, ref, policy)
    assert g.text.count("```") % 2 == 0


def test_word_cap(cards, policy):
    ref = cards["c01_light_led"].reference.read_text()
    g = guardrail.apply("word " * 400, ref, policy)
    assert "word_cap" in g.reasons and len(g.text.split()) <= policy.reply_max_words + 1
