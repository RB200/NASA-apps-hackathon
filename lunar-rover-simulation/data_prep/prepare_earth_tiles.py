"""Pre-cut Earth rover tiles for each region's best Earth analog (used when the backend is offline).

    backend/.venv/bin/python -B lunar-rover-simulation/data_prep/prepare_earth_tiles.py

The tile maths lives in backend/rover_tiles.py (also used by the backend's /rover-tile endpoint for
any match): 512 x 512 at 30 m (15.36 km), little-endian int16 metres, row 0 north, from NASA SRTMGL1
(ASTGTM above 60°N, SRTMGL3 as a last resort). The analog for each region comes from the backend's
own ranking (all five terrain features).

Output: lunar-rover-simulation/frontend/assets/earth/<site>-30m-i16.bin + earth-metadata.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "lunar-rover-simulation" / "frontend" / "assets" / "earth"
FEATURES = ["meanSlope", "p90Slope", "roughness", "relief", "shape"]

sys.path.insert(0, str(ROOT / "backend"))
import app  # noqa: E402  (backend ranking + real data)
import rover_tiles  # noqa: E402


def site_id(name: str, lat: float, lon: float) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return f"{slug}-{abs(lat):.2f}{'n' if lat >= 0 else 's'}-{abs(lon):.2f}{'e' if lon >= 0 else 'w'}"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sites, regions = {}, {}
    for region in sorted(app.MOON):
        m = app.match(region, FEATURES, 1, False)["matches"][0]
        sid = site_id(m["name"], m["lat"], m["lon"])
        regions[region] = {"site": sid, "match": m["match"]}
        if sid in sites:
            continue
        grid, source = rover_tiles.build_tile(m["lat"], m["lon"])
        file = f"{sid}-30m-i16.bin"
        (OUT / file).write_bytes(grid.tobytes())
        sites[sid] = {
            "file": file, "width": rover_tiles.SIZE, "height": rover_tiles.SIZE, "stridePixels": 1,
            "pixelSizeM": rover_tiles.SPACING_M, "heightScaleM": 1.0,
            "centerLatitude": m["lat"], "centerLongitude": m["lon"],
            "name": m["name"], "country": m["country"], "near": m.get("near"), "demSource": source,
            "minM": int(grid.min()), "maxM": int(grid.max()),
        }
        print(f"{region:20s} → {m['name']}, {m['country']} ({m['match']:.0f}%)  "
              f"{int(grid.min())}–{int(grid.max())} m  [{source}]")

    metadata = {
        "body": "earth",
        "gravity": 9.81,
        "source": "NASA SRTMGL1 v003 (1 arc-second, ~30 m), resampled to a 30 m local grid",
        "tileSizeKm": rover_tiles.SIZE * rover_tiles.SPACING_M / 1000,
        "sites": sites,
        "regions": regions,
    }
    (OUT / "earth-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"wrote {len(sites)} Earth tiles for {len(regions)} regions → {OUT}")


if __name__ == "__main__":
    main()
