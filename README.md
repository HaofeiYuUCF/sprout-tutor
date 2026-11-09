# sprout-tutor

Prototype of the **SPROUT AI tutor** (USDA NIFA HSI Education proposal, UCF + Valencia College).
Students work through short Arduino "cards" for greenhouse and irrigation sensing. A tutor
gives hints, not answers: known faults get instructor-written hints on a 4-step ladder
(where → general check → specific issue → fix); unknown problems go to an LLM whose replies are
filtered in code.

Status: pre-release, private. See `LICENSE-TBD.md`.

## Windows setup
```powershell
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
.\scripts\setup_arduino_cli.ps1        # arduino-cli + AVR core into tools/ (git-ignored)
copy .env.example .env                 # add ANTHROPIC_API_KEY only if you run evaluations
.venv\Scripts\sprout doctor            # paste this output when reporting a problem
```

## Run
```powershell
.venv\Scripts\sprout run               # workbench at http://localhost:8080/?learner=l_demo
```
`config/settings.yaml` → `board.mode: fake` runs without hardware; set `real` with an UNO plugged in.

## Commands
| Command | What it does |
|---|---|
| `sprout doctor` | arduino-cli and core versions, detected board (VID:PID, 16U2 or CH340), settings |
| `sprout validate [--compile]` | load every card; with `--compile`, compile references, starters and seeded faults |
| `sprout compile <card> [--seed <fault>]` | compile one sketch |
| `sprout run` | start the workbench |
| `sprout eval guardrail [--provider mock\|anthropic] [--samples N]` | guardrail leak test |
| `sprout eval photo` | photo-check pilot (protocol in `eval/photo/README.md`) |

## Layout
- `cards/<id>/`: `card.yaml` (steps, objectives, agriculture link, safety), `faults.yaml` (evidence + 4-step hints), `checks.yaml`, `circuit.yaml`, `starter/`, `reference/` (never shown to students), `seeds/<fault>/`
- `skills/hint-ladder/SKILL.md`, `prompts/tutor_system.md`: how the LLM writes hints
- `config/policy.yaml`: ladder entry steps, unlock events, guardrail limits (versioned)
- `src/sprout/`: `hardware/` (board, ports, serial broker), `tutor/` (matcher, ladder, checks, guardrail, llm, orchestrator), `events.py`, `progress.py`, `app/`
- `eval/`: guardrail leak test and photo pilot
- `data/` (git-ignored): `work/` sketches, `events/` JSONL logs, `learners/` readable progress files, `cache/`, `photos/`

## Data and privacy
Learner IDs are pseudonymous (`l_xxxx`); the name mapping is kept outside the repository.
Events log the hint step, source (curated or LLM), model ID, policy version and code hashes.
`python scripts/export_events.py out.csv --redact` removes student free text for the external
evaluator. Photos and answer keys never enter the repository. API keys live only in `.env`.

## Windows notes
- CH340 boards are not identified by `arduino-cli board list`; `sprout doctor` finds them by VID:PID.
- The first AVR compile is slow under Defender; consider excluding `tools/`.
- Port 8080 busy? Set `SPROUT_UI_PORT`.
- Keep the repository outside OneDrive to avoid sync locks on build files.

## Web Lab (feasibility test, this computer only)

Tests whether a no-install web version can work: the server compiles, and the browser uploads
to the UNO over Web Serial (Chrome or Edge only). Nothing is open to other machines.

1. Close the Arduino IDE. Keep `board.mode: fake` so the desktop workbench does not hold the COM port.
2. Run `.venv\Scripts\sprout run`, then open **http://localhost:8080/weblab** in Chrome or Edge.
3. Plug in the UNO, then: Connect board → choose the port → Upload to board. The "Hello UNO" sketch
   needs no parts: the "L" LED blinks and the serial monitor counts.
4. Each upload is logged in `data/weblab/upload_trials.jsonl` (success, error type, time, USB chip
   ID; no names or code), for the reliability numbers.

Uploader tests without a board: start with `SPROUT_WEBLAB_TEST=1`, then open
http://localhost:8080/weblab/test/stk500_test.html (simulated bootloader, 12 checks).
