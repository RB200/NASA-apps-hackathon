# Lunar Rover Simulation

`frontend/terrain.html` visualizes the 5 m south-polar LOLA raster in 3D. From the simulation folder, regenerate its small web assets from the original PDS IMG and matching label:

```bash
python3 -B data_prep/prepare_lola_3d.py
```

The app includes a 512 × 512 native-resolution tile near De Gerlache Rim 2; a 1024 × 1024 crater tile sampled at 20 m with a 512 × 512 native-resolution patch around the rover spawn; and a full-cap overview sampled every 32 source pixels (160 m). Drive mode provides a lunar rover with terrain contact and suspension on both local views. The source raster covers 87.5°S to the pole, so the detailed tiles are local rather than a full view of all nine candidate regions.

From the repository root, serve the project locally and open the viewer at `http://127.0.0.1:5175/lunar-rover-simulation/frontend/terrain.html`:

```bash
python3 -B -m http.server 5175
```

## Earth analog mode

The same rover can drive the best Earth analog of each Artemis III region (from the main app's terrain matching). In the viewer, pick a region under **Artemis region**, press **Earth analog**, then **Drive on Earth**. While driving, press **T** (or **Switch to Moon / Switch to Earth**) to swap the ground under the rover, keeping its position and heading; **Esc** exits.

- Open straight into Earth mode: `terrain.html?region=slater-plain&world=earth`
- Earth tiles: `frontend/assets/earth/` (512 × 512 at 30 m = 15.36 km, int16 metres, NASA SRTMGL1 v003), built by `data_prep/prepare_earth_tiles.py` from SRTMGL1 tiles in `../data_prep/cache/srtmgl1/`.
- Code: `frontend/earth.js` + `frontend/earth.css`. Hooks in `terrain.js` (per-tile pixel size/height scale, Earth colours, no lunar craterlets, Moon⇄Earth toggle, lunar telemetry hidden on Earth) and `rover.js` (`setGravity`; suspension scales with gravity, unchanged on the Moon).
- Only de Gerlache Rim 2 has its own Moon tile so far; other regions switch to the polar crater view and the HUD says so.
