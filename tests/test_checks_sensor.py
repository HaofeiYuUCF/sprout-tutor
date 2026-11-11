"""The temperature cards must not be completed by typing the reading into the print statement."""

import pytest

from sprout.hardware.board import CompileResult
from sprout.tutor.checks import run_checks

TEMP_CARDS = ["c02_greenhouse_temp", "c04_heat_alarm", "c05_greenhouse_controller"]
GOOD_LINES = [f"raw=512 temp_c=24.{i} alarm=OFF fan=OFF" for i in range(6)]
OK = CompileResult(ok=True)


def result(cards, card_id, code, lines=GOOD_LINES):
    return {r.id: r.passed for r in run_checks(cards[card_id].checks, OK, lines, code)}


@pytest.mark.parametrize("card_id", TEMP_CARDS)
def test_reference_code_passes_every_check(cards, card_id):
    assert all(result(cards, card_id, cards[card_id].reference.read_text(encoding="utf-8")).values())


@pytest.mark.parametrize("card_id", TEMP_CARDS)
def test_a_reading_typed_inside_the_quotes_does_not_pass(cards, card_id):
    code = 'void loop() {\n  analogRead(A0);\n  Serial.println("raw=512 temp_c=25.0");\n}\n'
    res = result(cards, card_id, code)
    assert res["reading_from_sensor"] is False
    assert res["plausible_room_temperature"] is True   # the output alone looks fine: that was the gap


@pytest.mark.parametrize("card_id", TEMP_CARDS)
def test_the_starter_comment_with_an_example_line_is_not_counted(cards, card_id):
    starter = (cards[card_id].reference.parent.parent / "starter" / "starter.ino").read_text(encoding="utf-8")
    assert result(cards, card_id, starter)["reading_from_sensor"] is True


def test_alarm_cards_accept_a_warm_sensor(cards):
    hot = [f"temp_c=48.{i} alarm=ON fan=ON" for i in range(6)]
    for card_id in ("c04_heat_alarm", "c05_greenhouse_controller"):
        code = cards[card_id].reference.read_text(encoding="utf-8")
        assert result(cards, card_id, code, hot)["plausible_room_temperature"] is True
