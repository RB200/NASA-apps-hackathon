# Data sources

## Lunar atlas and terrain

| Source | Use in the project |
| --- | --- |
| [NASA’s October 2024 candidate region release](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/) | Names and approximate locations of the nine Artemis candidate regions. The original release used the Artemis III label under the plan at the time. |
| [LRO Lunar Orbiter Laser Altimeter (LOLA) archive](https://pds-geosciences.wustl.edu/missions/lro/lola_faq.htm) | Elevation for the bundled [lunar terrain descriptors](backend/data/moon_regions.json), including slope, roughness, relief, and terrain shape. |
| [LOLA LDEM_80S_20M](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_20m.lbl) | 20 m source for the nine local lunar rover tiles. |
| [LOLA LDEM_875S_5M](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_875s_5m.lbl) | Source for the 5 m de Gerlache and crater detail patches and the coarser crater and polar overview views. |
| [NASA Goddard Lunar Polar Illumination](https://pgda.gsfc.nasa.gov/products/69) | The atlas summarizes the LOLA 120 m average visibility product, `AVGVISIB_75S_120M`, over each region. |
| [Supplied south-pole image](source-assets/atlas/South_Pole.png) | The atlas uses a resized, registered version of this image. The original publisher is unverified. |

## Earth atlas and terrain

| Source | Use in the project |
| --- | --- |
| [NASA SRTMGL30 v003](https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL30.003) | Coarse elevation used to screen candidate areas. |
| [NASA SRTMGL3 v003](https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL3.003) and [ASTER GDEM v003](https://doi.org/10.5067/ASTER/ASTGTM.003) | Elevation behind the bundled [Earth patch catalog](backend/data/earth_patches.csv). SRTM supplies 12,175 patches and ASTER supplies 600. Both products can also supply rover elevation. |
| [NASA MODIS MCD12C1 v061](https://doi.org/10.5067/MODIS/MCD12C1.061) | Barren-ground and snow/ice fractions used to screen and filter Earth patches. |
| [NASA SRTMGL1 v003](https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003) and [Copernicus DEM GLO-30](https://doi.org/10.5270/ESA-c5d3d65) | Elevation for 30 m Earth rover grids. The backend can download Copernicus tiles when NASA elevation is unavailable. |
| [GeoNames](https://download.geonames.org/export/dump/) and [Natural Earth](https://www.naturalearthdata.com/) | Nearby towns and administrative labels from GeoNames. Country boundaries and names of features such as deserts and mountain ranges from Natural Earth. |
| [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | Earth match thumbnails and satellite imagery in the detail view. |

The data preparation folder also provides an alternative Google Earth Engine workflow using [NASADEM_HGT v001](https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001), [MODIS MCD12Q1 v061](https://doi.org/10.5067/MODIS/MCD12Q1.061), and Copernicus GLO-30. The bundled Earth patch catalog came from the NASA Earthdata workflow. [Data preparation notes](data_prep/README.md)

## Calculated comparisons and simulation

- **Reachability and Shadow Match** are calculated from the Earth rover grids and lunar LOLA tiles. Reachability measures connected terrain under slope limits. Shadow Match compares cast-shadow coverage under the same 5° Sun elevation from eight directions. [Scoring and regeneration](backend/README.md#scoring)
- **Solar position and rover lighting** use the US Naval Observatory’s approximate Sun position and JPL’s lunar orientation constants. The simulator estimates horizontal irradiance and lunar surface temperature from modeled sunlight. [USNO solar position](https://aa.usno.navy.mil/faq/sun_approx) · [JPL orientation constants](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc) · [NASA solar irradiance](https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science) · [NIST Stefan–Boltzmann constant](https://physics.nist.gov/cgi-bin/cuu/Value?sigma)
- **Lunar reference values** use NASA and JPL references for lunar gravity, atmosphere, distance, and orbital recession. The relative clock rate uses the NIST lunar time study. [NASA Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) · [JPL distance reference](https://cneos.jpl.nasa.gov/glossary/LD.html) · [NASA lunar laser ranging](https://eclipse.gsfc.nasa.gov/SEcat5/laser.html) · [NIST lunar time study](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=957328)
- **Temperature research** used LRO Diviner Polar Cumulative Products for lunar regions and MODIS Terra MOD11A1 v061 for Great Basin examples. These exploratory summaries are outside the current match score. Backend and atlas sample fixtures contain synthetic values. [NASA PDS Diviner](https://pds-geosciences.wustl.edu/missions/lro/diviner.htm) · [NASA MOD11A1 v061](https://doi.org/10.5067/MODIS/MOD11A1.061)

## Visual assets

- The lunar driving surface uses color and normal maps from Poly Haven’s Moon 04 surface material, which was scanned from lunar regolith simulant. The elevation underneath comes from LOLA. [Poly Haven Moon 04](https://polyhaven.com/a/moon_04)
- The Earth driving surface uses 1K color and normal maps converted from two Poly Haven materials. Snow placement is illustrative and based on terrain elevation. [Rocky Trail 02](https://polyhaven.com/a/rocky_trail_02) · [Snow 02](https://polyhaven.com/a/snow_02)
- We used NASA’s Space Exploration Vehicle model and adapted it for driving. The simulator separates the wheels from the chassis so they can rotate and move with the suspension. [NASA Space Exploration Vehicle](https://science.nasa.gov/3d-resources/space-exploration-vehicle/)
- The skybox was supplied to the project. Its upstream creator and license have yet to be verified. [Original skybox file](source-assets/rover/Lunar_Skybox.tif)
