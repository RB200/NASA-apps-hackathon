# Lunar Rover Simulation

`frontend/terrain.html` visualizes the 5 m south-polar LOLA raster in 3D. From the simulation folder, regenerate its small web assets from the original PDS IMG and matching label:

```bash
python3 -B data_prep/prepare_lola_3d.py
```

The app includes a 512 × 512 native-resolution tile near De Gerlache Rim 2; a 1024 × 1024 crater tile sampled at 20 m with a 512 × 512 native-resolution patch around the rover spawn; and a full-cap overview sampled every 32 source pixels (160 m). Drive mode provides a lunar rover with terrain contact and suspension on both local views. The source raster covers 87.5°S to the pole, so the detailed tiles are local rather than a full view of all nine candidate regions.

Lunar drive terrain uses browser-sized color and normal maps converted from `../source-assets/rover/moon_textures/`, with uniform roughness. Randomized, blended 24 m texture samples reduce visible repetition and affect appearance only; LOLA elevations still determine terrain shape and rover contact. Earth uses its existing material.

The atlas link selects the paired Moon landing site and Earth analog. Nine local 1024 × 1024 tiles at 20 m/sample (20.48 km square) are extracted from LOLA `ldem_80s_20m.img` and stored in `frontend/assets/moon-sites/`. Regenerate them with `python3 -B data_prep/prepare_lunar_site_tiles.py` from this folder when the source raster is available at its default Desktop path.

Lunar views use `frontend/assets/lunar-skybox.webp`, a browser-compatible equirectangular conversion of the `../source-assets/rover/Lunar_Skybox.tif`. Earth analog mode retains its own sky. The original rover model is in `../source-assets/rover/Space Exploration Vehicle.glb`.

From the repository root, serve the project locally and open the viewer at `http://127.0.0.1:5175/lunar-rover-simulation/frontend/terrain.html`:

```bash
python3 -B -m http.server 5175
```

## Earth analog mode

The same rover can drive the best Earth analog of each Artemis III region (from the main app's terrain matching). Select a region and an Earth match in the atlas to open the pair in the viewer. Use **Local solar time** to preview lighting on either world before driving. Each world opens at 06:00 local solar time, and the selected time carries into the drive. While driving, press **T** (or **Switch to Moon / Switch to Earth**) to swap the ground under the rover, keeping its position and heading; **Esc** exits.

- Open straight into Earth mode: `terrain.html?region=slater-plain&world=earth`
- Earth tiles: `frontend/assets/earth/` (512 × 512 at 30 m = 15.36 km, int16 metres, NASA SRTMGL1 v003), built by `data_prep/prepare_earth_tiles.py` from SRTMGL1 tiles in `../data_prep/cache/srtmgl1/`.
- Code: `frontend/earth.js` + `frontend/earth.css`. Hooks in `terrain.js` (per-tile pixel size/height scale, Earth colours, no lunar craterlets, Moon⇄Earth toggle, lunar telemetry hidden on Earth) and `rover.js` (`setGravity`; suspension scales with gravity, unchanged on the Moon).
- Moon-site tiles are described in `frontend/assets/moon-sites/moon-sites.json`. Return to the atlas to select another pair.

## Live Terrain Traverse Analysis

Choose an Artemis region in the atlas and drive on either world. **Live Terrain Comparison** opens automatically and samples the same route from the center of the other tile in local east/north metres. The lunar detail and crater drive views also work with the selected Earth analog. Both profiles start at zero and sample every 30 m, plus the final valid point. Site tiles use a 20 m lunar grid and a 30 m Earth grid. The de Gerlache detail view uses a 5 m lunar grid, and the crater comparison uses its 20 m base grid. Earth locations selected in the atlas require the backend to supply their elevation.

Select **Finish test** for two aligned overhead maps, the elevation profiles, and route statistics. **R** starts a new recording. Switching worlds or exiting drive ends the current recording; **View last report** can reopen the latest result while the page stays open. When a route leaves either tile, the report marks it incomplete and stops the paired comparison at the boundary.

Run the sampling and alignment tests from the repository root:

```bash
node --test lunar-rover-simulation/tests/traverse.test.mjs
```
