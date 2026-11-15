// Artemis III candidate regions (approximate; verify in Moon Trek https://trek.nasa.gov/moon/)
// boxKm: [width, height] of the region box.
export const REGIONS = [
  { id: 'cabeus-b-peak',       name: 'Peak near Cabeus B',  lat: -83.6, lon: -68.6, boxKm: [21, 21] },
  { id: 'haworth',             name: 'Haworth',             lat: -86.8, lon: -22.6, boxKm: [31, 31] },
  { id: 'malapert-massif',     name: 'Malapert Massif',     lat: -86.0, lon:   0.0, boxKm: [22, 22] },
  { id: 'mons-mouton-plateau', name: 'Mons Mouton Plateau', lat: -84.3, lon:  30.5, boxKm: [78, 58] },
  { id: 'mons-mouton',         name: 'Mons Mouton',         lat: -85.4, lon:  31.7, boxKm: [17, 17], labelSide: 'left' },
  { id: 'nobile-rim-1',        name: 'Nobile Rim 1',        lat: -85.4, lon:  37.3, boxKm: [21, 21] },
  { id: 'nobile-rim-2',        name: 'Nobile Rim 2',        lat: -84.0, lon:  58.8, boxKm: [21, 21] },
  { id: 'de-gerlache-rim-2',   name: 'de Gerlache Rim 2',   lat: -88.2, lon: -64.4, boxKm: [21, 21] },
  { id: 'slater-plain',        name: 'Slater Plain',        lat: -87.2, lon: 125.4, boxKm: [21, 21] },
];

// Constraints the user can pick. Order picked = priority (first = most important).
// scale: the difference at which a feature counts as "no match" (used for per-feature score).
// pending: shown but not selectable until we have the data.
export const CONSTRAINTS = [
  { key: 'meanSlope',   group: 'Topography',  label: 'Overall slope',   hint: 'Average steepness',             unit: '°', scale: 15 },
  { key: 'p90Slope',    group: 'Topography',  label: 'Steepest areas',  hint: '90th-percentile slope',         unit: '°', scale: 20 },
  { key: 'roughness',   group: 'Topography',  label: 'Roughness',       hint: 'How bumpy (std dev of height)', unit: ' m', scale: 300 },
  { key: 'relief',      group: 'Topography',  label: 'Relief',          hint: 'Highest minus lowest point',    unit: ' m', scale: 1500 },
  // Hypsometric integral: ~0.2 isolated peak/cone, ~0.5 even slope, ~0.8 plateau / high ground around a crater
  { key: 'shape',       group: 'Topography',  label: 'Shape',           hint: 'Crater/plateau vs peak',        unit: '',   scale: 0.25, digits: 2 },
  { key: 'temperature', group: 'Environment', label: 'Temperature',     hint: 'Data not added yet',            unit: ' K', scale: 100, pending: true },
];

export const MOON_RADIUS_KM = 1737.4;
