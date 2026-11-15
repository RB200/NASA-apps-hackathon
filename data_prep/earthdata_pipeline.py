"""Build backend/data/earth_patches.csv from NASA Earthdata (no Google account needed).

All data comes from NASA LP DAAC via Earthdata Login (free: https://urs.earthdata.nasa.gov).
Log in once on this machine (saves to ~/.netrc):
    backend/.venv/bin/python -c "import earthaccess; earthaccess.login(persist=True)"

Steps (each is resumable; downloads go to data_prep/cache/):
    python data_prep/earthdata_pipeline.py screen      # ~1.3 GB: whole-planet coarse data → candidate 1° tiles + size estimate
    python data_prep/earthdata_pipeline.py download    # 90 m elevation tiles for the candidates only
    python data_prep/earthdata_pipeline.py compute     # → backend/data/earth_patches.csv

Datasets
    SRTMGL30 v002  SRTM 30 arc-second (~1 km) global elevation    screening (relief)
    MCD12C1  v061  MODIS land cover, 0.05° (~5.6 km), % per class  screening + bareFrac/snowFrac per patch
    SRTMGL3  v003  SRTM 3 arc-second (~90 m) elevation, 60°N–56°S  patch terrain
    ASTGTM   v003  ASTER GDEM 1 arc-second (~30 m), up to 83°N/S   patch terrain where SRTM has no data (Arctic)

Per 20 x 20 km patch, the DEM is bilinearly resampled to a 200 x 200 grid at exactly 100 m (same as the Moon side), then:
    meanSlope, p90Slope  slope in degrees from np.gradient at 100 m
    roughness            std dev of elevation (m)
    relief               max - min elevation (m)
    shape                hypsometric integral (mean - min) / (max - min): ~0.2 isolated peak/cone, ~0.5 even slope,
                         ~0.8 plateau or high ground around a pit/crater. Helps tell craters/calderas from peaks.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
OUT = HERE.parent / "backend" / "data" / "earth_patches.csv"
CANDIDATES = CACHE / "candidates.csv"

LP = "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"

PATCH_KM = 20.0
GRID_N = 200                 # 200 x 200 at 100 m = 20 km
KM_PER_DEG = 111.32
BARREN, SNOW = 16, 15        # MCD12C1 Land_Cover_Type_1_Percent layer index = IGBP class

# Named NASA / planetary-science analog sites. Their 1° tiles are always processed, and a patch is
# centered exactly on each one, even if the screening would have skipped it.
CURATED = [
    ("Meteor Crater", "USA", 35.027, -111.023),
    ("SP Crater, San Francisco Volcanic Field", "USA", 35.583, -111.632),
    ("Black Point Lava Flow (NASA Desert RATS)", "USA", 35.683, -111.467),
    ("Cinder Lake Crater Field (Apollo training)", "USA", 35.300, -111.483),
    ("Ubehebe Crater, Death Valley", "USA", 37.010, -117.452),
    ("Craters of the Moon", "USA", 43.417, -113.517),
    ("Mauna Kea summit", "USA", 19.821, -155.468),
    ("Haleakalā crater", "USA", 20.710, -156.253),
    ("Kīlauea caldera", "USA", 19.406, -155.283),
    ("Haughton Crater, Devon Island", "Canada", 75.383, -89.683),
    ("Askja caldera", "Iceland", 65.033, -16.750),
    ("Timanfaya, Lanzarote", "Spain", 29.000, -13.750),
    ("Teide caldera, Tenerife", "Spain", 28.272, -16.642),
    ("Licancabur / Atacama", "Chile", -22.833, -67.883),
    ("Pampa de Tamarugal, Atacama", "Chile", -21.000, -69.500),
    ("Roter Kamm Crater", "Namibia", -27.766, 16.292),
    ("Tenoumer Crater", "Mauritania", 22.917, -10.400),
    ("Aorounga Crater", "Chad", 19.100, 19.250),
    ("Kebira / Gilf Kebir", "Egypt", 22.700, 25.800),
    ("Wolfe Creek Crater", "Australia", -19.172, 127.795),
    ("Gosses Bluff", "Australia", -23.817, 132.308),
    ("Lonar Crater", "India", 19.976, 76.508),
]


# ---------------------------------------------------------------- Earthdata helpers
def login():
    import earthaccess
    try:
        auth = earthaccess.login(strategy="netrc")
    except Exception:
        auth = None
    if not auth or not getattr(auth, "authenticated", False):
        sys.exit("Not logged in to Earthdata. Run once in a terminal (you type your password, it is saved to ~/.netrc):\n"
                 '  backend/.venv/bin/python -c "import earthaccess; earthaccess.login(persist=True)"')
    return earthaccess


def cmr_granules(short_name: str, version: str, bbox: tuple | None = None) -> dict[str, float]:
    """title -> size in MB, for all granules (optionally within bbox w,s,e,n). Public metadata, no login."""
    out, page = {}, 1
    while True:
        q = {"short_name": short_name, "version": version, "page_size": 2000, "page_num": page}
        if bbox:
            q["bounding_box"] = ",".join(map(str, bbox))
        with urllib.request.urlopen(f"{CMR}?{urllib.parse.urlencode(q)}", timeout=60) as r:
            entries = json.load(r)["feed"]["entry"]
        for e in entries:
            out[e["title"]] = float(e.get("granule_size") or 0)
        if len(entries) < 2000:
            return out
        page += 1


def download(ea, urls: list[str], dest: Path) -> list[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    todo = [u for u in urls if not (dest / u.rsplit("/", 1)[1]).exists()]
    if todo:
        print(f"downloading {len(todo)} files to {dest} ({len(urls) - len(todo)} already cached)")
        ea.download(todo, local_path=str(dest))
    return [dest / u.rsplit("/", 1)[1] for u in urls]


def tile_name(lat0: int, lon0: int) -> str:
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}"


# ---------------------------------------------------------------- readers
def read_srtmgl30(path: Path) -> tuple[np.ndarray, float, float]:
    """GTOPO30-layout tile: int16 big-endian, 120 px/deg. Returns (z, north, west)."""
    name = path.name.split(".")[0]                       # e.g. w020n90
    west = (-1 if name[0] == "w" else 1) * int(name[1:4])
    north = (-1 if name[4] == "s" else 1) * int(name[5:7])
    with zipfile.ZipFile(path) as zf:
        member = next(n for n in zf.namelist() if n.lower().endswith(".dem"))
        raw = zf.read(member)
    rows, cols = (3600, 7200) if north == -60 else (6000, 4800)
    if len(raw) != rows * cols * 2:
        raise RuntimeError(f"{path.name}: unexpected size {len(raw)} for {rows}x{cols}")
    z = np.frombuffer(raw, ">i2").reshape(rows, cols).astype(np.float32)
    z[z <= -9999] = np.nan
    return z, north, west


def read_mcd12c1(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Barren and snow/ice percent on the 0.05° global grid (3600 x 7200, row 0 = 90°N, col 0 = 180°W)."""
    from pyhdf.SD import SD, SDC
    sd = SD(str(path), SDC.READ)
    name = "Land_Cover_Type_1_Percent"
    if name not in sd.datasets():
        raise RuntimeError(f"{path.name}: no '{name}'. Datasets: {list(sd.datasets())}")
    sds = sd.select(name)
    barren = np.asarray(sds[:, :, BARREN], dtype=np.float32)
    snow = np.asarray(sds[:, :, SNOW], dtype=np.float32)
    return barren, snow


