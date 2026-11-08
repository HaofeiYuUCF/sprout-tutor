"""sprout command line: doctor | validate | compile | run | eval guardrail | eval photo."""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

from . import __version__
from .config import load_settings, repo_root
from .content import ContentError, load_cards, load_skills


def _cli_paths(root: Path):
    s = load_settings(root)
    return root / s.board.arduino_cli, root / s.board.arduino_cli_config, s.board.fqbn


def cmd_doctor(args) -> int:
    root = repo_root()
    s = load_settings(root)
    print(f"sprout {__version__}  |  Python {platform.python_version()}  |  {platform.platform()}")
    print(f"repo root: {root}")
    print(f"board mode: {s.board.mode}  fqbn: {s.board.fqbn}  serial_port: {s.board.serial_port}")
    cli, cfg, _ = _cli_paths(root)
    if cli.exists():
        v = subprocess.run([str(cli), "version"], capture_output=True, text=True).stdout.strip()
        print(f"arduino-cli: {v}")
        cores = subprocess.run([str(cli), "--config-file", str(cfg), "core", "list", "--format",
                                "json"], capture_output=True, text=True).stdout
        try:
            data = json.loads(cores or "{}")
            items = data.get("platforms", data if isinstance(data, list) else [])
            ids = [f"{p.get('id')}@{p.get('installed_version') or p.get('installed')}" for p in items]
            print(f"installed cores: {', '.join(ids) or 'none'}")
        except json.JSONDecodeError:
            print("installed cores: (could not read)")
    else:
        print(f"arduino-cli: NOT FOUND at {cli} -> run scripts/setup_arduino_cli.ps1")
    try:
        from .hardware.ports import list_all
        ports = list_all()
        if not ports:
            print("serial ports: none (is the UNO plugged in?)")
        for p in ports:
            tag = p.kind or "not a recognized board"
            print(f"serial port: {p.device}  VID:PID {p.vid_pid}  {p.description}  -> {tag}")
    except Exception as e:  # pragma: no cover
        print(f"serial ports: error {e}")
    env = root / ".env"
    print(f".env present: {env.exists()}  |  LLM provider: {s.llm.provider}  model: {s.llm.model}")
    print(f"ANTHROPIC_API_KEY set: {'yes' if os.environ.get('ANTHROPIC_API_KEY') else 'no'}")
    return 0


def cmd_validate(args) -> int:
    root = repo_root()
    try:
        cards = load_cards(root)
        skills = load_skills(root)
    except (ContentError, ValueError) as e:
        print(f"INVALID: {e}")
        return 1
    for c in cards.values():
        print(f"ok  {c.id}: {len(c.card.steps)} steps, {len(c.faults.faults)} faults, "
              f"{len(c.checks.checks)} checks, seeds: {', '.join(c.seeds) or '-'}")
    for s in skills.values():
        print(f"ok  skill {s.name} v{s.version}")
    if not args.compile:
        return 0
    cli, cfg, fqbn = _cli_paths(root)
    if not cli.exists():
        print("skip compile: arduino-cli not installed")
        return 0
    from .hardware.board import ArduinoCliBoard
    board = ArduinoCliBoard(cli, cfg, fqbn, None)
    failed = 0
    for c in cards.values():
        for label, path in [("reference", c.reference.parent), ("starter", c.starter.parent)]:
            r = board.compile(path)
            print(f"{'ok ' if r.ok else 'ERR'} compile {c.id}/{label}")
            failed += 0 if r.ok else 1
        for fid, ino in c.seeds.items():
            fault = c.fault(fid)
            r = board.compile(ino.parent)
            if fault.fault_class == "compile":
                import re
                hit = any(re.search(fault.evidence.compile_regex or "^$", d.message)
                          for d in r.errors)
                good = (not r.ok) and hit
            else:
                good = r.ok
            print(f"{'ok ' if good else 'ERR'} seed {c.id}/{fid} (expected "
                  f"{'compile error' if fault.fault_class == 'compile' else 'clean compile'})")
            failed += 0 if good else 1
    return 1 if failed else 0


def cmd_compile(args) -> int:
    root = repo_root()
    cards = load_cards(root)
    c = cards[args.card]
    folder = c.seeds[args.seed].parent if args.seed else (
        Path(args.dir) if args.dir else c.reference.parent)
    cli, cfg, fqbn = _cli_paths(root)
    from .hardware.board import ArduinoCliBoard
    r = ArduinoCliBoard(cli, cfg, fqbn, None).compile(folder)
    print(f"compile {'OK' if r.ok else 'FAILED'} in {r.duration_s:.1f}s")
    for d in r.diagnostics:
        print(f"  {d.file}:{d.line}: {d.severity}: {d.message}")
    return 0 if r.ok else 1


def cmd_run(args) -> int:
    from .app.main import main as run_app
    run_app()
    return 0


def cmd_eval_guardrail(args) -> int:
    from .evaluation.guardrail_eval import run, summarize
    root = repo_root()
    provider = args.provider or load_settings(root).llm.provider
    out = run(root, provider, args.samples, root / "eval" / "guardrail" / "results")
    print(f"wrote {out}")
    for arm, (leaks, n) in summarize(out).items():
        print(f"  {arm:20s} leaks {leaks}/{n}")
    return 0


def cmd_eval_photo(args) -> int:
    print("Photo pilot scripts are scheduled for Nov 11. Follow eval/photo/README.md to shoot "
          "and rename photos now; keep the answer key off the repository.")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="sprout", description="SPROUT AI tutor prototype")
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("doctor", help="check arduino-cli, cores, board port, settings")
    d.set_defaults(fn=cmd_doctor)
    v = sub.add_parser("validate", help="load every card; optionally compile references and seeds")
    v.add_argument("--compile", action="store_true")
    v.set_defaults(fn=cmd_validate)
    c = sub.add_parser("compile", help="compile a card's reference, a seed, or a sketch folder")
    c.add_argument("card")
    c.add_argument("--seed")
    c.add_argument("--dir")
    c.set_defaults(fn=cmd_compile)
    sub.add_parser("run", help="start the student workbench").set_defaults(fn=cmd_run)
    e = sub.add_parser("eval", help="evaluation scripts")
    esub = e.add_subparsers(dest="which", required=True)
    g = esub.add_parser("guardrail", help="guardrail leak test")
    g.add_argument("--provider", choices=["mock", "anthropic"])
    g.add_argument("--samples", type=int, default=3)
    g.set_defaults(fn=cmd_eval_guardrail)
    esub.add_parser("photo", help="photo-check pilot").set_defaults(fn=cmd_eval_photo)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
