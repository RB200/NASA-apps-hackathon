# Lunar Rover Simulation

`frontend/terrain.html` visualizes the 5 m south-polar LOLA raster in 3D. From the simulation folder, regenerate its small web assets from the original PDS IMG and matching label:

```bash
python3 -B data_prep/prepare_lola_3d.py
```

The Moon scene uses `frontend/assets/moon-skybox.jpg`, a browser-ready equirectangular version of the repository-root `Skybox.tif`. Earth mode keeps its separate blue sky.

The app includes a 512 × 512 native-resolution tile near De Gerlache Rim 2; a 1024 × 1024 crater tile sampled at 20 m with a 512 × 512 native-resolution patch around the rover spawn; and a full-cap overview sampled every 32 source pixels (160 m). Drive mode provides a lunar rover with terrain contact and suspension on both local views. The source raster covers 87.5°S to the pole, so the detailed tiles are local rather than a full view of all nine candidate regions.

The **Artemis region** selector loads the matching Moon landing-site terrain as well as the Earth analog. Nine local 1024 × 1024 tiles at 20 m/sample (20.48 km square) are extracted from LOLA `ldem_80s_20m.img` and stored in `frontend/assets/moon-sites/`. Regenerate them with `python3 -B data_prep/prepare_lunar_site_tiles.py` from this folder when the source raster is available at its default Desktop path.

Lunar views use `frontend/assets/lunar-skybox.webp`, a browser-compatible equirectangular conversion of the provided `Lunar_Skybox.tif`. Earth analog mode retains its own sky.

From the repository root, serve the project locally and open the viewer at `http://127.0.0.1:5175/lunar-rover-simulation/frontend/terrain.html`:

```bash
python3 -B -m http.server 5175
```

## Earth analog mode

The same rover can drive the best Earth analog of each Artemis III region (from the main app's terrain matching). In the viewer, pick a region under **Artemis region**, press **Earth analog**, then **Drive on Earth**. While driving, press **T** (or **Switch to Moon / Switch to Earth**) to swap the ground under the rover, keeping its position and heading; **Esc** exits.

- Open straight into Earth mode: `terrain.html?region=slater-plain&world=earth`
- Earth tiles: `frontend/assets/earth/` (512 × 512 at 30 m = 15.36 km, int16 metres, NASA SRTMGL1 v003), built by `data_prep/prepare_earth_tiles.py` from SRTMGL1 tiles in `../data_prep/cache/srtmgl1/`.
- Code: `frontend/earth.js` + `frontend/earth.css`. Hooks in `terrain.js` (per-tile pixel size/height scale, Earth colours, no lunar craterlets, Moon⇄Earth toggle, lunar telemetry hidden on Earth) and `rover.js` (`setGravity`; suspension scales with gravity, unchanged on the Moon).
- Moon-site tiles are described in `frontend/assets/moon-sites/moon-sites.json`. The shared Artemis region selector switches the Moon terrain when in lunar view and the Earth analog when in Earth view.

## Live Terrain Traverse Analysis

Choose **de Gerlache Rim 2**, drive on either world, then open **Live Terrain Comparison**. The other tile is sampled from its center along the same path in local east/north metres. Both profiles start at zero, sample every 30 m of horizontal travel, and include the final valid endpoint. The comparison uses raw DEM heights: Earth at 30 m, the dedicated lunar site at 20 m, or the 5 m lunar tile if driving in the De Gerlache detail view.

Select **Finish test** for two aligned overhead maps, the elevation profiles, and route statistics. **R** starts a new recording. Switching worlds or exiting drive ends the current recording; **View last report** can reopen the latest result while the page stays open. When a route leaves either tile, the report marks it incomplete and stops the paired comparison at the boundary. Other regions still support driving.

Run the sampling and alignment tests from the repository root:

```bash
node --test lunar-rover-simulation/tests/traverse.test.mjs
```
