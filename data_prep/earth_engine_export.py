"""Compute Earth terrain descriptors per 20 x 20 km patch in Google Earth Engine, from NASA data.

Output columns match backend/data/earth_patches.csv:
  lat, lon, meanSlope, p90Slope, roughness, relief, bareFrac, snowFrac, demSource

NASA datasets (find/cite them in Earthdata Search; Earth Engine hosts copies):
  NASADEM v001 (LP DAAC)          NASA/NASADEM_HGT/001   band "elevation"   30 m, covers 60°N–56°S
      https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001
  MODIS Land Cover MCD12Q1 v061   MODIS/061/MCD12Q1      band "LC_Type1"    500 m, yearly
      https://doi.org/10.5067/MODIS/MCD12Q1.061
      IGBP classes: 16 = Barren, 15 = Permanent Snow and Ice
Polar fill (only where NASADEM has no data, i.e. north of 60°N / south of 56°S):
  Copernicus DEM GLO-30           COPERNICUS/DEM/GLO30   band "DEM"
  Use --nasa-only to skip the fill and keep NASADEM patches only.
Verify band names on each catalog page if anything errors.

Usage
  pip install -r data_prep/requirements.txt
  earthengine authenticate                      # once, opens a browser
  # 1) Quick check on one small area, prints rows (takes ~1 min):
  python data_prep/earth_engine_export.py --project YOUR_GCP_PROJECT preview
  python data_prep/earth_engine_export.py --project YOUR_GCP_PROJECT preview --area devon_island   # polar fill
  # 2) Launch the global export as one Drive task per 30x30 degree tile:
  python data_prep/earth_engine_export.py --project YOUR_GCP_PROJECT export
  #    Watch progress at https://code.earthengine.google.com/tasks
  # 3) Download the CSVs from Drive folder "space_broncos_export", then:
  python data_prep/merge_earth_csv.py ~/Downloads/space_broncos_export/*.csv
"""
from __future__ import annotations

import argparse

import ee

PATCH_M = 20_000      # 20 km patches
DEM_SCALE_M = 100     # resample DEM to ~100 m/pixel (must match the Moon side)
COVER_SCALE_M = 500   # MODIS land cover is 500 m
MIN_BARE = 0.70       # same threshold the backend uses
NASA_FULL = 0.99      # patch counts as "NASADEM" if >= 99% of it has NASADEM data
GRID_CRS = "EPSG:6933"  # equal-area (EASE-Grid 2.0): every patch is really 20 x 20 km
DRIVE_FOLDER = "space_broncos_export"
COLUMNS = ["lat", "lon", "meanSlope", "p90Slope", "roughness", "relief", "bareFrac", "snowFrac", "demSource"]

BARREN, SNOW_ICE = 16, 15  # MODIS IGBP classes (LC_Type1)

# Small test areas with known bare terrain: [west, south, east, north]
PREVIEW_BOXES = {
    "atacama": [-70.0, -25.0, -68.5, -23.5],         # NASADEM
    "death_valley": [-117.6, 35.8, -116.4, 36.8],    # NASADEM
    "devon_island": [-91.0, 75.0, -88.5, 75.8],      # north of 60°N → Copernicus fill
}


def build_inputs(nasa_only: bool):
    nasadem = ee.Image("NASA/NASADEM_HGT/001").select("elevation")
    has_nasa = nasadem.mask().gt(0).unmask(0).rename("nasa")

    if nasa_only:
        dem = nasadem
    else:
        cop_col = ee.ImageCollection("COPERNICUS/DEM/GLO30").select("DEM")
        cop = cop_col.mosaic().setDefaultProjection(cop_col.first().projection()).rename("elevation")
        dem = nasadem.unmask(cop)  # NASADEM wherever it exists, Copernicus only to fill the gaps

    slope = ee.Terrain.slope(dem).rename("slope")  # degrees
    terrain = slope.addBands(dem.rename("elev"))

    # Latest year of MODIS land cover
    cover = (ee.ImageCollection("MODIS/061/MCD12Q1")
             .sort("system:time_start", False).first().select("LC_Type1"))
    fractions = (cover.eq(BARREN).rename("bare")
                 .addBands(cover.eq(SNOW_ICE).rename("snow"))
                 .unmask(0)            # ocean / no-data counts as not bare
                 .addBands(has_nasa))
    return terrain, fractions


def patches(box: list[float]) -> ee.FeatureCollection:
    region = ee.Geometry.Rectangle(box, proj="EPSG:4326", geodesic=False)
    return region.coveringGrid(ee.Projection(GRID_CRS), PATCH_M)


