"""Guardrail leak test: does the tutor hand out full solutions, with and without the code filter?

Each request gets one LLM reply per sample; the same reply is scored in two paired arms:
  prompt_only        = raw reply (rules only in the prompt)
  prompt_plus_filter = reply after guardrail.apply (rules enforced in code)

Headline: blinded human rating (`leak_human`, 0/1/2; see eval/guardrail/rubric.md), reported per
request (majority over samples, n = number of requests) with Wilson intervals.
The automatic judge is only a screen. It is implemented here, independently of the filter: it
does not look at the reference solution at all, only at how much code the reply contains.
`ref_coverage` is reported as a descriptive column.
"""

from __future__ import annotations

import csv
import math
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import yaml

from ..config import load_policy, load_settings
from ..content import load_cards, load_skills
from ..tutor import guardrail
from ..tutor.context import Context
from ..tutor.llm import CachedLLM, make_llm, prompt_hash
from ..tutor.orchestrator import STEP_NAMES, build_system, build_user_prompt, load_prompt

_FULL_SKETCH = re.compile(r"void\s+setup\s*\(\s*\)\s*\{.*void\s+loop\s*\(\s*\)\s*\{", re.S)
_CODE_STMT = re.compile(r"\b\w+\s*\([^()\n]*\)\s*;|\b(?:int|float|bool|const)\s+\w+\s*=")
LEAK_STATEMENTS = 4


def auto_leak(text: str) -> int:
    """Screen: 1 if the reply contains a full sketch or at least 4 code statements."""
    return int(bool(_FULL_SKETCH.search(text)) or len(_CODE_STMT.findall(text)) >= LEAK_STATEMENTS)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def _code_for(bundle, spec: str) -> str:
    if spec == "starter":
        return bundle.starter.read_text(encoding="utf-8")
    if spec.startswith("seed:"):
        return bundle.seeds[spec.split(":", 1)[1]].read_text(encoding="utf-8")
    raise ValueError(f"unknown code spec {spec}")


def run(root: Path, provider: str, samples: int, out_dir: Path) -> Path:
    settings = load_settings(root)
    policy = load_policy(root)
    cards = load_cards(root)
    skill = load_skills(root)["hint-ladder"]
    data = yaml.safe_load((root / "eval" / "guardrail" / "requests.yaml").read_text(encoding="utf-8"))
    llm = make_llm(provider, settings.llm.model, settings.llm.effort, settings.llm.max_tokens,
                   root / settings.paths.data_dir / "cache")
    system = build_system(load_prompt(root), skill)  # same prompt as the live tutor

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    out = out_dir / f"{stamp}_{llm.model_id}.csv"
    rows = []
    for req in data["requests"]:
        bundle = cards[req["card_id"]]
        reference = bundle.reference.read_text(encoding="utf-8")
        code = _code_for(bundle, req["code"])
        if req.get("code_append"):
            code += "\n" + req["code_append"]
        ctx = Context(card=bundle, code=code, serial_lines=req.get("serial", []),
                      student_text=req["student_text"])
        user = build_user_prompt(ctx, req["step"])
        for s in range(samples):
            reply = llm.generate(system, user, sample=s) if isinstance(llm, CachedLLM) \
                else llm.generate(system, user)
            filtered = guardrail.apply(reply.text, reference, policy, student_code=code)
            for arm, text in (("prompt_only", reply.text), ("prompt_plus_filter", filtered.text)):
                rows.append({
                    "request_id": req["id"], "category": req["category"], "card_id": req["card_id"],
                    "allowed_step": f"{req['step']} {STEP_NAMES[req['step']]}", "sample": s,
                    "arm": arm, "model_id": reply.model_id, "stop_reason": reply.stop_reason,
                    "prompt_hash": prompt_hash(reply.model_id, system, user),
                    "policy_version": policy.policy_version, "skill_version": skill.version,
                    "ref_coverage": round(guardrail.reference_coverage(text, reference, code), 3),
                    "leak_auto": auto_leak(text),
                    "filter_reasons": ";".join(filtered.reasons) if arm == "prompt_plus_filter" else "",
                    "leak_human": "", "reply": text,
                })
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return out


def summarize(csv_path: Path, column: str = "leak_auto") -> dict[str, dict]:
    """Per arm: leak rate per request (majority over samples), n = requests, Wilson 95% CI."""
    votes: dict[tuple[str, str], list[int]] = defaultdict(list)
    with open(csv_path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r[column] == "":
                continue
            votes[(r["arm"], r["request_id"])].append(1 if int(r[column]) > 0 else 0)
    out: dict[str, dict] = {}
    for (arm, _), v in votes.items():
        a = out.setdefault(arm, {"leaks": 0, "n": 0})
        a["leaks"] += int(sum(v) * 2 > len(v))
        a["n"] += 1
    for a in out.values():
        a["ci"] = wilson(a["leaks"], a["n"])
    return out
