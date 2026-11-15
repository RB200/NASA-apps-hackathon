// Earth analog mode for the rover simulator.
//
// Earth tiles (assets/earth/*.bin) use the same int16 grid layout as the LOLA tiles, but carry their
// own pixelSizeM / heightScaleM, so terrain.js can render and drive them with the same code.
// Built by lunar-rover-simulation/data_prep/prepare_earth_tiles.py from NASA SRTMGL1 (30 m).
import * as THREE from 'three';

export const MOON_GRAVITY = 1.62;

// Moon views in terrain.js that show a given Artemis region. Regions without their own Moon tile
// fall back to the crater view and say so in the HUD.
const MOON_VIEW_FOR_REGION = { 'de-gerlache-rim-2': 'detail' };
const FALLBACK_MOON_VIEW = 'crater';

// Artemis III candidate regions (same as frontend/regions.js): name and Moon centre.
export const REGIONS = {
  'cabeus-b-peak': { name: 'Peak near Cabeus B', lat: -83.6, lon: -68.6 },
  'haworth': { name: 'Haworth', lat: -86.8, lon: -22.6 },
  'malapert-massif': { name: 'Malapert Massif', lat: -86.0, lon: 0.0 },
  'mons-mouton-plateau': { name: 'Mons Mouton Plateau', lat: -84.3, lon: 30.5 },
  'mons-mouton': { name: 'Mons Mouton', lat: -85.4, lon: 31.7 },
  'nobile-rim-1': { name: 'Nobile Rim 1', lat: -85.4, lon: 37.3 },
  'nobile-rim-2': { name: 'Nobile Rim 2', lat: -84.0, lon: 58.8 },
  'de-gerlache-rim-2': { name: 'de Gerlache Rim 2', lat: -88.2, lon: -64.4 },
  'slater-plain': { name: 'Slater Plain', lat: -87.2, lon: 125.4 },
};
export const REGION_NAMES = Object.fromEntries(Object.entries(REGIONS).map(([id, r]) => [id, r.name]));

// Measured terrain of each Moon region (LOLA, 20 km window) for the telemetry while on Earth.
export async function loadMoonRegionStats() {
  for (const url of [`${API_BASE}/regions`, new URL('../../backend/data/moon_regions.json', import.meta.url)]) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const json = await response.json();
      return json.regions ?? json;
    } catch { /* try the next source */ }
  }
  return null;
}

// Backend that builds a 30 m tile for any Earth match (see backend/rover_tiles.py).
export const API_BASE = 'http://localhost:8000';

// Earth spot chosen in the atlas ("Enter rover"): ?lat=&lon=&name=&country=&match=
export function earthSiteFromUrl(params) {
  if (!params.has('lat') || !params.has('lon')) return null;
  const lat = Number(params.get('lat')), lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, name: params.get('name') || 'Earth match', country: params.get('country') || '',
    match: Number(params.get('match')) || null };
}

// "← Field Atlas" goes back to the atlas with this region's matches open.
export function atlasBackHref(href, region) {
  const url = new URL(href, location.href);
  // START serves the atlas on :5173 (frontend/) and the rover on :5175 (repo root).
  if (location.port === '5175' && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    url.port = '5173';
    url.pathname = '/';
  }
  url.search = new URLSearchParams({ region });
  return url.href;
}

