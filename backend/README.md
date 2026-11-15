# Backend

FastAPI + numpy. Ranks Earth 20 × 20 km terrain patches by similarity to a lunar south-pole region.

## Run

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/uvicorn app:app --app-dir backend --reload --port 8000
```

Then open the frontend (`python3 -m http.server 5173 --directory frontend`). It calls `http://localhost:8000/match`.
API docs: http://localhost:8000/docs. Tests: `backend/.venv/bin/python -I backend/test_app.py`.

## Data files — drop real data here

Put these two files in `backend/data/`. Until both exist, the server uses `backend/data/sample/` (made-up numbers) and every response says `"sample": true`.
Both files must be encoded as UTF-8.

### `earth_patches.csv` (from the Earth Engine export)
One row per 20 × 20 km patch, DEM resampled to ~100 m/pixel.

| column | meaning |
|---|---|
| `lat`, `lon` | patch center, degrees |
| `meanSlope` | mean slope, degrees |
| `p90Slope` | 90th-percentile slope, degrees |
| `roughness` | std dev of elevation, m |
| `relief` | max − min elevation, m |
| `bareFrac` | fraction of patch that is MODIS IGBP class 16 Barren (0–1). Optional if you already filtered. Patches < 0.70 are dropped. |
| `snowFrac` | fraction that is MODIS IGBP class 15 snow/ice (0–1). Optional. ≥ 0.10 is dropped unless the user ticks "Include snow / ice". |
| `demSource` | `NASADEM`, `Copernicus` or `NASADEM+Copernicus`; shown in the detail view. Optional. |
| `name`, `country` | optional labels; blank → frontend shows coordinates |

### `moon_regions.json` (from the LOLA DEM)
Same 4 descriptors, same window size and pixel size, keyed by the region ids in `frontend/regions.js`:

```json
{ "haworth": { "meanSlope": 11.3, "p90Slope": 22.4, "roughness": 217, "relief": 1445 }, ... }
```

## Scoring
1. Keep bare-ground patches (and no snow unless asked).
2. For each feature, distance = |Earth − Moon| / (std of that feature across kept Earth patches).
3. Per-feature score = 100 × (1 − distance / 2), clipped to 0–100 (2 std apart = 0).
4. Match % = rank-weighted **geometric** mean of the picked constraints' scores (1st of n gets weight n, 2nd n−1, …; scores floored at 1). Unlike a plain average, one far-off feature drags the total down hard (100, 100, 100, 0 → ~32%, not 75%), while all-decent scores barely change.
5. Top N, skipping any patch within 100 km of one already picked, so results aren't 5 tiles of the same range.

The atlas displays a separate Shadow Match on results with cached rover elevation grids. It compares the percentage of a centered 14.4 km square in terrain shadow in eight compass directions with the Sun 5° above the horizon. The score is 100 minus the mean absolute difference in shadow coverage, in percentage points. Only terrain within the square casts shadows in this simulation. The atlas reranks the terrain shortlist with weights of 60% terrain, 20% reachability, and 20% Shadow Match when all three are available. A metric with incomplete coverage across the shortlist gives its weight back to terrain.

From the repository root, run `python -B backend/prepare_shadows.py` in the backend environment to regenerate `frontend/assets/shadows.json`. The script uses the bundled LOLA tiles and the cached Earth rover tiles listed in `frontend/assets/reachability.json`.
