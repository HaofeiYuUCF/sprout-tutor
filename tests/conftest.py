from pathlib import Path

import pytest

from sprout.config import load_policy, repo_root
from sprout.content import load_cards, load_skills
from sprout.events import EventLogger
from sprout.progress import ProgressStore
from sprout.tutor.llm import MockLLM
from sprout.tutor.orchestrator import Tutor, load_prompt

ROOT = repo_root()


@pytest.fixture(scope="session")
def root() -> Path:
    return ROOT


@pytest.fixture(scope="session")
def cards():
    return load_cards(ROOT)


@pytest.fixture(scope="session")
def policy():
    return load_policy(ROOT)


@pytest.fixture
def make_tutor(tmp_path, policy):
    def _make(llm=None, learner="l_test"):
        logger = EventLogger(tmp_path / "events", learner, policy.policy_version)
        return Tutor(policy, llm or MockLLM(), load_prompt(ROOT), load_skills(ROOT)["hint-ladder"],
                     logger, ProgressStore(tmp_path / "learners"))
    return _make
