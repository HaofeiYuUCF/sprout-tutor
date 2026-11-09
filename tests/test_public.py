"""Public-server protections: include filter, rate limits, AI cap, class list, host check, secrets."""

import pytest
from starlette.requests import Request

from sprout.web import public
from sprout.web.public import CappedLLM, DailyCap, RateLimiter, Roster, check_includes, safe_env
from sprout.web.routes import is_local


@pytest.mark.parametrize("code,ok", [
    ("#include <Servo.h>\nvoid setup(){}", True),
    ("#include <Wire.h>\n#include <math.h>", True),
    ('#include "/etc/passwd"', False),
    ('#include "secrets.h"', False),
    ("#include </proc/self/environ>", False),
    ("#include <../../app/.env>", False),
    ("  #  include <avr/io.h>", False),            # paths are refused, even harmless ones
    ("void setup(){}", True),
])
def test_include_filter(code, ok):
    assert (check_includes(code) is None) == ok


def test_rate_limiter_counts_per_key():
    rl = RateLimiter(2, 60)
    assert rl.allow("a") and rl.allow("a") and not rl.allow("a")
    assert rl.allow("b")


def test_daily_cap_and_capped_llm():
    class Inner:
        model_id = "m"

        def generate(self, system, user, images=None):
            return "reply"

    cap = DailyCap(1)
    llm = CappedLLM(Inner(), cap, "l_abc")
    assert llm.generate("s", "u") == "reply" and llm.model_id == "m"
    with pytest.raises(RuntimeError):
        llm.generate("s", "u")
    assert CappedLLM(Inner(), cap, "l_other").generate("s", "u") == "reply"


def test_roster_public_without_list_allows_only_guests(tmp_path):
    r = Roster(tmp_path / "roster.txt", tmp_path / "guests.txt", public=True, guests_enabled=True)
    assert r.required and not r.allowed("l_abcd")
    g = r.new_guest()
    assert r.allowed(g)
    again = Roster(tmp_path / "roster.txt", tmp_path / "guests.txt", public=True, guests_enabled=True)
    assert again.allowed(g)                       # guest codes survive a restart


def test_roster_with_class_list(tmp_path):
    (tmp_path / "roster.txt").write_text("l_abc123\nnot a code\n", encoding="utf-8")
    r = Roster(tmp_path / "roster.txt", tmp_path / "guests.txt", public=True, guests_enabled=False)
    assert r.allowed("l_abc123") and not r.allowed("l_zzz999")
    with pytest.raises(PermissionError):
        r.new_guest()


def test_roster_on_laptop_allows_any_wellformed_code(tmp_path):
    r = Roster(tmp_path / "roster.txt", tmp_path / "guests.txt", public=False, guests_enabled=False)
    assert not r.required and r.allowed("l_demo") and not r.allowed("bad code")


def test_compiler_env_has_no_secrets(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("SPROUT_SOMETHING", "x")
    env = safe_env()
    assert "ANTHROPIC_API_KEY" not in env and "SPROUT_SOMETHING" not in env


def _request(host, origin=None):
    headers = [(b"host", host.encode())]
    if origin:
        headers.append((b"origin", origin.encode()))
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers})


def test_allowed_hosts_from_env(monkeypatch):
    monkeypatch.setenv("SPROUT_ALLOWED_HOSTS", "lab.example.org")
    monkeypatch.setenv("RENDER_EXTERNAL_HOSTNAME", "sprout-weblab.onrender.com")
    assert is_local(_request("lab.example.org"))
    assert is_local(_request("sprout-weblab.onrender.com", "https://sprout-weblab.onrender.com"))
    assert not is_local(_request("sprout-weblab.onrender.com", "https://evil.example"))
    assert not is_local(_request("evil.example"))
    assert "lab.example.org" in public.allowed_hosts()
