"""Earth rover tiles: a 512 x 512 grid at 30 m (15.36 km) around any lat/lon, in the same layout as
the LOLA rover tiles (little-endian int16, row 0 = north, column 0 = west), here in whole metres.

Elevation source, best first (all NASA, LP DAAC):
  SRTMGL1 v003  1 arc-second (~30 m), 60°N–56°S   data_prep/cache/srtmgl1/<T>.SRTMGL1.hgt.zip
  ASTGTM  v003  1 arc-second (~30 m), to 83°N/S   data_prep/cache/dem/ASTGTMV003_<T>_dem.tif
  SRTMGL3 v003  3 arc-second (~90 m), fallback    data_prep/cache/dem/<T>.SRTMGL3.hgt.zip
Missing 30 m tiles are downloaded with earthaccess when an Earthdata login is saved (~10–20 MB each).
Built tiles are cached in data_prep/cache/rover_tiles/.
"""
from __future__ import annotations

import math
import threading
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data_prep" / "cache"
SIZE = 512
SPACING_M = 30.0
M_PER_DEG = 111_320.0
LP = "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected"

_tiles: dict[str, tuple[np.ndarray, int, str]] = {}
_lock = threading.Lock()


def tile_name(lat0: int, lon0: int) -> str:
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}"


def _download(url: str, dest: Path) -> Path | None:
    """Fetch one LP DAAC file with the saved Earthdata login; None if not possible."""
    try:
        import earthaccess
        auth = earthaccess.login(strategy="netrc")
        if not getattr(auth, "authenticated", False):
            return None
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / url.rsplit("/", 1)[1]
        for _ in range(2):  # LP DAAC sometimes answers 502 once; try again before falling back
            earthaccess.download([url], local_path=str(dest))
            if path.exists():
                return path
        return None
    except Exception:
        return None


def _read_hgt_zip(path: Path, n: int) -> np.ndarray:
    with zipfile.ZipFile(path) as zf:
        member = next(m for m in zf.namelist() if m.lower().endswith(".hgt"))
        z = np.frombuffer(zf.read(member), ">i2").reshape(n + 1, n + 1).astype(np.float32)
    z[z == -32768] = np.nan
    return z


def _read_tif(path: Path) -> np.ndarray:
    import rasterio
    with rasterio.open(path) as src:
        z = src.read(1).astype(np.float32)
        if src.nodata is not None:
            z[z == src.nodata] = np.nan
    z[z <= -9999] = np.nan
    return z


def _load(lat0: int, lon0: int, allow_download: bool) -> tuple[np.ndarray, int, str]:
    """(grid with row 0 at lat0+1, samples per degree, source name) for one 1° tile."""
    t = tile_name(lat0, lon0)
    srtm1 = CACHE / "srtmgl1" / f"{t}.SRTMGL1.hgt.zip"
    aster = CACHE / "dem" / f"ASTGTMV003_{t}_dem.tif"
    srtm3 = CACHE / "dem" / f"{t}.SRTMGL3.hgt.zip"
    in_srtm = -56 <= lat0 < 60
    if in_srtm and not srtm1.exists() and allow_download:
        _download(f"{LP}/SRTMGL1.003/{t}.SRTMGL1.hgt/{t}.SRTMGL1.hgt.zip", srtm1.parent)
    if in_srtm and srtm1.exists():
        return _read_hgt_zip(srtm1, 3600), 3600, "SRTMGL1"
    if not in_srtm and not aster.exists() and allow_download:
        _download(f"{LP}/ASTGTM.003/ASTGTMV003_{t}_dem.tif", aster.parent)
    if aster.exists():
        return _read_tif(aster), 3600, "ASTGTM"
    if srtm3.exists():
        return _read_hgt_zip(srtm3, 1200), 1200, "SRTMGL3"
    raise FileNotFoundError(f"no elevation data for tile {t}")


def build_tile(lat: float, lon: float, allow_download: bool = True) -> tuple[np.ndarray, str]:
    """512 x 512 int16 metres around (lat, lon) at 30 m, plus the elevation source used."""
    offs = (np.arange(SIZE) - (SIZE - 1) / 2) * SPACING_M
    north, east = np.meshgrid(-offs, offs, indexing="ij")
    plat = lat + north / M_PER_DEG
    plon = lon + east / (M_PER_DEG * math.cos(math.radians(lat)))
    out = np.full(plat.shape, np.nan, np.float32)
    lat0s, lon0s = np.floor(plat).astype(int), np.floor(plon).astype(int)
    sources = set()
    for la0, lo0 in {(int(a), int(b)) for a, b in zip(lat0s.ravel(), lon0s.ravel())}:
        with _lock:
            key = f"{la0},{lo0}"
            if key in _tiles:
                z, n, src = _tiles[key]
            else:
                z, n, src = _load(la0, lo0, allow_download)
                if src != "SRTMGL3":  # keep retrying for 30 m data next time
                    _tiles[key] = (z, n, src)
        sources.add(src)
        sel = (lat0s == la0) & (lon0s == lo0)
        r = (la0 + 1 - plat[sel]) * n
        c = (plon[sel] - lo0) * n
        r0 = np.clip(np.floor(r).astype(int), 0, z.shape[0] - 2)
        c0 = np.clip(np.floor(c).astype(int), 0, z.shape[1] - 2)
        fr, fc = r - r0, c - c0
        out[sel] = (z[r0, c0] * (1 - fr) * (1 - fc) + z[r0 + 1, c0] * fr * (1 - fc)
                    + z[r0, c0 + 1] * (1 - fr) * fc + z[r0 + 1, c0 + 1] * fr * fc)
    if np.isnan(out).all():
        raise ValueError("no elevation data in this window")
    out[np.isnan(out)] = np.nanmedian(out)
    return np.round(out).astype("<i2"), "+".join(sorted(sources))


def cached_tile(lat: float, lon: float) -> tuple[bytes, str]:
    """Bytes of the tile for (lat, lon), cached on disk by rounded position."""
    folder = CACHE / "rover_tiles"
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"{lat:.4f}_{lon:.4f}"
    data, meta = folder / f"{stem}.bin", folder / f"{stem}.src"
    if data.exists() and meta.exists():
        return data.read_bytes(), meta.read_text()
    grid, source = build_tile(lat, lon)
    if "SRTMGL3" not in source:  # don't pin the 90 m fallback; retry for 30 m next time
        data.write_bytes(grid.tobytes())
        meta.write_text(source)
    return grid.tobytes(), source
