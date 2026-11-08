import re

from sprout.content import load_skills
from sprout.tutor.context import strip_comments


def test_three_seed_cards_load(cards):
    assert set(cards) == {"c01_pump_light", "c02_greenhouse_temp", "c03_heat_alarm"}
    for c in cards.values():
        assert c.card.stage == "seed"
        assert {s.kind for s in c.card.steps} >= {"simulate", "build", "code", "run", "reflect"}


def test_sketch_folders_match_arduino_cli_rule(cards):
    for c in cards.values():
        for ino in [c.starter, c.reference, *c.seeds.values()]:
            assert ino.stem == ino.parent.name


def test_code_evidence_matches_its_seed_and_not_the_reference(cards):
    for c in cards.values():
        ref = strip_comments(c.reference.read_text(encoding="utf-8"))
        for fid, ino in c.seeds.items():
            ev = c.fault(fid).evidence
            seed = strip_comments(ino.read_text(encoding="utf-8"))
            if ev.code_regex:
                assert re.search(ev.code_regex, seed), fid
                assert not re.search(ev.code_regex, ref), fid
            if ev.code_missing_regex:
                assert not re.search(ev.code_missing_regex, seed), fid
                assert re.search(ev.code_missing_regex, ref), fid


def test_hint_ladder_skill_has_frontmatter(root):
    skill = load_skills(root)["hint-ladder"]
    assert skill.version and "Allowed" not in skill.name
    assert "never" in skill.body.lower()
