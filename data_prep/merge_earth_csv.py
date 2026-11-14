"""Merge the per-tile Earth Engine CSVs into backend/data/earth_patches.csv.

  python data_prep/merge_earth_csv.py ~/Downloads/space_broncos_export/*.csv

Drops rows with missing numbers and duplicate patches (tiles can share edge patches).
Leaves name/country blank; the frontend shows coordinates for unnamed patches.
"""
import csv
import math
import sys
from pathlib import Path

COLUMNS = ["lat", "lon", "meanSlope", "p90Slope", "roughness", "relief", "bareFrac", "snowFrac"]
OUT = Path(__file__).resolve().parent.parent / "backend" / "data" / "earth_patches.csv"


def main(paths):
    if not paths:
        sys.exit(__doc__)
    seen, rows, bad = set(), [], 0
    for p in paths:
        with open(p, newline="") as f:
            for r in csv.DictReader(f):
                try:
                    vals = {k: float(r[k]) for k in COLUMNS}
                except (KeyError, TypeError, ValueError):
                    bad += 1
                    continue
                if not all(math.isfinite(v) for v in vals.values()):
                    bad += 1
                    continue
                key = (round(vals["lat"], 3), round(vals["lon"], 3))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(vals)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS + ["name", "country"])
        for v in rows:
            w.writerow([f"{v['lat']:.4f}", f"{v['lon']:.4f}"] + [f"{v[k]:.3f}" for k in COLUMNS[2:]] + ["", ""])
    print(f"wrote {len(rows)} patches to {OUT} ({bad} bad rows skipped, {len(paths)} files)")


if __name__ == "__main__":
    main(sys.argv[1:])
