"""Add place names to backend/data/earth_patches.csv, offline.

    backend/.venv/bin/python data_prep/add_place_names.py

For each patch:
  name     the smallest named desert / mountain range / plateau / basin / island containing it
           (Natural Earth geography regions); if none, "Near <town>". Named analog sites keep their name.
  country  "<state/province>, <country>" (country from Natural Earth borders; state from the nearest GeoNames town)
  near     "<nearest town> (<km> km)" (GeoNames towns with population ≥ 1000)

Sources (in data_prep/cache/names/):
  GeoNames cities1000.zip, admin1CodesASCII.txt, countryInfo.txt  https://download.geonames.org/export/dump/  (CC BY 4.0)
  Natural Earth ne_10m_geography_regions_polys, ne_50m_admin_0_countries  https://www.naturalearthdata.com/  (public domain)
"""
import csv
import io
import json
import re
import zipfile
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import Point, shape

HERE = Path(__file__).resolve().parent
NAMES = HERE / "cache" / "names"
CSV = HERE.parent / "backend" / "data" / "earth_patches.csv"

REGION_CLASSES = {"Range/mtn", "Plateau", "Desert", "Basin", "Valley", "Plain", "Foothills", "Lowland",
                  "Tundra", "Island", "Island group", "Peninsula", "Pen/cape", "Gorge", "Depression"}
ABBREV = [(r"\bMts\.", "Mountains"), (r"\bMt\.", "Mount"), (r"\bRa\.", "Range"), (r"\bPlat\.", "Plateau"),
          (r"\bDes\.", "Desert"), (r"\bI\.", "Island"), (r"\bIs\.", "Islands"), (r"\bPen\.", "Peninsula")]


def tidy(name: str) -> str:
    for pat, rep in ABBREV:
        name = re.sub(pat, rep, name)
    return name.strip()


def polygons(path: Path, keep, label):
    feats = [f for f in json.load(open(path))["features"] if keep(f["properties"])]
    geoms = [shape(f["geometry"]) for f in feats]
    return STRtree(geoms), geoms, [label(f["properties"]) for f in feats]


def containing(tree, geoms, labels, pt, smallest=True):
    hits = [i for i in tree.query(pt, predicate="intersects")]
    if not hits:
        return None
    if smallest:
        hits.sort(key=lambda i: geoms[i].area)
    return labels[hits[0]]


def load_towns():
    countries = {}
    for line in open(NAMES / "countryInfo.txt", encoding="utf-8"):
        if not line.startswith("#"):
            p = line.rstrip("\n").split("\t")
            countries[p[0]] = p[4]
    admin1 = {}
    for line in open(NAMES / "admin1CodesASCII.txt", encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        admin1[p[0]] = p[1]
    names, lat, lon, cc, adm = [], [], [], [], []
    with zipfile.ZipFile(NAMES / "cities1000.zip") as zf:
        with zf.open("cities1000.txt") as f:
            for line in io.TextIOWrapper(f, encoding="utf-8"):
                p = line.split("\t")
                names.append(p[1]); lat.append(float(p[4])); lon.append(float(p[5]))
                cc.append(p[8]); adm.append(admin1.get(f"{p[8]}.{p[10]}", ""))
    lat, lon = np.radians(lat), np.radians(lon)
    xyz = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=1)
    return names, xyz, cc, adm, countries


def nearest(xyz_towns, lats, lons, chunk=400):
    la, lo = np.radians(lats), np.radians(lons)
    q = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=1).astype(np.float32)
    t = xyz_towns.astype(np.float32)
    idx, km = np.empty(len(q), int), np.empty(len(q))
    for s in range(0, len(q), chunk):
        with np.errstate(all="ignore"):  # spurious FP warnings from numpy+Accelerate matmul on macOS
            dots = q[s:s + chunk] @ t.T
        j = dots.argmax(axis=1)
        idx[s:s + chunk] = j
        km[s:s + chunk] = 6371 * np.arccos(np.clip(dots[np.arange(len(j)), j], -1, 1))
    return idx, km


def main():
    rows = list(csv.DictReader(open(CSV, newline="")))
    cols = list(rows[0].keys())
    if "near" not in cols:
        cols.append("near")

    regions = polygons(NAMES / "ne_10m_geography_regions_polys.geojson",
                       lambda p: p.get("FEATURECLA") in REGION_CLASSES,
                       lambda p: tidy(p.get("NAME_EN") or p.get("NAME") or ""))
    borders = polygons(NAMES / "ne_50m_admin_0_countries.geojson", lambda p: True,
                       lambda p: p.get("NAME") or p.get("ADMIN"))   # short common name, e.g. "China"
    town_names, town_xyz, town_cc, town_adm, country_names = load_towns()
    # Natural Earth vs GeoNames spell a few countries differently; match them by ISO code instead.
    iso = {p.get("NAME") or p.get("ADMIN"): p.get("ISO_A2_EH") or p.get("ISO_A2")
           for p in (f["properties"] for f in json.load(open(NAMES / "ne_50m_admin_0_countries.geojson"))["features"])}
    country_code_alias = {name: (code,) for name, code in iso.items() if code}

    lats = np.array([float(r["lat"]) for r in rows])
    lons = np.array([float(r["lon"]) for r in rows])
    t_idx, t_km = nearest(town_xyz, lats, lons)

    named_region = 0
    for r, la, lo, j, km in zip(rows, lats, lons, t_idx, t_km):
        pt = Point(lo, la)
        town = town_names[j]
        country = containing(*borders, pt, smallest=False) or country_names.get(town_cc[j], "")
        same_country = country_names.get(town_cc[j], "") == country or town_cc[j] in country_code_alias.get(country, ())
        state = town_adm[j] if same_country else ""
        region = containing(*regions, pt)
        r["near"] = f"{town} ({km:.0f} km)"
        if not r.get("name"):
            r["name"] = region or f"Near {town}"
            named_region += bool(region)
        if not r.get("country"):
            r["country"] = ", ".join(x for x in (state, country) if x)

    with open(CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"named {len(rows)} patches ({named_region} by geographic region, rest by nearest town) → {CSV}")
    print(f"median distance to nearest town: {np.median(t_km):.0f} km, max {t_km.max():.0f} km")


if __name__ == "__main__":
    main()
