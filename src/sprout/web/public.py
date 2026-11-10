"""Settings and protections for running the Web Lab on a public server.

Everything is controlled by environment variables, so the same code runs on a laptop (all off)
and on a server (deploy/.env):

  SPROUT_PUBLIC=1             public mode: test tools off, "/" goes to the Web Lab, photos off
  SPROUT_ALLOWED_HOSTS=a,b    host names the site is served under (besides localhost; on Render the
                              <name>.onrender.com name is added automatically)
  SPROUT_TRUST_PROXY=1        take the client address from X-Forwarded-For (behind Caddy)
  SPROUT_GUEST=1              allow "Try it as a guest" (random code, no class list needed)
  SPROUT_ROSTER=path          class list, one student code per line (default data/roster.txt)
  SPROUT_AI_PER_DAY=30        AI hints per student per day (curated hints are never capped)
  SPROUT_COMPILE_PER_MIN=20   compiles per client address per minute
  SPROUT_HINT_PER_MIN=10      hint requests per client address per minute
  SPROUT_GROW_CONTACT=text    address or link shown to guests who are interested in Grow teams
  SPROUT_PHOTO_CHECK=0        turn the photo wiring check off (it is on when AI hints are on)
  SPROUT_PHOTO_PER_DAY=15     photo checks per student per day
  SPROUT_PHOTO_PER_MIN=20     photo checks per client address per minute
  SPROUT_PHOTO_KEEP=1         store checked photos under data/photos (pilot studies, with consent)
"""

from __future__ import annotations

import os
import re
import secrets
import threading
import time
from collections import deque
from datetime import date
from pathlib import Path

LOCAL_HOSTS = {"127.0.0.1", "localhost"}
CODE = re.compile(r"^l_[a-z0-9]{3,12}$")
INCLUDE = re.compile(r'^\s*#\s*include\s*([<"])([^>"\n]*)[>"]?', re.M)
SAFE_HEADER = re.compile(r"^[A-Za-z0-9_]+(\.h)?$")
# Environment passed to arduino-cli: enough to run, nothing secret (no API keys).
ENV_KEEP = ("PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA",
            "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL")


def flag(name: str) -> bool:
    return os.environ.get(name, "") == "1"


def public_mode() -> bool:
    return flag("SPROUT_PUBLIC")


def allowed_hosts() -> set[str]:
    names = os.environ.get("SPROUT_ALLOWED_HOSTS", "").split(",")
    names.append(os.environ.get("RENDER_EXTERNAL_HOSTNAME", ""))   # set by Render: <name>.onrender.com
    return LOCAL_HOSTS | {h.strip().lower() for h in names if h.strip()}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def safe_env() -> dict[str, str]:
    """The environment for compiler runs: no secrets, so student code cannot reveal any."""
    return {k: v for k, v in os.environ.items() if k in ENV_KEEP}


def check_includes(code: str) -> str | None:
    """Student sketches may include library headers by name (<Servo.h>), never files by path.

    Returns a student-friendly reason if the code is refused, else None.
    """
    for m in INCLUDE.finditer(code):
        delim, name = m.group(1), m.group(2).strip()
        if delim == '"' or not SAFE_HEADER.match(name):
            return (f"This #include is not allowed here: {m.group(0).strip()}. "
                    "Use library names like #include <Servo.h>.")
    return None


class RateLimiter:
    """At most `limit` events per key in a sliding window of `window_s` seconds."""

    def __init__(self, limit: int, window_s: float):
        self.limit, self.window = limit, window_s
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self._hits) > 10_000:          # forget idle clients
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return True


class DailyCap:
    """At most `limit` uses per key per calendar day."""

    def __init__(self, limit: int):
        self.limit = limit
        self._counts: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    def take(self, key: str) -> bool:
        day = date.today().isoformat()
        with self._lock:
            n = self._counts.get((key, day), 0)
            if n >= self.limit:
                return False
            self._counts[(key, day)] = n + 1
            return True


class CappedLLM:
    """Wraps the tutor's LLM: past the daily cap it raises, and the tutor falls back to its
    general advice (curated hints never reach the LLM, so they are unaffected)."""

    def __init__(self, inner, cap: DailyCap, key: str):
        self.inner, self.cap, self.key = inner, cap, key

    @property
    def model_id(self) -> str:
        return getattr(self.inner, "model_id", "unknown")

    def generate(self, system: str, user: str, images=None):
        if not self.cap.take(self.key):
            raise RuntimeError("daily AI hint limit reached")
        return self.inner.generate(system, user, images)


class Roster:
    """Who may use the site.

    With a class list (one code per line), only those codes and issued guest codes are allowed.
    In public mode without a list, only guest codes are allowed. On a laptop without a list,
    any well-formed code works (the test setup used so far).
    """

    def __init__(self, path: Path, guests_path: Path, public: bool, guests_enabled: bool):
        self.path, self.guests_path = path, guests_path
        self.public, self.guests_enabled = public, guests_enabled
        self._lock = threading.Lock()
        self.codes = self._read(path)
        self.guests = self._read(guests_path)

    @staticmethod
    def _read(p: Path) -> set[str]:
        if not p.exists():
            return set()
        return {ln.strip().lower() for ln in p.read_text(encoding="utf-8").splitlines()
                if CODE.match(ln.strip().lower())}

    @property
    def required(self) -> bool:
        return bool(self.codes) or self.public

    def allowed(self, code: str) -> bool:
        if not CODE.match(code or ""):
            return False
        if not self.required:
            return True
        return code in self.codes or code in self.guests

    def new_guest(self) -> str:
        if not self.guests_enabled:
            raise PermissionError("guest access is off")
        with self._lock:
            while True:
                code = "l_g" + "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(7))
                if code not in self.guests and code not in self.codes:
                    break
            self.guests.add(code)
            self.guests_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.guests_path, "a", encoding="utf-8") as f:
                f.write(code + "\n")
            return code
