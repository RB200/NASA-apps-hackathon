// PLACEHOLDER DATA — used only when the backend isn't running, so the UI can be demoed.
// Numbers are made up. Replace with real LOLA / Copernicus DEM descriptors.

// Moon region descriptors (fake): derived from region id so each region looks a bit different.
export function sampleMoon(regionId) {
  let h = 0;
  for (const c of regionId) h = (h * 31 + c.charCodeAt(0)) % 1000;
  const f = h / 1000;
  return {
    meanSlope: 6 + 10 * f,
    p90Slope: 14 + 16 * f,
    roughness: 80 + 260 * f,
    relief: 500 + 1800 * f,
  };
}

// Earth candidate patches (real places, fake descriptor values).
export const SAMPLE_EARTH = [
  { id: 'atacama',  name: 'Atacama Desert',        country: 'Chile',     lat: -24.10, lon: -69.25, meanSlope: 7.5,  p90Slope: 17, roughness: 120, relief: 780 },
  { id: 'hoggar',   name: 'Hoggar Mountains',      country: 'Algeria',   lat:  23.30, lon:   5.60, meanSlope: 12,   p90Slope: 26, roughness: 240, relief: 1500 },
  { id: 'haughton', name: 'Haughton Crater',       country: 'Canada',    lat:  75.38, lon: -89.68, meanSlope: 5,    p90Slope: 13, roughness: 70,  relief: 420 },
  { id: 'panamint', name: 'Panamint Range',        country: 'USA',       lat:  36.20, lon: -117.10, meanSlope: 16,  p90Slope: 31, roughness: 330, relief: 2100 },
  { id: 'qaidam',   name: 'Qaidam Basin edge',     country: 'China',     lat:  37.80, lon:  91.50, meanSlope: 9,    p90Slope: 20, roughness: 160, relief: 1000 },
  { id: 'altiplano',name: 'Altiplano (Uyuni rim)', country: 'Bolivia',   lat: -20.70, lon: -67.60, meanSlope: 4,    p90Slope: 10, roughness: 55,  relief: 350 },
  { id: 'dry-valleys', name: 'McMurdo Dry Valleys', country: 'Antarctica', lat: -77.50, lon: 162.00, meanSlope: 14, p90Slope: 29, roughness: 290, relief: 1800 },
];
