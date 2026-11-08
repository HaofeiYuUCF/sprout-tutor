# Photo-check pilot: protocol

Goal: measure how often the photo check raises **false flags on correct builds**, and whether
it detects two photo-visible faults, comparing a direct vision-model judgement with the
structured pipeline (inventory → netlist → comparison in code). Circuit: card `c03_heat_alarm`.

## Photo set (30–36 photos)
| Condition | Count | Notes |
|---|---|---|
| Correct build | 12–15 | Vary wire routing, rows and wire colours |
| Wrong pin / open row | ~10 | e.g., LED wire on pin 7; sensor middle leg one row off |
| Missing component | ~8 | resistor removed; one jumper removed |

Unseated legs and a reversed LED are **not** photo-visible; they are left to serial evidence and
listed in the fault-by-channel table instead.

Two lighting conditions (desk lamp; room light). Phone held top-down at a fixed height (a stand
or a stack of books), whole breadboard and the UNO header in frame.

## Blinding (the analyst never sees labels before scoring)
1. The graduate student builds each condition and photographs it.
2. The graduate student keeps `key.csv` (`original_name, condition, fault`) on their own drive,
   never in this repository.
3. Run `python scripts/import_photos.py <folder> --set test` (or `--set dev`). It copies
   photos to `data/photos/` with random IDs, strips EXIF, and appends rows to `manifest.csv`
   (`photo_id, set, lighting, camera`) with no condition labels. It prints the
   `original_name → photo_id` mapping once; the graduate student adds that column to `key.csv`.
4. Shoot a separate **dev set of 6 photos**. Prompts are tuned only on the dev set and then
   frozen in `prompts/v1/` (their sha256 is recorded in results).
5. Run both arms on the test set, then the graduate student runs the scorer with `--key`.

## Outputs
Sensitivity and specificity with Wilson 95% intervals; false-flag rate on correct builds
(headline); a fault-by-channel table (photo / serial / both / neither).
