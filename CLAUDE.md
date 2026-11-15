# Space Broncos — Lunar South Pole Terrain Analogs

NASA Space Apps Challenge 2026 (Nov 14–15), challenge: "Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars". Team: Space Broncos (Santa Clara University). Submission closes Sunday Nov 15, 11:59 PM local. Target: submit by 10 PM.

## What we're building

A web app that finds places on Earth whose terrain matches NASA's Artemis III candidate landing regions at the lunar south pole, so mission teams could rehearse there.

User flow (from the team's sketch; no sliders — they were hard to judge):
1. 3D Moon globe with the 9 south-pole regions highlighted and labeled.
2. Click a region → left panel shows its name and a checklist of constraints (Topography: overall slope, steepest areas, roughness, relief; Environment: temperature, disabled until data exists). The order you check them = priority; picked ones show as numbered chips with an × to remove. Weights come from rank (1st = n, 2nd = n-1, …, normalized). Then GO.
3. Right panel: top 1–5 Earth matches, each with a satellite thumbnail and % match.
4. Click a match → detail: satellite map with the 20 km patch outlined, % match, "Best for" mission type, Moon-vs-Earth table per feature, pros and cons.
5. (Later, cuttable) AI chat for follow-up questions, styled like the dark rounded panels (reference: Planet's "Ask Planet" side panel). Answers only from the computed numbers.

Scope is terrain only for now. Temperature is shown as "soon" in the UI; don't wire climate/thermal data unless asked.

Without the backend the frontend falls back to clearly labeled **sample data** (`frontend/sample.js`, made-up numbers) so the UI can be demoed.

## API contract (`GET /match`)
Implemented in `backend/app.py` (run instructions, data file formats and scoring in `backend/README.md`).
`/match?region=<region id from regions.js>&constraints=p90Slope,roughness,relief&n=5&include_snow=false` — constraints in priority order.
```json
{
  "region": "haworth",
  "constraints": ["p90Slope", "roughness", "relief"],
  "sample": false,
  "eligible": 41234,
  "matches": [
    { "id": "...", "name": "Atacama Desert", "country": "Chile", "lat": -24.1, "lon": -69.25,
      "match": 87.5,
      "features": { "meanSlope": { "moon": 9.1, "earth": 7.5, "score": 89 }, "p90Slope": {...}, "roughness": {...}, "relief": {...} } }
  ]
}
```
`score` is 0–100 per feature; `match` is the rank-weighted geometric mean of scores for the picked constraints (so one far-off feature can't hide behind good ones). Return all 4 features even if not picked (the detail table shows them). `name`/`country` can be null (frontend shows coordinates); a reverse-geocode or hand-labeled names for the top hits is nice to have.

## Target regions (approximate — verify in Moon Trek: https://trek.nasa.gov/moon/)

Estimated from NASA's Artemis III candidate-region map (0° lon up from the pole).

| Region | Lat | Lon | Box |
|---|---|---|---|
| Peak near Cabeus B | -83.6 | -68.6 | ~21 km |
| Haworth | -86.8 | -22.6 | ~31 km |
| Malapert Massif | -86.0 | 0.0 | ~22 km |
| Mons Mouton Plateau | -84.3 | 30.5 | ~78 x 58 km |
| Mons Mouton | -85.4 | 31.7 | ~17 km |
| Nobile Rim 1 | -85.4 | 37.3 | ~21 km |
| Nobile Rim 2 | -84.0 | 58.8 | ~21 km |
| de Gerlache Rim 2 | -88.2 | -64.4 | ~21 km |
| Slater Plain | -87.2 | 125.4 | ~21 km |

Single source of truth in code: `frontend/regions.js` (backend should load the same list).

## Terrain comparison method
- Same resolution on both bodies: resample Moon and Earth DEMs to ~100 m/pixel. Slope statistics are only comparable at matching pixel size.
- Same window: 20 km x 20 km patches.
- Descriptors per patch (4 numbers): mean slope (deg), 90th-percentile slope (deg), roughness (std dev of elevation, m), relief (max - min elevation, m).
- Similarity: normalize each descriptor (percentile or z-score across Earth patches), weighted distance to the Moon region's descriptors → match % (0–100).
- Mission presets (weights):
  - Landing practice: p90 slope and roughness weighted highest (want low).
  - Rover traversal: moderate slope/roughness.
  - Crater-rim / massif operations: relief and steep slopes weighted highest.
- Validation idea: check results are sensible (expect bare mountain / high-desert terrain: Andes, Tibetan Plateau, arid ranges).

## Earth exclusion mask (bare ground only)
- NASA MODIS Land Cover MCD12Q1 v061 (500 m, Earth Engine `MODIS/061/MCD12Q1`, band `LC_Type1`): keep IGBP class 16 "Barren"; class 15 = permanent snow/ice.
- Keep a patch only if >= ~70% of it is bare.
- Snow/ice: excluded by default, exposed as a toggle.

## Data sources
- Team decision: use NASA data from Earthdata Search (https://search.earthdata.nasa.gov/) wherever possible. Find and cite datasets there (DOIs); compute in Earth Engine, which hosts copies.
- Earth DEM: NASADEM v001 (`NASA/NASADEM_HGT/001`, band `elevation`, 30 m, covers 60°N–56°S). Copernicus GLO-30 (`COPERNICUS/DEM/GLO30`) only fills the polar gaps; each patch records `demSource`. `--nasa-only` skips the fill. Compute descriptors server-side in Earth Engine, export once as CSV.
- Candidate NASA datasets for future comparisons: temperature = MODIS LST MOD11A2 v061; sunlight = MERRA-2 SWGDN or NASA POWER; water/ice = MODIS snow (MOD10), SMAP soil moisture. Moon side: LOLA illumination maps, Diviner temperatures (PDS).
- Moon DEM: LRO LOLA south polar DEM at ~100 m/pixel (PDS LOLA archive or NASA Goddard Planetary Geodesy Data Archive). Use the ~100 m product (hundreds of MB), NOT the 5–20 m products (many GB). Polar stereographic projection.
- Satellite imagery for results: NASA GIBS tiles (the service behind NASA Worldview); Esri World Imagery for sharper zoom.
- Moon globe texture: NASA SVS "CGI Moon Kit" (LRO color map). (Placeholder texture from the globe.gl example is used until swapped.)
- Challenge-listed resources: Earthdata Search, Worldview, PDS, LRO (LOLA, Diviner, etc.). Credit every dataset by name with a link in the submission.

## Stack
- Frontend: globe.gl (3D Moon, clickable labeled points; click returns lat/lon) + Leaflet mini-maps for result imagery. Vanilla JS, ES modules from CDN (no Node installed on this machine; no build step). Serve with `python3 -m http.server`.
- Backend: FastAPI + numpy. Loads precomputed Earth descriptor grid + Moon region descriptors; `/match?region=...&weights=...` returns top N matches with per-feature breakdown.
- Data prep: Python (earthengine-api, rasterio, numpy, pandas).
- Chatbot (last): LLM API; system prompt contains the selected region's descriptors and top matches; instruct it to answer only from those numbers.

## Build order
1. Globe with the 9 regions pinned and clickable (frontend). ✅ done, plus constraint picker, results list, and detail view on sample data
2. Earth descriptors + bare-ground mask (data). **Preferred: `data_prep/earthdata_pipeline.py`** (100% NASA Earthdata: SRTMGL30 + MCD12C1 screening, SRTMGL3/ASTGTM terrain at 100 m, adds `shape`, 22 named crater/volcano analog sites). ✅ Run: 734 tiles downloaded, 12,775 patches in `backend/data/earth_patches.csv`, named offline by `data_prep/add_place_names.py` (GeoNames + Natural Earth). Earthdata Login is saved on this Mac. Alternative, Earth Engine script written: `data_prep/earth_engine_export.py` + `merge_earth_csv.py` (see `data_prep/README.md`); not yet run (needs the team's EE project).
3. Moon descriptors for the 9 regions from the LOLA DEM (data). Must use the same definitions; spelled out in `data_prep/README.md`.
4. FastAPI `/match` endpoint, wired to the globe click → results list. ✅ done on sample data; drop real `earth_patches.csv` + `moon_regions.json` into `backend/data/`
5. Satellite images on results, mission presets. Checkpoint: end-to-end works by Saturday 11 PM.
6. Sunday: chatbot, polish, deploy, demo video/slides, README, submit.

## Known limits to state honestly in the demo
Terrain-only; Earth can't match lunar gravity, vacuum, radiation, or polar lighting. Lunar terrain is impact-shaped; Earth terrain is erosion-shaped.

## Planning doc
https://claude.ai/artifact/54GCkyBpwNwvRWvLWDQhYo (earlier, broader plan; this file is the current scope).
