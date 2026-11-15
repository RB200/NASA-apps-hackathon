"""Extract compact height grids from the LOLA 5 m south-pole IMG for the web viewer.

Run with bytecode disabled:
  python3 -B data_prep/prepare_lola_3d.py

The overview samples the whole raster at 160 m spacing. The local tile keeps
the source's native 5 m pixels around De Gerlache Rim 2.
"""
from __future__ import annotations

import argparse
import json
import math
import mmap
import re
import struct
from pathlib import Path

MOON_RADIUS_M = 1_737_400.0
OVERVIEW_STRIDE = 32
DETAIL_SIZE = 512
DETAIL_STRIDE = 1
DETAIL_CENTER = (-88.2, -64.4)  # approximate center of the De Gerlache Rim 2 candidate region
CRATER_CENTER = (-88.029, 132.8)  # floor of the large crater shown in the polar overview
CRATER_SPAWN_OFFSET = (5000.0, -5000.0)  # inside the bowl, facing the far wall
CRATER_OVERVIEW_SIZE = 1024
CRATER_OVERVIEW_STRIDE = 4  # 20 m/sample over a 20.48 km square


def label_value(label: str, key: str) -> str:
    match = re.search(rf"^\s*{re.escape(key)}\s*=\s*([^\r\n]+)", label, re.MULTILINE)
    if not match:
        raise ValueError(f"Missing {key} in PDS label")
    return match.group(1).split("<", 1)[0].strip().strip('"')


