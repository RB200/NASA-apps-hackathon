Write me a Python script that computes terrain descriptors for 9 lunar south-pole regions from the LRO LOLA DEM and saves them as JSON. It's for a NASA Space Apps hackathon project: we compare these numbers with the same numbers computed for Earth terrain, so the definitions below must be followed exactly.

## Input
- The LOLA south polar DEM at ~100 m/pixel (GeoTIFF or PDS .IMG, polar stereographic, south pole). I'll pass the file path as a command-line argument.
- Read it with rasterio. Get the CRS, transform and pixel size from the file; don't hard-code them.
- If the pixel size is finer than 100 m, average it down to 100 m first (block mean). If it's ~100 m already, use it as is. Print the pixel size you used.
- Elevation can be height or radius in meters. Either is fine (we only use differences). If the file stores kilometers or has a scale factor, convert to meters. Mask no-data values.

## Regions (center lat, lon in degrees; lon is east-positive, −180..180)
| id | name | lat | lon |
|---|---|---|---|
| cabeus-b-peak | Peak near Cabeus B | -83.6 | -68.6 |
| haworth | Haworth | -86.8 | -22.6 |
| malapert-massif | Malapert Massif | -86.0 | 0.0 |
| mons-mouton-plateau | Mons Mouton Plateau | -84.3 | 30.5 |
| mons-mouton | Mons Mouton | -85.4 | 31.7 |
| nobile-rim-1 | Nobile Rim 1 | -85.4 | 37.3 |
| nobile-rim-2 | Nobile Rim 2 | -84.0 | 58.8 |
| de-gerlache-rim-2 | de Gerlache Rim 2 | -88.2 | -64.4 |
| slater-plain | Slater Plain | -87.2 | 125.4 |

## Per region
1. Convert lat/lon to the DEM's projected x/y in meters with pyproj, using the DEM's own CRS (Moon sphere, radius 1737.4 km). Then convert x/y to row/col with the raster transform.
2. Cut a 20 km × 20 km window centered there (200 × 200 pixels at 100 m).
3. Slope in degrees: `np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))` where `dz_dy, dz_dx = np.gradient(z, pixel_size_m)`. Drop the 1-pixel border and ignore NaNs.
4. Compute:
   - `meanSlope` = mean slope (degrees)
   - `p90Slope` = 90th-percentile slope (degrees)
   - `roughness` = standard deviation of elevation in the window (meters)
   - `relief` = max − min elevation in the window (meters)
   - `shape` = (mean − min) / (max − min) of elevation in the window (hypsometric integral, 0–1; ~0.2 isolated peak, ~0.8 plateau or high ground around a crater)

## Output
Write `moon_regions.json` with exactly these keys, numbers rounded to 2 decimals:
```json
{
  "haworth": { "meanSlope": 0.0, "p90Slope": 0.0, "roughness": 0.0, "relief": 0.0, "shape": 0.0 },
  ...all 9 region ids...
}
```

## Checks the script must do
- Print a table: region, row/col of the center, % valid pixels, and the 4 numbers.
- Fail loudly if a window falls off the DEM or is more than 10% no-data.
- Sanity check for the lon sign: plot or save a PNG of the whole DEM (hillshade is fine) with the 9 centers and 20 km boxes drawn on it. Malapert (lon 0°) and Haworth (lon −22.6°) should be on the same side of the pole, and Slater Plain (lon 125°) on roughly the opposite side. Tell me to compare the PNG against NASA's Artemis III candidate-region map.
- Plausible ranges: mean slope a few to ~25°, relief hundreds to a few thousand m. Warn if any value is outside that.

Keep it to one file, with only numpy, rasterio, pyproj and matplotlib as dependencies. Also give me the pip install line and the run command.
