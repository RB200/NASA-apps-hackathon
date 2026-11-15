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

## Bundled data

The repository includes [12,775 Earth patches](data/earth_patches.csv) and [nine lunar regions](data/moon_regions.json). The backend loads these files by default. If either file is missing, it loads the corresponding placeholder from [data/sample/](data/sample/) and reports `"sample": true` and the affected dataset in `sampleParts`. Replacement files must use UTF-8.

### `earth_patches.csv`
One row per 20 × 20 km patch, DEM resampled to ~100 m/pixel.
The bundled catalog comes from the [NASA Earthdata pipeline](../data_prep/README.md#earth-side-preferred-nasa-earthdata-earthdata_pipelinepy).

| column | meaning |
|---|---|
| `lat`, `lon` | patch center, degrees |
| `meanSlope` | mean slope, degrees |
| `p90Slope` | 90th-percentile slope, degrees |
| `roughness` | std dev of elevation, m |
| `relief` | max − min elevation, m |
| `bareFrac` | fraction of patch that is MODIS IGBP class 16 Barren (0–1). Optional if you already filtered. Patches < 0.70 are dropped. |
| `shape` | hypsometric integral (0–1), used when both datasets provide it |
| `snowFrac` | fraction that is MODIS IGBP class 15 snow/ice (0–1). Optional. The API excludes values ≥ 0.10 by default. |
| `demSource` | elevation source shown in the detail view. The bundled catalog uses `SRTMGL3` and `ASTGTM`. |
| `name`, `country` | optional labels; blank → frontend shows coordinates |

### `moon_regions.json` (from the LOLA DEM)
The four required terrain descriptors and optional `shape` use comparable windows and sampling. The file is keyed by the region IDs in [frontend/regions.js](../frontend/regions.js).

```json
{ "haworth": { "meanSlope": 11.3, "p90Slope": 22.4, "roughness": 217, "relief": 1445 }, ... }
```

## Scoring

The atlas automatically prioritizes steepest slopes, roughness, relief, average slope, and terrain shape in that order when available.

1. Keep patches with at least 70% bare ground and less than 10% snow or ice. API callers can bypass the snow and ice filter with `include_snow=true`. The atlas uses the defaults.
2. For each feature, distance = |Earth − Moon| / (std of that feature across kept Earth patches).
3. Per-feature score = 100 × (1 − distance / 2), clipped to 0–100 (2 std apart = 0).
4. Match % = rank-weighted **geometric** mean of the terrain feature scores, weighted by priority (1st of n gets weight n, 2nd n−1, …; scores floored at 1). Unlike a plain average, one far-off feature drags the total down hard (100, 100, 100, 0 → ~32%, not 75%), while all-decent scores barely change.
5. Subtract 3 ranking points from Atacama sites. Atacama is a well-known lunar analog, so the small adjustment gives similarly scored sites elsewhere a better chance to appear. Then take the top N, skipping patches within 100 km of a site already selected.

The atlas displays a separate Shadow Match on results with cached rover elevation grids. It compares the percentage of a centered 14.4 km square in terrain shadow in eight compass directions with the Sun 5° above the horizon. The score is 100 minus the mean absolute difference in shadow coverage, in percentage points. Only terrain within the square casts shadows in this simulation. The atlas reranks the terrain shortlist with weights of 60% terrain, 20% reachability, and 20% Shadow Match when all three are available. A metric with incomplete coverage across the shortlist gives its weight back to terrain. The atlas also applies the Atacama penalty when sorting the combined scores and displays the underlying similarity percentage.

From the repository root, run `python -B backend/prepare_shadows.py` in the backend environment to regenerate `frontend/assets/shadows.json`. The script uses the bundled LOLA tiles and the cached Earth rover tiles listed in `frontend/assets/reachability.json`.
