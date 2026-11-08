# Editing cards and hints

## Add a card
1. Copy an existing folder in `cards/`; rename it to a valid sketch name (letters, digits, `_`).
2. Set `id` in `card.yaml` to the folder name. Fill in objectives, the agriculture connection,
   safety notes, the Tinkercad step, and the five steps (simulate, build, code, run, reflect).
3. `starter/starter.ino` and `reference/reference.ino` must each sit in a folder of the same name.
4. Run `sprout validate --compile`.

## Add a fault
Each fault in `faults.yaml` needs: `id`, `class` (compile / wiring / logic / serial), a `title`,
at least one trigger in `evidence`, and exactly four `hints`:
1. **Where**: hardware, software, or both, and why.
2. **General check**: one concrete thing to check.
3. **Specific issue**: name the problem, not the fix.
4. **Fix**: describe the change in words. Never paste a complete sketch or function.

Code-detectable faults should have a seed sketch in `seeds/<fault_id>/<fault_id>.ino`.
Mark faults that can hurt a part or a person `safety_critical: true` and start hint 1 with
"Unplug the USB cable".

## Rules for hint text
Plain language (about grade 9), 80–160 words at most, one idea per hint. Do not assume
evidence the student may not have yet (for example, serial output before the first upload).