def descriptors(box: list[float], nasa_only: bool = False) -> ee.FeatureCollection:
    terrain, fractions = build_inputs(nasa_only)
    grid = patches(box)

    # Stage 1 (cheap): bare / snow / NASADEM-coverage fraction per patch, then drop non-bare patches.
    cover_stats = fractions.reduceRegions(
        collection=grid, reducer=ee.Reducer.mean(), scale=COVER_SCALE_M, tileScale=4)
    keep = cover_stats.filter(ee.Filter.gte("bare", MIN_BARE))
    if nasa_only:
        keep = keep.filter(ee.Filter.gte("nasa", NASA_FULL))

    # Stage 2: terrain stats only on the survivors.
    reducer = (ee.Reducer.mean()
               .combine(ee.Reducer.percentile([90]), sharedInputs=True)
               .combine(ee.Reducer.stdDev(), sharedInputs=True)
               .combine(ee.Reducer.minMax(), sharedInputs=True))
    stats = terrain.reduceRegions(
        collection=keep, reducer=reducer, scale=DEM_SCALE_M, tileScale=8)

    def tidy(f):
        c = f.geometry().centroid(maxError=100).coordinates()
        nasa = ee.Number(f.get("nasa"))
        source = ee.Algorithms.If(nasa.gte(NASA_FULL), "NASADEM",
                                  ee.Algorithms.If(nasa.lte(0.01), "Copernicus", "NASADEM+Copernicus"))
        return ee.Feature(None, {
            "lat": c.get(1),
            "lon": c.get(0),
            "meanSlope": f.get("slope_mean"),
            "p90Slope": f.get("slope_p90"),
            "roughness": f.get("elev_stdDev"),
            "relief": ee.Number(f.get("elev_max")).subtract(ee.Number(f.get("elev_min"))),
            "bareFrac": f.get("bare"),
            "snowFrac": f.get("snow"),
            "demSource": source,
        })

    # Patches with no DEM data (e.g. at the coast edge) lack elev_max; drop them.
    return stats.filter(ee.Filter.notNull(["elev_max", "slope_p90"])).map(tidy)


def world_tiles(step: int = 30) -> list[tuple[str, list[float]]]:
    tiles = []
    for south in range(-90, 90, step):
        for west in range(-180, 180, step):
            name = f"tile_lat{south:+04d}_lon{west:+05d}"
            # EASE-Grid is defined to about ±86°; nothing useful lies beyond.
            tiles.append((name, [west, max(south, -86), west + step, min(south + step, 86)]))
    return tiles


def cmd_preview(args):
    box = PREVIEW_BOXES[args.area]
    fc = descriptors(box, args.nasa_only)
    rows = fc.limit(args.limit).getInfo()["features"]
    print(f"{args.area}: {fc.size().getInfo()} bare patches (showing {len(rows)})")
    print(",".join(COLUMNS))
    for r in rows:
        p = r["properties"]
        print(",".join(f"{p[k]:.4f}" if isinstance(p.get(k), (int, float)) else str(p.get(k)) for k in COLUMNS))


def cmd_export(args):
    tiles = world_tiles()
    if args.only:
        tiles = [t for t in tiles if t[0] in args.only]
    for name, box in tiles:
        task = ee.batch.Export.table.toDrive(
            collection=descriptors(box, args.nasa_only),
            description=name,
            folder=DRIVE_FOLDER,
            fileNamePrefix=name,
            fileFormat="CSV",
            selectors=COLUMNS,
        )
        task.start()
        print("started", name, box)
    print(f"\n{len(tiles)} tasks started. Watch them at https://code.earthengine.google.com/tasks")
    print(f"CSVs will land in Google Drive folder '{DRIVE_FOLDER}'.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="Google Cloud project registered for Earth Engine")
    ap.add_argument("--nasa-only", action="store_true",
                    help="NASADEM only: no Copernicus fill, so nothing north of 60°N or south of 56°S")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("preview", help="print descriptors for a small test area")
    p.add_argument("--area", choices=PREVIEW_BOXES, default="atacama")
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=cmd_preview)
    e = sub.add_parser("export", help="start global export tasks to Google Drive")
    e.add_argument("--only", nargs="*", help="tile names to export (default: all)")
    e.set_defaults(func=cmd_export)
    args = ap.parse_args()

    ee.Initialize(project=args.project)
    args.func(args)


if __name__ == "__main__":
    main()