def read_dem_tile(path: Path) -> np.ndarray:
    """SRTMGL3 .hgt.zip (1201²) or ASTGTM .tif (3601²) → 1200 x 1200 grid at 3 arc-seconds, row 0 = north."""
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as zf:
            member = next(n for n in zf.namelist() if n.lower().endswith(".hgt"))
            z = np.frombuffer(zf.read(member), ">i2").reshape(1201, 1201).astype(np.float32)
        z[z == -32768] = np.nan
        return z[:1200, :1200]
    import rasterio
    with rasterio.open(path) as src:
        z = src.read(1).astype(np.float32)
        if src.nodata is not None:
            z[z == src.nodata] = np.nan
    z[z <= -9999] = np.nan
    return z[:3600, :3600].reshape(1200, 3, 1200, 3).mean(axis=(1, 3))   # 1" → 3" block mean


# ---------------------------------------------------------------- step 1: screen
def cmd_screen(args):
    ea = login()
    CACHE.mkdir(exist_ok=True)

    print("1/3 SRTMGL30 (~1 km global elevation) …")
    g30 = cmr_granules("SRTMGL30", "002")
    print(f"    {len(g30)} tiles, {sum(g30.values()):.0f} MB")
    files30 = download(ea, [f"{LP}/SRTMGL30.002/{t}/{t}.zip" for t in g30], CACHE / "srtmgl30")

    print("2/3 MCD12C1 (MODIS land cover, latest year) …")
    lc = cmr_granules("MCD12C1", "061")
    latest = max(lc)  # titles sort by year (MCD12C1.AYYYY001...)
    print(f"    {latest} ({lc[latest]:.0f} MB)")
    (lc_path,) = download(ea, [f"{LP}/MCD12C1.061/{latest}/{latest}.hdf"], CACHE / "mcd12c1")
    barren, snow = read_mcd12c1(lc_path)

    print("3/3 scoring every 1° land tile …")
    relief = np.full((180, 360), np.nan, np.float32)      # max 20 km-window relief per 1° tile, index [90-lat_top, lon+180]
    blk = 24                                              # 24 px at 30" = 0.2° ≈ 20 km
    for f in files30:
        z, north, west = read_srtmgl30(f)
        rows, cols = z.shape
        r = z[: rows // blk * blk, : cols // blk * blk].reshape(rows // blk, blk, cols // blk, blk)
        with np.errstate(all="ignore"):
            rel = np.nanmax(r, axis=(1, 3)) - np.nanmin(r, axis=(1, 3))   # per 0.2° block
        per = 5                                                            # 5 x 5 blocks per 1°
        rel = rel[: rel.shape[0] // per * per, : rel.shape[1] // per * per]
        rel = rel.reshape(rel.shape[0] // per, per, rel.shape[1] // per, per)
        with np.errstate(all="ignore"):
            tile_rel = np.nanmax(rel, axis=(1, 3))
        r0, c0 = 90 - north, west + 180
        relief[r0: r0 + tile_rel.shape[0], c0: c0 + tile_rel.shape[1]] = tile_rel

    bare1 = barren.reshape(180, 20, 360, 20).mean(axis=(1, 3))
    snow1 = snow.reshape(180, 20, 360, 20).mean(axis=(1, 3))

    srtm3 = cmr_granules("SRTMGL3", "003")
    srtm3 = {t.split(".")[0]: s for t, s in srtm3.items()}
    aster = cmr_granules("ASTGTM", "003", bbox=(-180, 59, 180, 84))
    aster = {t.replace("ASTGTMV003_", ""): s for t, s in aster.items()}

    curated_tiles = {(math.floor(la), math.floor(lo)) for _, _, la, lo in CURATED}
    rows_out, total_mb = [], 0.0
    for i in range(180):
        for j in range(360):
            lat0, lon0 = 89 - i, j - 180
            t = tile_name(lat0, lon0)
            keep = (bare1[i, j] >= args.min_bare and np.isfinite(relief[i, j]) and relief[i, j] >= args.min_relief)
            if not keep and (lat0, lon0) not in curated_tiles:
                continue
            if t in srtm3:
                src, mb = "SRTMGL3", srtm3[t]
            elif t in aster:
                src, mb = "ASTGTM", aster[t]
            else:
                continue
            rows_out.append([lat0, lon0, t, src, round(float(bare1[i, j]), 1), round(float(snow1[i, j]), 1),
                             round(float(relief[i, j]), 0) if np.isfinite(relief[i, j]) else "", round(mb, 2),
                             int((lat0, lon0) in curated_tiles)])
            total_mb += mb

    with open(CANDIDATES, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["lat0", "lon0", "tile", "source", "barrenPct", "snowPct", "maxRelief20km", "sizeMB", "curated"])
        w.writerows(rows_out)
    n_src = {s: sum(1 for r in rows_out if r[3] == s) for s in ("SRTMGL3", "ASTGTM")}
    print(f"\n{len(rows_out)} candidate 1° tiles (barren ≥ {args.min_bare}%, relief ≥ {args.min_relief} m, + curated sites)")
    print(f"    SRTMGL3: {n_src['SRTMGL3']}  ASTGTM (Arctic): {n_src['ASTGTM']}")
    print(f"    download size: {total_mb / 1024:.2f} GB  → {CANDIDATES}")
    print("Loosen/tighten with --min-bare / --min-relief and re-run (cached files are reused), then run 'download'.")


# ---------------------------------------------------------------- step 2: download
def load_candidates() -> list[dict]:
    if not CANDIDATES.exists():
        sys.exit("Run 'screen' first.")
    with open(CANDIDATES) as f:
        return list(csv.DictReader(f))


def tile_url(c: dict) -> str:
    t = c["tile"]
    if c["source"] == "SRTMGL3":
        return f"{LP}/SRTMGL3.003/{t}.SRTMGL3.hgt/{t}.SRTMGL3.hgt.zip"
    return f"{LP}/ASTGTM.003/ASTGTMV003_{t}_dem.tif"


def cmd_download(args):
    ea = login()
    cands = load_candidates()
    if args.limit:
        cands = cands[: args.limit]
    mb = sum(float(c["sizeMB"]) for c in cands)
    print(f"{len(cands)} tiles, {mb / 1024:.2f} GB")
    download(ea, [tile_url(c) for c in cands], CACHE / "dem")


# ---------------------------------------------------------------- step 3: compute
def bilinear(z: np.ndarray, r: np.ndarray, c: np.ndarray) -> np.ndarray:
    r0, c0 = np.floor(r).astype(int), np.floor(c).astype(int)
    fr, fc = r - r0, c - c0
    r0 = np.clip(r0, 0, z.shape[0] - 2)
    c0 = np.clip(c0, 0, z.shape[1] - 2)
    return (z[r0, c0] * (1 - fr) * (1 - fc) + z[r0 + 1, c0] * fr * (1 - fc)
            + z[r0, c0 + 1] * (1 - fr) * fc + z[r0 + 1, c0 + 1] * fr * fc)


def descriptors(z100: np.ndarray) -> dict | None:
    if np.isnan(z100).mean() > 0.10:
        return None
    gy, gx = np.gradient(z100, 100.0)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))[1:-1, 1:-1]
    zmin, zmax, zmean = np.nanmin(z100), np.nanmax(z100), np.nanmean(z100)
    relief = float(zmax - zmin)
    return {
        "meanSlope": float(np.nanmean(slope)),
        "p90Slope": float(np.nanpercentile(slope, 90)),
        "roughness": float(np.nanstd(z100)),
        "relief": relief,
        "shape": float((zmean - zmin) / relief) if relief > 0 else 0.5,
    }


def patch_from_tile(z: np.ndarray, lat0: int, lon0: int, clat: float, clon: float) -> np.ndarray:
    """Resample a 20 km square centered at (clat, clon) to 200 x 200 at 100 m. z is 1200² at 3", row 0 = lat0+1."""
    half = PATCH_KM * 1000 / 2
    offs = (np.arange(GRID_N) + 0.5) * 100.0 - half                 # meters from center
    north_m, east_m = np.meshgrid(-offs, offs, indexing="ij")       # row 0 = north
    lat = clat + north_m / (KM_PER_DEG * 1000)
    lon = clon + east_m / (KM_PER_DEG * 1000 * math.cos(math.radians(clat)))
    rows = (lat0 + 1 - lat) * 1200 - 0.5
    cols = (lon - lon0) * 1200 - 0.5
    return bilinear(z, rows, cols)


def land_fraction(grid: np.ndarray, clat: float, clon: float) -> float:
    """Mean of a 0.05° global percent grid over the patch, as 0–1."""
    dlat = PATCH_KM / 2 / KM_PER_DEG
    dlon = dlat / math.cos(math.radians(clat))
    r0, r1 = int((90 - (clat + dlat)) / 0.05), int(math.ceil((90 - (clat - dlat)) / 0.05))
    c0, c1 = int((clon - dlon + 180) / 0.05), int(math.ceil((clon + dlon + 180) / 0.05))
    return float(grid[max(r0, 0): r1, max(c0, 0): c1].mean() / 100.0)


def cmd_compute(args):
    cands = load_candidates()
    lc_files = sorted((CACHE / "mcd12c1").glob("*.hdf"))
    if not lc_files:
        sys.exit("No MCD12C1 file in cache; run 'screen' first.")
    barren, snow = read_mcd12c1(lc_files[-1])

    dlat = PATCH_KM / KM_PER_DEG
    out, missing = [], 0
    for k, c in enumerate(cands, 1):
        lat0, lon0 = int(c["lat0"]), int(c["lon0"])
        path = CACHE / "dem" / tile_url(c).rsplit("/", 1)[1]
        if not path.exists():
            missing += 1
            continue
        z = read_dem_tile(path)
        centers = []
        nr = int(1 // dlat)                                          # 5 rows of 20 km per degree
        for a in range(nr):
            clat = lat0 + (1 - nr * dlat) / 2 + (a + 0.5) * dlat
            dlon = dlat / math.cos(math.radians(clat))
            nc = max(int(1 // dlon), 1)
            for b in range(nc):
                centers.append((clat, lon0 + (1 - nc * dlon) / 2 + (b + 0.5) * dlon, None, None))
        for name, country, la, lo in CURATED:                       # extra patch centered on each analog site
            if math.floor(la) == lat0 and math.floor(lo) == lon0:
                centers.append((la, lo, name, country))

        for clat, clon, name, country in centers:
            # keep the whole 20 km square inside this 1° tile
            hl = PATCH_KM / 2 / KM_PER_DEG
            hw = hl / math.cos(math.radians(clat))
            if not (lat0 + hl <= clat <= lat0 + 1 - hl and lon0 + hw <= clon <= lon0 + 1 - hw):
                if name is None:
                    continue
                clat = min(max(clat, lat0 + hl), lat0 + 1 - hl)      # nudge curated patch inside the tile
                clon = min(max(clon, lon0 + hw), lon0 + 1 - hw)
            d = descriptors(patch_from_tile(z, lat0, lon0, clat, clon))
            if d is None:
                continue
            out.append({"lat": clat, "lon": clon, **d,
                        "bareFrac": land_fraction(barren, clat, clon), "snowFrac": land_fraction(snow, clat, clon),
                        "demSource": c["source"], "name": name or "", "country": country or ""})
        if k % 50 == 0:
            print(f"  {k}/{len(cands)} tiles, {len(out)} patches")

    cols = ["lat", "lon", "meanSlope", "p90Slope", "roughness", "relief", "shape", "bareFrac", "snowFrac",
            "demSource", "name", "country"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in out:
            w.writerow([f"{r['lat']:.4f}", f"{r['lon']:.4f}"]
                       + [f"{r[k]:.3f}" for k in cols[2:9]] + [r["demSource"], r["name"], r["country"]])
    bare = sum(r["bareFrac"] >= 0.7 for r in out)
    print(f"\nwrote {len(out)} patches ({bare} are ≥70% barren) to {OUT}")
    if missing:
        print(f"{missing} candidate tiles not downloaded yet (run 'download').")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("screen", help="download coarse global data and pick candidate tiles")
    s.add_argument("--min-bare", type=float, default=30, help="min %% barren per 1° tile (default 30)")
    s.add_argument("--min-relief", type=float, default=500, help="min relief (m) in some 20 km window of the tile (default 500)")
    s.set_defaults(func=cmd_screen)
    d = sub.add_parser("download", help="download 90 m elevation tiles for the candidates")
    d.add_argument("--limit", type=int, help="only the first N tiles (for a quick test)")
    d.set_defaults(func=cmd_download)
    c = sub.add_parser("compute", help="compute descriptors → backend/data/earth_patches.csv")
    c.set_defaults(func=cmd_compute)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
