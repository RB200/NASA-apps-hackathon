"""Cut Earth rover tiles (same layout as the LOLA tiles) for each region's best Earth analog.

    backend/.venv/bin/python -B lunar-rover-simulation/data_prep/prepare_earth_tiles.py

Input:  NASA SRTMGL1 v003 (1 arc-second, ~30 m) tiles in data_prep/cache/srtmgl1/*.SRTMGL1.hgt.zip
        (download with earthaccess; see data_prep/README.md). The analog for each region comes from
        the backend's own ranking (all five terrain features, equal priority order).
Output: lunar-rover-simulation/frontend/assets/earth/<site>-30m-i16.bin   little-endian int16, 1 m per unit
        lunar-rover-simulation/frontend/assets/earth/earth-metadata.json

Each tile is a 512 x 512 grid at exactly 30 m (15.36 km square), bilinearly resampled from the
geographic SRTM grid onto a local east/north metre grid centred on the analog patch. Row 0 is north,
column 0 is west, matching how terrain.js lays out the Moon tiles.
"""
from __future__ import annotations

import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRTM = ROOT / "data_prep" / "cache" / "srtmgl1"
OUT = ROOT / "lunar-rover-simulation" / "frontend" / "assets" / "earth"
SIZE = 512
SPACING_M = 30.0
PX = 3600                      # SRTMGL1: 3601 x 3601 samples per 1° tile
FEATURES = ["meanSlope", "p90Slope", "roughness", "relief", "shape"]
M_PER_DEG = 111_320.0

sys.path.insert(0, str(ROOT / "backend"))
import app  # noqa: E402  (backend ranking + real data)


def tile_name(lat0: int, lon0: int) -> str:
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}"


_cache: dict[str, np.ndarray] = {}


def srtm_tile(lat0: int, lon0: int) -> np.ndarray:
    name = tile_name(lat0, lon0)
    if name not in _cache:
        path = SRTM / f"{name}.SRTMGL1.hgt.zip"
        if not path.exists():
            raise FileNotFoundError(f"missing {path.name}; download SRTMGL1 tile {name} first")
        with zipfile.ZipFile(path) as zf:
            member = next(n for n in zf.namelist() if n.lower().endswith(".hgt"))
            z = np.frombuffer(zf.read(member), ">i2").reshape(PX + 1, PX + 1).astype(np.float32)
        z[z == -32768] = np.nan
        _cache[name] = z
    return _cache[name]


def sample(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Bilinear SRTMGL1 height at each lat/lon, reading across tile edges."""
    out = np.full(lat.shape, np.nan, np.float32)
    lat0s, lon0s = np.floor(lat).astype(int), np.floor(lon).astype(int)
    for la0, lo0 in {(int(a), int(b)) for a, b in zip(lat0s.ravel(), lon0s.ravel())}:
        sel = (lat0s == la0) & (lon0s == lo0)
        z = srtm_tile(la0, lo0)
        r = (la0 + 1 - lat[sel]) * PX          # row 0 = north edge
        c = (lon[sel] - lo0) * PX
        r0 = np.clip(np.floor(r).astype(int), 0, PX - 1)
        c0 = np.clip(np.floor(c).astype(int), 0, PX - 1)
        fr, fc = r - r0, c - c0
        out[sel] = (z[r0, c0] * (1 - fr) * (1 - fc) + z[r0 + 1, c0] * fr * (1 - fc)
                    + z[r0, c0 + 1] * (1 - fr) * fc + z[r0 + 1, c0 + 1] * fr * fc)
    return out


def site_id(name: str, lat: float, lon: float) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return f"{slug}-{abs(lat):.2f}{'n' if lat >= 0 else 's'}-{abs(lon):.2f}{'e' if lon >= 0 else 'w'}"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    offs = ((np.arange(SIZE) - (SIZE - 1) / 2) * SPACING_M)
    north, east = np.meshgrid(-offs, offs, indexing="ij")    # row 0 = north, col 0 = west

    sites, regions = {}, {}
    for region in sorted(app.MOON):
        m = app.match(region, FEATURES, 1, False)["matches"][0]
        sid = site_id(m["name"], m["lat"], m["lon"])
        regions[region] = {"site": sid, "match": m["match"]}
        if sid in sites:
            continue
        lat = m["lat"] + north / M_PER_DEG
        lon = m["lon"] + east / (M_PER_DEG * math.cos(math.radians(m["lat"])))
        z = sample(lat, lon)
        if np.isnan(z).any():
            z[np.isnan(z)] = np.nanmedian(z)              # SRTMGL1 v3 is void-filled; this is a safety net
        grid = np.round(z).astype("<i2")
        file = f"{sid}-30m-i16.bin"
        (OUT / file).write_bytes(grid.tobytes())
        sites[sid] = {
            "file": file, "width": SIZE, "height": SIZE, "stridePixels": 1,
            "pixelSizeM": SPACING_M, "heightScaleM": 1.0,
            "centerLatitude": m["lat"], "centerLongitude": m["lon"],
            "name": m["name"], "country": m["country"], "near": m.get("near"),
            "minM": int(grid.min()), "maxM": int(grid.max()),
        }
        print(f"{region:20s} → {m['name']}, {m['country']} ({m['match']:.0f}%)  "
              f"{int(grid.min())}–{int(grid.max())} m")

    metadata = {
        "body": "earth",
        "gravity": 9.81,
        "source": "NASA SRTMGL1 v003 (1 arc-second, ~30 m), resampled to a 30 m local grid",
        "tileSizeKm": SIZE * SPACING_M / 1000,
        "sites": sites,
        "regions": regions,
    }
    (OUT / "earth-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"wrote {len(sites)} Earth tiles for {len(regions)} regions → {OUT}")


if __name__ == "__main__":
    main()
