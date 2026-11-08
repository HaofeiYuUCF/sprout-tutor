"""Load and validate cards, fault libraries, checks, circuits and skills."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .schemas import Card, CheckList, FaultLibrary, Netlist


class ContentError(ValueError):
    pass


@dataclass
class CardBundle:
    root: Path
    card: Card
    faults: FaultLibrary
    checks: CheckList
    circuit: Netlist
    starter: Path
    reference: Path
    seeds: dict[str, Path] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.card.id

    def fault(self, fault_id: str):
        for f in self.faults.faults:
            if f.id == fault_id:
                return f
        raise KeyError(fault_id)


@dataclass
class Skill:
    name: str
    description: str
    version: str
    body: str


def _yaml(path: Path) -> dict:
    if not path.exists():
        raise ContentError(f"missing file: {path}")
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _sketch(folder: Path) -> Path:
    """arduino-cli requires <folder>/<folder>.ino."""
    ino = folder / f"{folder.name}.ino"
    if not ino.exists():
        raise ContentError(f"missing sketch: {ino} (sketch file must match its folder name)")
    return ino


def load_card(card_dir: Path) -> CardBundle:
    card = Card.model_validate(_yaml(card_dir / "card.yaml"))
    if card.id != card_dir.name:
        raise ContentError(f"{card_dir}: card id '{card.id}' must equal folder name")
    faults = FaultLibrary.model_validate(_yaml(card_dir / "faults.yaml"))
    if faults.card_id != card.id:
        raise ContentError(f"{card_dir}: faults.yaml card_id mismatch")
    checks = CheckList.model_validate(_yaml(card_dir / "checks.yaml"))
    circuit = Netlist.model_validate(_yaml(card_dir / "circuit.yaml"))
    bundle = CardBundle(
        root=card_dir,
        card=card,
        faults=faults,
        checks=checks,
        circuit=circuit,
        starter=_sketch(card_dir / "starter"),
        reference=_sketch(card_dir / "reference"),
    )
    seen: set[str] = set()
    for f in faults.faults:
        if f.id in seen:
            raise ContentError(f"{card_dir}: duplicate fault id {f.id}")
        seen.add(f.id)
        for pattern in (f.evidence.compile_regex, f.evidence.code_regex,
                        f.evidence.code_missing_regex, f.evidence.serial_regex,
                        f.evidence.context_serial_regex):
            if pattern:
                re.compile(pattern)
        if f.seed:
            bundle.seeds[f.id] = _sketch(card_dir / "seeds" / f.id)
    return bundle


def load_cards(root: Path) -> dict[str, CardBundle]:
    cards_dir = root / "cards"
    bundles = {}
    for d in sorted(p for p in cards_dir.iterdir() if p.is_dir()):
        b = load_card(d)
        bundles[b.id] = b
    return bundles


def load_skill(skill_dir: Path) -> Skill:
    text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise ContentError(f"{skill_dir}: SKILL.md needs YAML frontmatter")
    meta = yaml.safe_load(m.group(1)) or {}
    for key in ("name", "description", "version"):
        if key not in meta:
            raise ContentError(f"{skill_dir}: frontmatter missing '{key}'")
    return Skill(meta["name"], meta["description"], str(meta["version"]), m.group(2).strip())


def load_skills(root: Path) -> dict[str, Skill]:
    skills_dir = root / "skills"
    return {s.name: s for s in (load_skill(d) for d in sorted(skills_dir.iterdir()) if d.is_dir())}
