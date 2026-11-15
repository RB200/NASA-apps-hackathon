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
