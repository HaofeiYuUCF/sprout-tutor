"""Copy pilot photos into data/photos/ with random IDs, strip EXIF, append manifest rows.

Usage: python scripts/import_photos.py <folder> --set test|dev --lighting lamp|room --camera phone
The original-name → photo_id mapping is printed once; keep it with key.csv OFF the repository.
"""

from __future__ import annotations

import argparse
import csv
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "data" / "photos"
MANIFEST = ROOT / "eval" / "photo" / "manifest.csv"


def strip_exif(src: Path, dst: Path) -> None:
    try:
        from PIL import Image
    except ImportError:
        sys.exit("Pillow is required: pip install pillow")
    with Image.open(src) as im:
        clean = Image.new(im.mode, im.size)
        clean.putdata(list(im.getdata()))
        clean.save(dst, quality=95)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("folder", type=Path)
    p.add_argument("--set", choices=["dev", "test"], required=True)
    p.add_argument("--lighting", default="")
    p.add_argument("--camera", default="phone")
    a = p.parse_args()
    PHOTOS.mkdir(parents=True, exist_ok=True)
    files = sorted(f for f in a.folder.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
    secrets.SystemRandom().shuffle(files)
    print("original_name,photo_id   <- add this column to key.csv; do not commit it")
    with open(MANIFEST, "a", newline="", encoding="utf-8") as m:
        w = csv.writer(m)
        for f in files:
            pid = f"p_{secrets.token_hex(4)}"
            strip_exif(f, PHOTOS / f"{pid}{'.png' if f.suffix.lower() == '.png' else '.jpg'}")
            w.writerow([pid, a.set, a.lighting, a.camera])
            print(f"{f.name},{pid}")


if __name__ == "__main__":
    main()
