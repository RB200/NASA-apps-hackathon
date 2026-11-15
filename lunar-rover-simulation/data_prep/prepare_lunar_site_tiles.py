"""Extract 20 m LOLA terrain tiles for the nine south-pole candidate sites.

Run from the repository root with bytecode disabled:
  python3 -B lunar-rover-simulation/data_prep/prepare_lunar_site_tiles.py

The script reads the candidate centers from frontend/regions.js and the NASA
LDEM_80S_20M raster, then writes compact 20.48 km square tiles for the rover UI.
"""
from __future__ import annotations

import json
import math
import mmap
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGIONS_JS = ROOT / "frontend" / "regions.js"
DEFAULT_IMAGE = Path.home() / "Desktop/nasa data/downloads/ldem_80s_20m.img"
OUTPUT = ROOT / "lunar-rover-simulation/frontend/assets/moon-sites"
TILE_SIZE = 1024


def label_value(label: str, key: str) -> str:
    match = re.search(rf"^\s*{re.escape(key)}\s*=\s*([^\r\n]+)", label, re.MULTILINE)
    if not match:
        raise ValueError(f"Missing {key} in PDS label")
    return match.group(1).split("<", 1)[0].strip().strip('"')


def read_regions() -> list[dict]:
    source = REGIONS_JS.read_text(encoding="utf-8")
    entries = re.findall(r"\{([^{}]*\bid:\s*'[^']+'[^{}]*)\}", source)
    regions = []
    for entry in entries:
        def field(pattern: str, cast):
            match = re.search(pattern, entry)
            if not match:
                raise ValueError(f"Could not parse landing site entry: {entry}")
            return cast(match.group(1))

        regions.append({
            "id": field(r"\bid:\s*'([^']+)'", str),
            "name": field(r"\bname:\s*'([^']+)'", str),
            "latitude": field(r"\blat:\s*(-?[\d.]+)", float),
            "longitude": field(r"\blon:\s*(-?[\d.]+)", float),
        })
    if not regions:
        raise ValueError(f"No candidate regions found in {REGIONS_JS}")
    return regions


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE,
                        help="NASA LDEM_80S_20M IMG raster")
    args = parser.parse_args()
    image = args.image.expanduser()
    label_path = image.with_suffix(".lbl")
    label = label_path.read_text(encoding="utf-8")
    rows = int(label_value(label, "LINES"))
    cols = int(label_value(label, "LINE_SAMPLES"))
    scale = float(label_value(label, "SCALING_FACTOR"))
    pixel_m = float(label_value(label, "MAP_SCALE"))
    line_offset = float(label_value(label, "LINE_PROJECTION_OFFSET"))
    sample_offset = float(label_value(label, "SAMPLE_PROJECTION_OFFSET"))
    if image.stat().st_size != rows * cols * 2:
        raise ValueError("Raster size does not match its PDS label")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    metadata = {
        "body": "moon",
        "source": "NASA LRO LOLA LDEM_80S_20M",
        "width": TILE_SIZE,
        "height": TILE_SIZE,
        "stridePixels": 1,
        "pixelSizeM": pixel_m,
        "heightScaleM": scale,
        "sites": {},
    }
    half = TILE_SIZE // 2
    with image.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as source:
        for site in read_regions():
            lat, lon = site["latitude"], site["longitude"]
            rho = 2 * 1_737_400.0 * math.tan(math.radians(90 + lat) / 2)
            x = rho * math.sin(math.radians(lon))
            y = -rho * math.cos(math.radians(lon))
            center_col = round(x / pixel_m + sample_offset - 1)
            center_row = round(line_offset - y / pixel_m - 1)
            first_row, first_col = center_row - half, center_col - half
            if first_row < 0 or first_col < 0 or first_row + TILE_SIZE > rows or first_col + TILE_SIZE > cols:
                raise ValueError(f"Tile for {site['id']} exceeds source coverage")

            filename = f"{site['id']}-20m-i16.bin"
            output = bytearray(TILE_SIZE * TILE_SIZE * 2)
            for row in range(TILE_SIZE):
                source_offset = 2 * ((first_row + row) * cols + first_col)
                destination_offset = row * TILE_SIZE * 2
                output[destination_offset:destination_offset + TILE_SIZE * 2] = source[
                    source_offset:source_offset + TILE_SIZE * 2
                ]
            (OUTPUT / filename).write_bytes(output)
            metadata["sites"][site["id"]] = {
                **site,
                "file": filename,
                "firstRow": first_row,
                "firstColumn": first_col,
                "centerLatitude": lat,
                "centerLongitude": lon,
            }
            print(f"Wrote {filename} centered at {lat:.4f}°, {lon:.4f}°")

    (OUTPUT / "moon-sites.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
