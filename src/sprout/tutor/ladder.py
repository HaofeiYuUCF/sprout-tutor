"""Hint ladder: which step is allowed now. Steps rise only after evidence of effort."""

from __future__ import annotations

from dataclasses import dataclass

from ..schemas import Fault, Policy

UNKNOWN = "_unknown"


@dataclass
class LadderState:
    step: int
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
        if fault is None:
            return 1
        if fault.safety_critical:
            return 1
        if fault.entry_step:
            return fault.entry_step
        return self.policy.entry_step_by_class.get(fault.fault_class, 1)

    def decide(self, card_id: str, fault: Fault | None) -> StepDecision:
        key = (card_id, fault.id if fault else UNKNOWN)
        st = self._state.get(key)
        if st is None:
            return StepDecision(self.entry_step(fault), repeated=False)
        safety = bool(fault and fault.safety_critical)
        if st.effort_since_hint or safety:
            return StepDecision(min(st.step + 1, self.policy.max_step), repeated=False)
        return StepDecision(st.step, repeated=True)

    def record_hint(self, card_id: str, fault: Fault | None, step: int) -> None:
        self._state[(card_id, fault.id if fault else UNKNOWN)] = LadderState(step, False)

    def record_effort(self, card_id: str, event_type: str) -> None:
        if event_type not in self.policy.unlock_events:
            return
        for (cid, _), st in self._state.items():
            if cid == card_id:
                st.effort_since_hint = True

    def reset_card(self, card_id: str) -> None:
        for key in [k for k in self._state if k[0] == card_id]:
            del self._state[key]
