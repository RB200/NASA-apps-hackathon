"""Space Broncos backend: rank Earth terrain patches by similarity to a lunar south-pole region.

Run:  backend/.venv/bin/uvicorn app:app --app-dir backend --reload --port 8000

Data (see backend/README.md for formats):
  data/earth_patches.csv   one row per 20x20 km Earth patch (from Earth Engine export)
  data/moon_regions.json   descriptors per Artemis region (from LOLA DEM)
Each missing file falls back to data/sample/ on its own; responses then have "sample": true
and "sampleParts" says which side ("earth" / "moon") is placeholder.
"""
from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

CORE_FEATURES = ["meanSlope", "p90Slope", "roughness", "relief"]
OPTIONAL_FEATURES = ["shape"]  # used only when both the Earth CSV and every Moon region have it
MIN_BARE = 0.70          # keep a patch only if >= 70% bare ground
MAX_SNOW = 0.10          # "no snow/ice" means < 10% snow/ice cover
MIN_SEPARATION_KM = 100  # don't return 5 neighbouring patches of the same mountain range

HERE = Path(__file__).parent
DATA_DIR = Path(os.environ.get("DATA_DIR", HERE / "data"))


def _pick(filename: str) -> tuple[Path, bool]:
    """Use the real file if present, else the sample one. Each file falls back independently."""
    real = DATA_DIR / filename
    return (real, False) if real.exists() else (HERE / "data" / "sample" / filename, True)


def _float(v: str, default: float = float("nan")) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def read_rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise RuntimeError(f"{path} is empty")
    return rows


def load_earth(path: Path, rows: list[dict]) -> dict:
    missing = [c for c in ["lat", "lon", *FEATURES] if c not in rows[0]]
    if missing:
        raise RuntimeError(f"{path} is missing columns: {missing}")
    return {
        "lat": np.array([_float(r["lat"]) for r in rows]),
        "lon": np.array([_float(r["lon"]) for r in rows]),
        "X": np.array([[_float(r[k]) for k in FEATURES] for r in rows]),
        "bare": np.array([_float(r.get("bareFrac"), 1.0) for r in rows]),   # column optional if pre-filtered
        "snow": np.array([_float(r.get("snowFrac"), 0.0) for r in rows]),
        "demSource": [(r.get("demSource") or "").strip() or None for r in rows],
        "name": [(r.get("name") or "").strip() or None for r in rows],
        "country": [(r.get("country") or "").strip() or None for r in rows],
        "near": [(r.get("near") or "").strip() or None for r in rows],
        "cc": [(r.get("cc") or "").strip().upper() or None for r in rows],
    }


def load_moon(path: Path) -> dict[str, dict[str, float]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


EARTH_PATH, EARTH_SAMPLE = _pick("earth_patches.csv")
MOON_PATH, MOON_SAMPLE = _pick("moon_regions.json")
MOON = load_moon(MOON_PATH)
_earth_rows = read_rows(EARTH_PATH)
FEATURES = CORE_FEATURES + [f for f in OPTIONAL_FEATURES
                            if f in _earth_rows[0] and all(f in v for v in MOON.values())]
EARTH = load_earth(EARTH_PATH, _earth_rows)
del _earth_rows
IS_SAMPLE = EARTH_SAMPLE or MOON_SAMPLE
SAMPLE_PARTS = [name for name, s in (("earth", EARTH_SAMPLE), ("moon", MOON_SAMPLE)) if s]

app = FastAPI(title="Space Broncos – Lunar terrain analogs")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"],
                   expose_headers=["X-Dem-Source", "X-Tile-Size", "X-Pixel-Size-M"])


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(a))


def rank_weights(constraints: list[str]) -> np.ndarray:
    """1st pick gets n, 2nd n-1, ... normalized to sum 1 (same rule as the frontend)."""
    n = len(constraints)
    w = np.zeros(len(FEATURES))
    for i, k in enumerate(constraints):
        w[FEATURES.index(k)] = (n - i) / (n * (n + 1) / 2)
    return w