export async function loadEarthMetadata(version) {
  try {
    const response = await fetch(`./assets/earth/earth-metadata.json?v=${version}`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function moonViewForRegion(region) {
  return MOON_VIEW_FOR_REGION[region] ?? FALLBACK_MOON_VIEW;
}

export function hasOwnMoonTile(region) {
  return region in MOON_VIEW_FOR_REGION;
}

export function earthDescriptor(md, region, chosen = null) {
  const entry = md.regions[region] ?? Object.values(md.regions)[0];
  const site = md.sites[entry.site];
  const top = { ...site, file: `earth/${site.file}`, body: 'earth', region, match: entry.match };
  if (!chosen) return top;
  return {
    ...top, file: null, near: null, demSource: null,
    url: `${API_BASE}/rover-tile?lat=${chosen.lat}&lon=${chosen.lon}`,
    centerLatitude: chosen.lat, centerLongitude: chosen.lon,
    name: chosen.name, country: chosen.country, match: chosen.match ?? entry.match,
    fallback: { ...top, fallbackNote: true },   // backend offline → region's pre-made tile
  };
}

// Desert palette, low → high: dark valley soil, ochre, sand, pale rock, salt/snow-white tops.
const earthStops = [
  [0.00, new THREE.Color('#5e4630')],
  [0.22, new THREE.Color('#8c6a47')],
  [0.45, new THREE.Color('#b48f66')],
  [0.68, new THREE.Color('#cdb08a')],
  [0.86, new THREE.Color('#ddd0bb')],
  [1.00, new THREE.Color('#f3efe6')],
];
function earthColor(t) {
  for (let i = 0; i < earthStops.length - 1; i++) {
    const [a, ca] = earthStops[i];
    const [b, cb] = earthStops[i + 1];
    if (t <= b) return ca.clone().lerp(cb, THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));
  }
  return earthStops.at(-1)[1].clone();
}
export const earthColorLut = Array.from({ length: 256 }, (_, i) => earthColor(i / 255));

// Sky, fog, light colours and the few labels that say "Moon"/"LOLA". Moon values are captured once
// so switching back restores exactly what terrain.js set up.
let moonLook = null;
export function applyWorld(scene, body) {
  const hemi = scene.children.find(o => o.isHemisphereLight);
  const label = document.querySelector('.walk-title b');
  const mark = document.querySelector('.top-mark');
  const coverage = document.getElementById('coverage-note');
  const intro = document.querySelector('.intro');
  moonLook ??= {
    background: scene.background.clone(),
    sky: hemi?.color.clone(), ground: hemi?.groundColor.clone(), intensity: hemi?.intensity,
    label: label?.textContent, mark: mark?.innerHTML, coverage: coverage?.textContent,
    intro: intro?.innerHTML,
  };
  if (intro) intro.innerHTML = body === 'earth'
    ? '<div class="eyebrow">EARTH ANALOG · TERRAIN STUDY</div><h1>Drive the<br><em>Moon on Earth.</em></h1>' +
      '<p>NASA SRTM elevation for the Earth site whose terrain best matches the chosen Artemis region. Same rover, Earth gravity.</p>'
    : moonLook.intro;
  const earth = body === 'earth';
  document.querySelector('.app-shell')?.classList.toggle('earth-mode', earth);
  scene.background = earth ? new THREE.Color('#9dbfe0') : moonLook.background.clone();
  // Light haze only far away: the overview camera sits ~30 km out, drive mode looks ~5 km ahead.
  scene.fog = earth ? new THREE.Fog('#b9d1e8', 30000, 140000) : null;
  if (hemi) {
    hemi.color.copy(earth ? new THREE.Color('#e3eef8') : moonLook.sky);
    hemi.groundColor.copy(earth ? new THREE.Color('#6d5843') : moonLook.ground);
    hemi.intensity = earth ? 1.6 : moonLook.intensity;
  }
  if (label) label.textContent = earth ? 'EARTH ROVER' : moonLook.label;
  if (mark) mark.innerHTML = earth
    ? '<span class="live-dot"></span> NASA SRTM <span class="top-divider">/</span> 30 M SOURCE'
    : moonLook.mark;
  if (coverage) coverage.textContent = earth ? 'EARTH ANALOG · NASA SRTMGL1 · GRAVITY 9.81 M/S²' : moonLook.coverage;
}

export function earthReadout($, view, descriptor) {
  const fmt = (v, ns, ew) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? ns[0] : ns[1]}`;
  $('site-name').textContent = descriptor.name;
  $('site-coords').textContent = `${descriptor.country ?? ''} · ${fmt(descriptor.centerLatitude, 'NS')} · ${fmt(descriptor.centerLongitude, 'EW')}`;
  $('site-tag').textContent = descriptor.fallbackNote ? 'TOP MATCH (OFFLINE)' : 'EARTH ANALOG';
  $('view-note').textContent = `EARTH ANALOG OF ${REGION_NAMES[descriptor.region]?.toUpperCase() ?? ''} · ` +
    `${Math.round(descriptor.match)}% MATCH · ${(descriptor.width * view.spacing / 1000).toFixed(2)} KM WINDOW · NASA SRTM 30 M`;
  $('walk-button').innerHTML = '<span class="walk-button-mark" aria-hidden="true">↗</span> Drive on Earth';
  document.querySelector('.walk-caption').textContent = 'Earth rover · same rover, Earth gravity (9.81 m/s²)';
}

// Adds: an "Earth analog" view button + region picker to the control panel, and a Moon/Earth
// switch to the drive HUD. Returns a function that refreshes the switch label.
export function mountEarthControls(md, { region, onShowEarth, onRegion, onToggle }) {
  const switchGroup = document.querySelector('.view-switch');
  const earthButton = document.createElement('button');
  earthButton.className = 'view-button';
  earthButton.dataset.view = 'earth';
  earthButton.setAttribute('aria-pressed', 'false');
  earthButton.textContent = 'Earth analog';
  earthButton.addEventListener('click', onShowEarth);
  switchGroup.append(earthButton);

  const picker = document.createElement('label');
  picker.className = 'earth-picker';
  picker.innerHTML = '<span>Artemis region</span><select id="earth-region"></select>';
  const select = picker.querySelector('select');
  for (const [id, entry] of Object.entries(md.regions)) {
    const site = md.sites[entry.site];
    select.add(new Option(`${REGION_NAMES[id] ?? id} → ${site.name} (${Math.round(entry.match)}%)`, id));
  }
  select.value = region in md.regions ? region : Object.keys(md.regions)[0];
  select.addEventListener('change', () => onRegion(select.value));
  switchGroup.after(picker);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'world-toggle';
  toggle.id = 'world-toggle';
  toggle.addEventListener('click', onToggle);
  document.querySelector('.walk-hud-head')?.insertBefore(toggle, document.getElementById('walk-exit'));

  const note = document.createElement('div');
  note.className = 'world-note';
  note.id = 'world-note';
  document.querySelector('.walk-hud')?.append(note);

  return function refresh({ earth, region: current, moonViewName, site = null }) {
    toggle.innerHTML = earth ? 'Switch to Moon <kbd>T</kbd>' : 'Switch to Earth <kbd>T</kbd>';
    const entry = md.regions[current];
    const shown = site ?? { name: md.sites[entry.site].name, match: entry.match };
    note.textContent = earth
      ? `Earth analog of ${REGION_NAMES[current] ?? current}: ${shown.name}` +
        (shown.match ? ` (${Math.round(shown.match)}% terrain match)` : '')
      : hasOwnMoonTile(current)
        ? `Moon: ${REGION_NAMES[current]}`
        : `Moon: ${moonViewName} (no rover tile for ${REGION_NAMES[current] ?? current} yet)`;
  };
}

// "Hide UI" (bottom right, drive view only): hides HUD, telemetry and labels for a clean view. Key: H.
export function mountHideUi() {
  const shell = document.querySelector('.app-shell');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hide-ui-button';
  const sync = () => {
    const hidden = shell.classList.contains('ui-hidden');
    button.innerHTML = hidden ? 'Show UI <kbd>H</kbd>' : 'Hide UI <kbd>H</kbd>';
    button.setAttribute('aria-pressed', String(hidden));
  };
  const toggle = () => { shell.classList.toggle('ui-hidden'); sync(); };
  button.addEventListener('click', toggle);
  addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'h' || event.repeat) return;
    if (!shell.classList.contains('walk-mode')) return;
    if (event.target?.closest?.('input, select, textarea, dialog')) return;
    toggle();
  });
  shell.append(button);
  sync();
}
