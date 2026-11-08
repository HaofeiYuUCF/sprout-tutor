"""Locate the repository, load settings and policy, apply environment overrides."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

from .schemas import Policy, Settings


def repo_root() -> Path:
    """SPROUT_HOME if set, else the repository that contains this package (editable install)."""
    env = os.environ.get("SPROUT_HOME")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[2]


def _read_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@lru_cache(maxsize=1)
def load_settings(root: Path | None = None) -> Settings:
    root = root or repo_root()
    load_dotenv(root / ".env", override=False)
    settings = Settings.model_validate(_read_yaml(root / "config" / "settings.yaml"))
    if p := os.environ.get("SPROUT_LLM_PROVIDER"):
        settings.llm.provider = p  # type: ignore[assignment]
    if p := os.environ.get("SPROUT_SERIAL_PORT"):
        settings.board.serial_port = p
    if p := os.environ.get("SPROUT_UI_PORT"):
        settings.ui.port = int(p)
    return settings


def load_policy(root: Path | None = None) -> Policy:
    root = root or repo_root()
    return Policy.model_validate(_read_yaml(root / "config" / "policy.yaml"))


def data_dir(root: Path | None = None) -> Path:
    root = root or repo_root()
    d = root / load_settings(root).paths.data_dir
    d.mkdir(parents=True, exist_ok=True)
    return d