def combine(scores: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Match % = weighted GEOMETRIC mean of per-feature scores (floored at 1).

    An arithmetic mean let one completely wrong feature hide behind good ones
    (scores 100,100,100,0 → 75%). The geometric mean drags that down to ~32%,
    while all-decent scores barely change (90,80,85 → ~85%).
    """
    used = w > 0
    logs = np.log(np.maximum(scores[:, used], 1.0))
    return np.exp((logs * w[used]).sum(axis=1) / w[used].sum())


def match(region: str, constraints: list[str], n: int, include_snow: bool) -> dict:
    moon = np.array([MOON[region][k] for k in FEATURES])

    keep = (EARTH["bare"] >= MIN_BARE) & np.all(np.isfinite(EARTH["X"]), axis=1)
    if not include_snow:
        keep &= EARTH["snow"] < MAX_SNOW
    idx = np.flatnonzero(keep)
    if idx.size == 0:
        return {"matches": [], "eligible": 0}
    X = EARTH["X"][idx]

    # z-score normalization across eligible Earth patches; 2 std apart = score 0
    std = X.std(axis=0)
    std[std == 0] = 1.0
    dz = np.abs(X - moon) / std
    scores = np.clip(100 * (1 - dz / 2), 0, 100)          # per-feature 0..100
    total = combine(scores, rank_weights(constraints))

    # Favor less studied analogs when their terrain scores are close.
    penalties = np.array([
        3 if "atacama" in (EARTH["name"][i] or "").casefold() else 0 for i in idx
    ])
    order = np.argsort(-(total - penalties), kind="stable")
    picked: list[int] = []
    for j in order:
        if len(picked) == n:
            break
        if all(haversine_km(EARTH["lat"][idx[j]], EARTH["lon"][idx[j]],
                            EARTH["lat"][idx[p]], EARTH["lon"][idx[p]]) >= MIN_SEPARATION_KM for p in picked):
            picked.append(j)

    out = []
    for j in picked:
        i = idx[j]
        out.append({
            "id": f"{EARTH['lat'][i]:.3f},{EARTH['lon'][i]:.3f}",
            "name": EARTH["name"][i],
            "country": EARTH["country"][i],
            "near": EARTH["near"][i],
            "cc": EARTH["cc"][i],
            "lat": float(EARTH["lat"][i]),
            "lon": float(EARTH["lon"][i]),
            "match": round(float(total[j]), 1),
            "rankingPenalty": int(penalties[j]),
            "bareFrac": float(EARTH["bare"][i]),
            "demSource": EARTH["demSource"][i],
            "features": {
                k: {"moon": float(moon[f]), "earth": float(X[j, f]), "score": round(float(scores[j, f]), 1)}
                for f, k in enumerate(FEATURES)
            },
        })
    return {"matches": out, "eligible": int(idx.size)}


@app.get("/health")
def health():
    return {"ok": True, "sample": IS_SAMPLE, "sampleParts": SAMPLE_PARTS,
            "earthFile": str(EARTH_PATH), "moonFile": str(MOON_PATH), "earthPatches": len(EARTH["lat"]),
            "features": FEATURES,
            "moonRegions": sorted(MOON)}


@app.get("/regions")
def regions():
    return {"sample": IS_SAMPLE, "regions": MOON}


@app.get("/match")
def match_endpoint(
    region: str,
    constraints: str = Query(..., description="Comma-separated feature keys, most important first"),
    n: int = Query(5, ge=1, le=20),
    include_snow: bool = False,
    weights: Optional[str] = Query(None, include_in_schema=False),  # ignored; old frontend param
):
    if region not in MOON:
        raise HTTPException(404, f"Unknown region '{region}'. Known: {sorted(MOON)}")
    keys = [c.strip() for c in constraints.split(",") if c.strip()]
    unknown = [k for k in keys if k not in FEATURES]
    if unknown or not keys:
        raise HTTPException(400, f"constraints must be a non-empty subset of {FEATURES}; got {unknown or keys}")
    keys = list(dict.fromkeys(keys))  # dedupe, keep order
    result = match(region, keys, n, include_snow)
    return {"region": region, "constraints": keys, "sample": IS_SAMPLE, "sampleParts": SAMPLE_PARTS, **result}


@app.get("/rover-tile")
def rover_tile(lat: float = Query(..., ge=-83, le=83), lon: float = Query(..., ge=-180, le=180)):
    """15.36 km x 15.36 km Earth tile at 30 m for the rover simulator (int16 metres, little-endian).

    Built on demand from NASA SRTMGL1/ASTGTM (downloaded once if missing), then cached.
    """
    import rover_tiles
    try:
        data, source = rover_tiles.cached_tile(lat, lon)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(404, str(error))
    return Response(data, media_type="application/octet-stream", headers={
        "X-Dem-Source": source, "X-Tile-Size": str(rover_tiles.SIZE),
        "X-Pixel-Size-M": str(rover_tiles.SPACING_M), "Cache-Control": "public, max-age=86400"})
