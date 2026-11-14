# Data prep

## Earth side (Google Earth Engine → `backend/data/earth_patches.csv`)

Needs a Google Cloud project registered for Earth Engine (free for noncommercial use: https://code.earthengine.google.com/register).

```bash
pip install -r data_prep/requirements.txt
earthengine authenticate
python data_prep/earth_engine_export.py --project YOUR_PROJECT preview            # Atacama test, ~1 min
python data_prep/earth_engine_export.py --project YOUR_PROJECT preview --area death_valley
python data_prep/earth_engine_export.py --project YOUR_PROJECT export             # 72 Drive tasks (empty ocean tiles finish fast)
python data_prep/merge_earth_csv.py ~/Downloads/space_broncos_export/*.csv        # → backend/data/earth_patches.csv
```

**Do `preview` first.** Sanity check: Atacama patches should show mean slope roughly 3–15°, relief hundreds to ~2000 m, bareFrac near 1. If a column is null or Earth Engine complains about a band name, check the dataset catalog page.

Time: the export could take from under an hour to several hours. To get something sooner, export only a few tiles first, e.g. `export --only tile_lat-030_lon-090 tile_lat+030_lon+090` (Andes/Atacama and Tibet/Qaidam).

What it does, per 20 × 20 km equal-area patch:
1. WorldCover v200 at 500 m → `bareFrac` (class 60) and `snowFrac` (class 70). Keeps patches with bareFrac ≥ 0.70.
2. Copernicus GLO-30 DEM at 100 m → slope (degrees). `meanSlope`, `p90Slope` from slope; `roughness` = std dev of elevation; `relief` = max − min elevation.

## Moon side (LOLA → `backend/data/moon_regions.json`)

To be comparable, compute the **same four numbers the same way**:
- DEM at ~100 m/pixel (LOLA south polar ~100 m product, polar stereographic, so pixels are already in meters).
- A 20 × 20 km window centered on each region from `frontend/regions.js`. For Mons Mouton Plateau (78 × 58 km), the center 20 km window is fine.
- Slope in degrees from the 4 neighbours (like `ee.Terrain.slope`). `meanSlope` = mean, `p90Slope` = 90th percentile.
- `roughness` = std dev of elevation in the window (m). `relief` = max − min (m).

Format: see `backend/README.md`.
