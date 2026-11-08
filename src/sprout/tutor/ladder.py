"""Hint ladder: which step is allowed now. Steps rise only after evidence of effort.

Effort means: an edit, or a compile/upload of code that differs from the code at the last hint,
or an answer to a question the last hint actually asked. Re-clicking Compile on unchanged code
or typing anything into the help box does not count.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..schemas import Fault, Policy

UNKNOWN = "_unknown"


@dataclass
class LadderState:
    step: int
    code_hash: str | None = None      # code at the time of the last hint
    asked_question: bool = False      # the last hint ended with a question
    effort_since_hint: bool = False


@dataclass
class StepDecision:
    step: int
    repeated: bool  # True when the student asked again without trying anything new


class Ladder:
    def __init__(self, policy: Policy):
        self.policy = policy
        self._state: dict[tuple[str, str], LadderState] = {}

    def entry_step(self, fault: Fault | None) -> int:
        if fault is None or fault.safety_critical:
            return 1
        if fault.entry_step:
            return fault.entry_step
        return self.policy.entry_step_by_class.get(fault.fault_class, 1)

    def decide(self, card_id: str, fault: Fault | None) -> StepDecision:
        st = self._state.get((card_id, fault.id if fault else UNKNOWN))
        if st is None:
            return StepDecision(self.entry_step(fault), repeated=False)
        if st.effort_since_hint or (fault and fault.safety_critical):
            return StepDecision(min(st.step + 1, self.policy.max_step), repeated=False)
        return StepDecision(st.step, repeated=True)

    def record_hint(self, card_id: str, fault: Fault | None, step: int,
                    code_hash: str | None = None, text: str = "") -> None:
        self._state[(card_id, fault.id if fault else UNKNOWN)] = LadderState(
            step, code_hash, asked_question=text.rstrip().endswith("?"))

    def record_effort(self, card_id: str, event_type: str, code_hash: str | None = None) -> None:
        if event_type not in self.policy.unlock_events:
            return
        for (cid, _), st in self._state.items():
            if cid != card_id:
                continue
            if event_type == "answered_question":
                counts = st.asked_question
            elif event_type in ("compile", "upload"):
                counts = code_hash is not None and code_hash != st.code_hash
            else:  # code_edit
                counts = True
            if counts:
                st.effort_since_hint = True

    def reset_card(self, card_id: str) -> None:
        for key in [k for k in self._state if k[0] == card_id]:
            del self._state[key]
