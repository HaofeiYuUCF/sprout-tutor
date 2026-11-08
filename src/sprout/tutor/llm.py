"""Provider-agnostic LLM interface: mock, Anthropic, and an on-disk cache wrapper."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

# Models that accept the server-side refusal fallback ("fallbacks": "default").
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}


@dataclass
class LLMReply:
    text: str
    model_id: str
    stop_reason: str
    input_tokens: int = 0
    output_tokens: int = 0
    cached: bool = False
    latency_ms: int = 0


class LLM(Protocol):
    model_id: str

    def generate(self, system: str, user: str, images: list[bytes] | None = None) -> LLMReply: ...


def prompt_hash(model_id: str, system: str, user: str, images: list[bytes] | None = None) -> str:
    h = hashlib.sha256()
    for part in (model_id, system, user, *[hashlib.sha256(i).hexdigest() for i in images or []]):
        h.update(part.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


class MockLLM:
    """Deterministic replies for development and tests; never calls a network."""

    model_id = "mock"

    _TEMPLATES = {
        1: "Let's narrow it down first. Did the code compile, and does the serial log show what "
           "you expected? If the code runs but the result is wrong, look at the circuit. "
           "What do you see in the serial log right now?",
        2: "Pick one part and test it on its own. Check the wires for that part row by row "
           "against the card's diagram. What did you find?",
        3: "Compare the part of your sketch that controls this behaviour with the card's "
           "instructions; one detail there does not match what the card asks for.",
        4: "Change the one line that sets up or switches the pin so it matches the card, "
           "then compile and upload again.",
    }

    def __init__(self, reply: str | None = None):
        self.reply = reply

    def generate(self, system: str, user: str, images: list[bytes] | None = None) -> LLMReply:
        if self.reply is not None:
            return LLMReply(self.reply, self.model_id, "end_turn")
        m = re.search(r"Allowed hint step:\s*(\d)", user)
        step = int(m.group(1)) if m else 1
        return LLMReply(self._TEMPLATES.get(step, self._TEMPLATES[1]), self.model_id, "end_turn")


class AnthropicLLM:
    def __init__(self, model: str, effort: str = "low", max_tokens: int = 2000):
        import anthropic  # imported lazily so tests and mock mode need no key

        self.model_id = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY") or None)

    @staticmethod
    def _media_type(data: bytes) -> str:
        return "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"

    def generate(self, system: str, user: str, images: list[bytes] | None = None) -> LLMReply:
        content: list[dict] = []
        for img in images or []:
            content.append({"type": "image", "source": {
                "type": "base64", "media_type": self._media_type(img),
                "data": base64.standard_b64encode(img).decode("ascii")}})
        content.append({"type": "text", "text": user})
        kwargs = dict(
            model=self.model_id,
            max_tokens=self.max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": self.effort},
        )
        t0 = time.time()
        if self.model_id in _FALLBACK_MODELS:
            resp = self.client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        else:
            resp = self.client.messages.create(**kwargs)
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        stop = resp.stop_reason or ""
        if stop == "refusal":
            text = ""
        usage = getattr(resp, "usage", None)
        return LLMReply(text.strip(), getattr(resp, "model", self.model_id), stop,
                        getattr(usage, "input_tokens", 0) or 0,
                        getattr(usage, "output_tokens", 0) or 0,
                        latency_ms=int((time.time() - t0) * 1000))


class CachedLLM:
    """Same prompt → same reply from disk. Makes evaluation reruns free and reproducible."""

    def __init__(self, inner: LLM, cache_dir: Path):
        self.inner = inner
        self.model_id = inner.model_id
        self.cache_dir = cache_dir
        cache_dir.mkdir(parents=True, exist_ok=True)

    def generate(self, system: str, user: str, images: list[bytes] | None = None,
                 sample: int = 0) -> LLMReply:
        key = prompt_hash(self.model_id, system, user + f"\x00sample={sample}", images)
        path = self.cache_dir / f"{key}.json"
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            data["cached"] = True
            return LLMReply(**data)
        reply = self.inner.generate(system, user, images)
        path.write_text(json.dumps(asdict(reply), ensure_ascii=False, indent=1), encoding="utf-8")
        return reply


def make_llm(provider: str, model: str, effort: str, max_tokens: int,
             cache_dir: Path | None) -> LLM:
    if provider == "anthropic":
        llm: LLM = AnthropicLLM(model, effort, max_tokens)
    else:
        llm = MockLLM()
    if cache_dir is not None and provider != "mock":
        llm = CachedLLM(llm, cache_dir / llm.model_id)
    return llm