def write_sampled_grid(source: mmap.mmap, source_cols: int, source_rows: int,
                       first_row: int, first_col: int, width: int, height: int,
                       stride: int, destination: Path) -> None:
    output = bytearray(width * height * 2)
    for out_row in range(height):
        src_row = first_row + out_row * stride
        if not 0 <= src_row < source_rows:
            raise ValueError("Requested grid exceeds source rows")
        for out_col in range(width):
            src_col = first_col + out_col * stride
            if not 0 <= src_col < source_cols:
                raise ValueError("Requested grid exceeds source columns")
            value = struct.unpack_from("<h", source, 2 * (src_row * source_cols + src_col))[0]
            struct.pack_into("<h", output, 2 * (out_row * width + out_col), value)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path,
                        default=Path.home() / "Desktop/nasa data/downloads/ldem_875s_5m.img")
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parent.parent / "frontend" / "assets")
    args = parser.parse_args()
    image = args.image.expanduser()
    label_path = image.with_suffix(".lbl")
    label = label_path.read_text(encoding="utf-8")
    rows = int(label_value(label, "LINES"))
    cols = int(label_value(label, "LINE_SAMPLES"))
    scale = float(label_value(label, "SCALING_FACTOR"))
    offset = float(label_value(label, "OFFSET"))
    pixel_m = float(label_value(label, "MAP_SCALE"))
    line_offset = float(label_value(label, "LINE_PROJECTION_OFFSET"))
    sample_offset = float(label_value(label, "SAMPLE_PROJECTION_OFFSET"))
    expected_size = rows * cols * 2
    if image.stat().st_size != expected_size:
        raise ValueError(f"Unexpected image size: expected {expected_size} bytes")

    args.output.mkdir(parents=True, exist_ok=True)
    overview_width = math.ceil(cols / OVERVIEW_STRIDE)
    overview_height = math.ceil(rows / OVERVIEW_STRIDE)

    # Convert the selected planetocentric coordinate into the PDS polar-stereographic grid.
    lat, lon = DETAIL_CENTER
    def source_window(center_lat: float, center_lon: float, size: int,
                      stride: int) -> tuple[int, int]:
        rho = 2 * MOON_RADIUS_M * math.tan(math.radians(90 + center_lat) / 2)
        x = rho * math.sin(math.radians(center_lon))
        y = -rho * math.cos(math.radians(center_lon))
        center_col = round(x / pixel_m + sample_offset - 1)
        center_row = round(line_offset - y / pixel_m - 1)
        half_span = size * stride // 2
        return center_row - half_span, center_col - half_span

    detail_first_row, detail_first_col = source_window(lat, lon, DETAIL_SIZE, DETAIL_STRIDE)
    crater_lat, crater_lon = CRATER_CENTER
    crater_first_row, crater_first_col = source_window(
        crater_lat, crater_lon, CRATER_OVERVIEW_SIZE, CRATER_OVERVIEW_STRIDE)
    def polar_xy(center_lat: float, center_lon: float) -> tuple[float, float]:
        rho = 2 * MOON_RADIUS_M * math.tan(math.radians(90 + center_lat) / 2)
        return (rho * math.sin(math.radians(center_lon)),
                -rho * math.cos(math.radians(center_lon)))

    crater_x, crater_y = polar_xy(crater_lat, crater_lon)
    spawn_x = crater_x + CRATER_SPAWN_OFFSET[0]
    spawn_y = crater_y + CRATER_SPAWN_OFFSET[1]
    spawn_rho = math.hypot(spawn_x, spawn_y)
    spawn_lat = math.degrees(2 * math.atan(spawn_rho / (2 * MOON_RADIUS_M))) - 90
    spawn_lon = math.degrees(math.atan2(spawn_x, -spawn_y))
    crater_detail_first_row, crater_detail_first_col = source_window(
        spawn_lat, spawn_lon, DETAIL_SIZE, DETAIL_STRIDE)

    with image.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as source:
        write_sampled_grid(source, cols, rows, 0, 0, overview_width, overview_height,
                           OVERVIEW_STRIDE, args.output / "lunar-south-pole-overview-i16.bin")
        write_sampled_grid(source, cols, rows, detail_first_row, detail_first_col,
                           DETAIL_SIZE, DETAIL_SIZE, DETAIL_STRIDE,
                           args.output / "de-gerlache-detail-5m-i16.bin")
        write_sampled_grid(source, cols, rows, crater_first_row, crater_first_col,
                           CRATER_OVERVIEW_SIZE, CRATER_OVERVIEW_SIZE,
                           CRATER_OVERVIEW_STRIDE,
                           args.output / "polar-crater-overview-i16.bin")
        write_sampled_grid(source, cols, rows, crater_detail_first_row, crater_detail_first_col,
                           DETAIL_SIZE, DETAIL_SIZE, DETAIL_STRIDE,
                           args.output / "polar-crater-detail-5m-i16.bin")

    metadata = {
        "columns": cols,
        "rows": rows,
        "pixelSizeM": pixel_m,
        "heightScaleM": scale,
        "referenceRadiusM": offset,
        "lineProjectionOffset": line_offset,
        "sampleProjectionOffset": sample_offset,
        "overview": {"file": "lunar-south-pole-overview-i16.bin", "width": overview_width,
                     "height": overview_height, "stridePixels": OVERVIEW_STRIDE},
        "detail": {"file": "de-gerlache-detail-5m-i16.bin", "width": DETAIL_SIZE,
                   "height": DETAIL_SIZE, "stridePixels": DETAIL_STRIDE,
                   "firstRow": detail_first_row, "firstColumn": detail_first_col,
                   "centerLatitude": lat, "centerLongitude": lon},
        "crater": {"file": "polar-crater-overview-i16.bin", "width": CRATER_OVERVIEW_SIZE,
                   "height": CRATER_OVERVIEW_SIZE, "stridePixels": CRATER_OVERVIEW_STRIDE,
                   "firstRow": crater_first_row, "firstColumn": crater_first_col,
                   "centerLatitude": crater_lat, "centerLongitude": crater_lon},
        "craterDetail": {"file": "polar-crater-detail-5m-i16.bin", "width": DETAIL_SIZE,
                         "height": DETAIL_SIZE, "stridePixels": DETAIL_STRIDE,
                         "firstRow": crater_detail_first_row,
                         "firstColumn": crater_detail_first_col,
                         "centerLatitude": spawn_lat, "centerLongitude": spawn_lon,
                         "offsetX": CRATER_SPAWN_OFFSET[0], "offsetZ": CRATER_SPAWN_OFFSET[1]},
        "craterSpawn": {"offsetX": CRATER_SPAWN_OFFSET[0],
                        "offsetZ": CRATER_SPAWN_OFFSET[1],
                        "centerLatitude": spawn_lat, "centerLongitude": spawn_lon},
    }
    (args.output / "lola-5m-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Wrote {overview_width}×{overview_height} overview at {pixel_m * OVERVIEW_STRIDE:g} m/sample")
    print(f"Wrote {DETAIL_SIZE}×{DETAIL_SIZE} native {pixel_m:g} m detail tile near {lat:.1f}°, {lon:.1f}°")
    print(f"Wrote {CRATER_OVERVIEW_SIZE}×{CRATER_OVERVIEW_SIZE} crater tile at {pixel_m * CRATER_OVERVIEW_STRIDE:g} m/sample")
    print(f"Wrote {DETAIL_SIZE}×{DETAIL_SIZE} native {pixel_m:g} m detail tile at the crater walk start")


if __name__ == "__main__":
    main()
