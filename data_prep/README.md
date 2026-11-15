# Data prep

## Earth side, preferred: NASA Earthdata (`earthdata_pipeline.py`)

100% NASA data, free Earthdata Login, no Google account. See the docstring at the top of `earthdata_pipeline.py`.

```bash
backend/.venv/bin/python -c "import earthaccess; earthaccess.login(persist=True)"   # once; you type your own password
backend/.venv/bin/python data_prep/earthdata_pipeline.py screen      # ~1.5 GB coarse global data → candidate tiles + GB estimate
backend/.venv/bin/python data_prep/earthdata_pipeline.py download    # 90 m tiles for candidates only
backend/.venv/bin/python data_prep/earthdata_pipeline.py compute     # → backend/data/earth_patches.csv
```

- Screening: SRTMGL30 (~1 km elevation, 267 MB) + MCD12C1 (MODIS land cover 0.05°, ~1.2 GB) keep 1° tiles with ≥30% barren and ≥500 m relief in some 20 km window (`--min-bare`, `--min-relief`). For reference, all SRTMGL3 tiles on Earth total 13.7 GB.
- Terrain: SRTMGL3 (90 m, 60°N–56°S), ASTGTM (ASTER 30 m) for the Arctic. Each 20 km patch is resampled to exactly 100 m like the Moon side.
- Adds `shape` (hypsometric integral) to tell craters/calderas/plateaus from peaks. Used only once the Moon file has `shape` too.
- 22 named analog sites (Meteor Crater, SP Crater, Black Point Lava Flow, Haughton, Mauna Kea, Askja, Lanzarote, Atacama…) are always processed, with a patch centered on each; they show by name in results.
- Then add place names (offline, ~2 s): `backend/.venv/bin/python data_prep/add_place_names.py`. Fills `name` (Natural Earth desert/range/plateau, else "Near <town>"), `country` ("state, country"), and `near` ("town (km)"). Needs GeoNames `cities1000.zip`, `admin1CodesASCII.txt`, `countryInfo.txt` (download.geonames.org/export/dump, CC BY 4.0) and Natural Earth `ne_10m_geography_regions_polys.geojson`, `ne_50m_admin_0_countries.geojson` (github.com/nvkelso/natural-earth-vector/geojson) in `data_prep/cache/names/`. Re-run it after every `compute`.

Datasets to cite for the Earthdata route: SRTMGL3 v003, SRTMGL30 v002, ASTGTM v003, MCD12C1 v061 (all LP DAAC; search the short names on https://search.earthdata.nasa.gov/ for DOIs).

## Earth side, alternative: Google Earth Engine (`earth_engine_export.py`)

Needs a Google Cloud project registered for Earth Engine (free for noncommercial use: https://code.earthengine.google.com/register).

```bash
pip install -r data_prep/requirements.txt
earthengine authenticate
python data_prep/earth_engine_export.py --project YOUR_PROJECT preview            # Atacama test, ~1 min
python data_prep/earth_engine_export.py --project YOUR_PROJECT preview --area death_valley
python data_prep/earth_engine_export.py --project YOUR_PROJECT export             # 72 Drive tasks (empty ocean tiles finish fast)
python data_prep/merge_earth_csv.py ~/Downloads/space_broncos_export/*.csv        # → backend/data/earth_patches.csv
```

**Do `preview` first.** Also try `preview --area devon_island` (should say `demSource` Copernicus). Sanity check: Atacama patches should show mean slope roughly 3–15°, relief hundreds to ~2000 m, bareFrac near 1. If a column is null or Earth Engine complains about a band name, check the dataset catalog page.

Time: the export could take from under an hour to several hours. To get something sooner, export only a few tiles first, e.g. `export --only tile_lat-030_lon-090 tile_lat+030_lon+090` (Andes/Atacama and Tibet/Qaidam).

What it does, per 20 × 20 km equal-area patch:
1. NASA MODIS Land Cover MCD12Q1 v061 (500 m, latest year) → `bareFrac` (IGBP 16 Barren) and `snowFrac` (IGBP 15 Snow/Ice). Keeps patches with bareFrac ≥ 0.70.
2. NASA NASADEM at 100 m → slope (degrees). `meanSlope`, `p90Slope` from slope; `roughness` = std dev of elevation; `relief` = max − min elevation. North of 60°N / south of 56°S NASADEM has no data, so Copernicus GLO-30 fills in; `demSource` says which was used. Add `--nasa-only` to drop those patches instead.

Datasets to cite (search them on https://search.earthdata.nasa.gov/):
- NASADEM_HGT v001, LP DAAC: https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001
- MODIS MCD12Q1 v061, LP DAAC: https://doi.org/10.5067/MODIS/MCD12Q1.061
- Copernicus DEM GLO-30 (polar fill only), ESA: https://doi.org/10.5270/ESA-c5d3d65

## Moon side (LOLA → `backend/data/moon_regions.json`)

To be comparable, compute the **same four numbers the same way**:
- DEM at ~100 m/pixel (LOLA south polar ~100 m product, polar stereographic, so pixels are already in meters).
- A 20 × 20 km window centered on each region from `frontend/regions.js`. For Mons Mouton Plateau (78 × 58 km), the center 20 km window is fine.
- Slope in degrees from the 4 neighbours (like `ee.Terrain.slope`). `meanSlope` = mean, `p90Slope` = 90th percentile.
- `roughness` = std dev of elevation in the window (m). `relief` = max − min (m).

Format: see `backend/README.md`.
