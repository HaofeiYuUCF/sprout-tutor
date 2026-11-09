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

Student flow (designed from a first-time-student walkthrough): sign in with the student code the
instructor hands out (e.g. `l_ab12`; no names) -> choose a card -> work through seven steps, each
showing only what it needs, with the instructions directly above: 1 meet the project, 2 wire it in
the simulator (**Test my wiring** runs a built-in test program, so no code is needed yet), 3 write
the code (the starter's `// TODO` lines become a checklist), 4 try it in the simulator, 5 build it
(the student's own simulator wiring is shown as the build picture), 6 send it to the real board and
check, 7 think about it (the answer autosaves). **Need help?** opens the tutor from any step. A
"Check that my board works" flow tests a new UNO with no parts. Code, wiring and answers autosave per
learner and card (`data/work/<learner>/<card>/`); **All cards** keeps the work, **Start over** deletes
it. Checks in the simulator are logged with `source: sim` and mark "works in the simulator"; only
real-board output completes a card.

Tutor in the Web Lab: pick a card (not the hello test) to see its steps, use **Check my work**,
and **Get a hint**. The hint ladder, guardrails and the API key stay on the server; the browser
sends only the code, recent serial lines and the student's message. Add `?learner=l_ab12` to the
URL for an anonymous learner ID (events go to `data/events/`, same format as the desktop app).
Set `SPROUT_LLM_PROVIDER=anthropic` in `.env` for real AI hints; curated hints need no AI.
In test mode the Sketch list also offers the seeded-fault sketches for demos.

Simulator (no board needed): the parts follow the selected card (LED and resistor for c01, TMP36
with a temperature slider for c02, all three for c03; LED test otherwise). Drag the parts onto
the breadboard, click pin-to-hole to add wires, and press **Run in simulator**. The sketch in the
editor is compiled on the server and runs on an emulated ATmega328P in the browser, using
[avr8js](https://github.com/wokwi/avr8js) 0.21.1 (MIT, vendored in `src/sprout/web/static/vendor/avr8js`,
see `VENDORED.md`). Drawings and circuit rules are our own. Rule-based feedback covers a backwards
LED, a missing resistor, a short to GND, a wire on a different pin than the code drives, a TMP36
turned around (5V and GND swapped), and Vout on a different analog pin than the code reads.
Simulated serial output also counts for **Check my work**.

Uploader tests without a board: start with `SPROUT_WEBLAB_TEST=1`, then open
http://localhost:8080/weblab/test/stk500_test.html (simulated bootloader, 12 checks).
