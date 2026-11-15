// Earth analog mode for the rover simulator.
//
// Earth tiles (assets/earth/*.bin) use the same int16 grid layout as the LOLA tiles, but carry their
// own pixelSizeM / heightScaleM, so terrain.js can render and drive them with the same code.
// Built by lunar-rover-simulation/data_prep/prepare_earth_tiles.py from NASA SRTMGL1 (30 m).
import * as THREE from 'three';

export const MOON_GRAVITY = 1.62;

// ISO 3166 two-letter code → flag emoji (e.g. "CL" → 🇨🇱). Empty if unknown.
export function flagEmoji(cc) {
  return /^[A-Za-z]{2}$/.test(cc ?? '')
    ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
}

// Artemis candidate regions (same as frontend/regions.js): name and Moon centre.
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
    cc: params.get('cc') || '', match: Number(params.get('match')) || null };
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
  return region in REGIONS ? 'moon-site' : 'crater';
}

export function hasOwnMoonTile(region) {
  return region in REGIONS;
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
    name: chosen.name, country: chosen.country, cc: chosen.cc, match: chosen.match ?? entry.match,
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

const mixColor = (a, b, amount) => new THREE.Color(a).lerp(new THREE.Color(b), amount);
const smoothstep = (min, max, value) => {
  const t = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
};

export function updateEarthLighting(scene, elevation, { hemi, keyLight, fillLight }) {
  const day = smoothstep(-6, 8, elevation);
  const twilight = smoothstep(-18, 0, elevation);
  const sky = mixColor('#14243a', '#43536c', twilight).lerp(new THREE.Color('#9dbfe0'), day);
  const horizon = mixColor('#202a38', '#d17f5e', twilight).lerp(new THREE.Color('#b9d1e8'), day);
  scene.background.copy(sky);
  if (scene.fog) scene.fog.color.copy(horizon);
  if (hemi) {
    hemi.color.copy(sky);
    hemi.groundColor.copy(mixColor('#29384a', '#6d5843', day));
    hemi.intensity = 0.75 + 0.70 * day + 0.18 * twilight;
  }
  if (keyLight) {
    keyLight.intensity = 4.0 * smoothstep(-4, 6, elevation);
    keyLight.color.copy(mixColor('#d9e4f1', '#fff0d7', day));
  }
  if (fillLight) fillLight.intensity = 0.18 + 0.16 * day + 0.04 * twilight;
}

// Sky, fog, light colours and the few labels that say "Moon"/"LOLA". Moon values are captured once
// so switching back restores exactly what terrain.js set up.
let moonLook = null;
export function applyWorld(scene, body, { keyLight, fillLight } = {}) {
  const hemi = scene.children.find(o => o.isHemisphereLight);
  const label = document.querySelector('.walk-title b');
  const mark = document.querySelector('.top-mark');
  const coverage = document.getElementById('coverage-note');
  const intro = document.querySelector('.intro');
  moonLook ??= {
    background: scene.background,
    sky: hemi?.color.clone(), ground: hemi?.groundColor.clone(), intensity: hemi?.intensity,
    label: label?.textContent, mark: mark?.innerHTML, coverage: coverage?.textContent,
    intro: intro?.innerHTML, keyIntensity: keyLight?.intensity,
    keyColor: keyLight?.color.clone(), fillIntensity: fillLight?.intensity,
  };
  if (intro) intro.innerHTML = body === 'earth'
    ? '<div class="eyebrow">EARTH ANALOG · TERRAIN STUDY</div><h1>Drive the<br><em>Moon on Earth.</em></h1>' +
      '<p>NASA SRTM elevation for the Earth site whose terrain best matches the chosen Artemis region. Same rover, Earth gravity.</p>'
    : moonLook.intro;
  const earth = body === 'earth';
  document.querySelector('.app-shell')?.classList.toggle('earth-mode', earth);
  scene.background = earth ? new THREE.Color('#9dbfe0') : moonLook.background;
  // Light haze only far away: the overview camera sits ~30 km out, drive mode looks ~5 km ahead.
  scene.fog = earth ? new THREE.Fog('#b9d1e8', 30000, 140000) : null;
  if (hemi) {
    hemi.color.copy(earth ? new THREE.Color('#e3eef8') : moonLook.sky);
    hemi.groundColor.copy(earth ? new THREE.Color('#6d5843') : moonLook.ground);
    hemi.intensity = earth ? 1.6 : moonLook.intensity;
  }
  if (keyLight) {
    keyLight.intensity = earth ? 4.0 : moonLook.keyIntensity;
    if (moonLook.keyColor) keyLight.color.copy(earth ? new THREE.Color('#fff0d7') : moonLook.keyColor);
  }
  if (fillLight) fillLight.intensity = earth ? 0.34 : moonLook.fillIntensity;
  if (label) label.textContent = earth ? 'EARTH ROVER' : moonLook.label;
  if (mark) mark.innerHTML = earth
    ? '<span class="live-dot"></span> NASA SRTM <span class="top-divider">/</span> 30 M SOURCE'
    : moonLook.mark;
  if (coverage) coverage.textContent = earth ? 'EARTH ANALOG · NASA SRTMGL1 · GRAVITY 9.81 M/S²' : moonLook.coverage;
  document.querySelectorAll('.height-ref').forEach(el => {
    el.textContent = earth ? 'above sea level' : 'vs. Moon reference radius (1,737.4 km)';
  });
}

export function earthReadout($, view, descriptor) {
  const fmt = (v, ns, ew) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? ns[0] : ns[1]}`;
  $('site-name').textContent = `${flagEmoji(descriptor.cc)} ${descriptor.name}`.trim();
  $('site-coords').textContent = `${descriptor.country ?? ''} · ${fmt(descriptor.centerLatitude, 'NS')} · ${fmt(descriptor.centerLongitude, 'EW')}`;
  $('site-tag').textContent = descriptor.fallbackNote ? 'TOP MATCH (OFFLINE)' : 'EARTH ANALOG';
  $('view-note').textContent = `EARTH ANALOG OF ${REGION_NAMES[descriptor.region]?.toUpperCase() ?? ''} · ` +
    `${Math.round(descriptor.match)}% MATCH · ${(descriptor.width * view.spacing / 1000).toFixed(2)} KM WINDOW · NASA SRTM 30 M`;
  $('walk-button').innerHTML = '<span class="walk-button-mark" aria-hidden="true">↗</span> Drive on Earth';
  document.querySelector('.walk-caption').textContent = 'Earth rover · same rover, Earth gravity (9.81 m/s²)';
}

// Simpler panel: region picker → big "Moon | Earth" switch → small "whole south pole" link.
// The original view buttons stay in the page (hidden) so terrain.js keeps working unchanged.
// Also: the "where are we" badge (flag + place) and the Moon/Earth switch in the drive HUD.
export function mountEarthControls(md, { onShowEarth, onShowMoon, onToggle }) {
  const panel = document.querySelector('.control-panel');
  const top = document.createElement('div');
  top.className = 'world-controls';
  top.innerHTML = `
    <div class="world-switch" role="group" aria-label="Moon or Earth">
      <button type="button" data-world="moon">🌑 Moon</button>
      <button type="button" data-world="earth">🌍 Earth analog</button>
    </div>
    <button type="button" class="overview-link">See the whole lunar south pole →</button>`;
  panel.prepend(top);

  let earthNow = false;
  top.querySelectorAll('.world-switch button').forEach(button => button.addEventListener('click', () => {
    const wantEarth = button.dataset.world === 'earth';
    if (wantEarth !== earthNow) onToggle();          // keeps the rover's spot when driving
    else if (wantEarth) onShowEarth();
    else onShowMoon();                                // e.g. from the whole-pole overview
  }));
  top.querySelector('.overview-link').addEventListener('click',
    () => document.querySelector('.view-button[data-view="overview"]')?.click());

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

  const badge = document.getElementById('where-badge');

  return function refresh({ earth, region: current, moonViewName, site = null, view = null }) {
    earthNow = earth;
    top.querySelectorAll('.world-switch button').forEach(b =>
      b.classList.toggle('active', (b.dataset.world === 'earth') === earth && view !== 'overview'));
    toggle.innerHTML = earth ? '🌑 Switch to Moon <kbd>T</kbd>' : '🌍 Switch to Earth <kbd>T</kbd>';
    const entry = md.regions[current];
    const top_ = md.sites[entry.site];
    const shown = site ?? { name: top_.name, country: top_.country, cc: top_.cc, match: entry.match };
    const regionName = REGION_NAMES[current] ?? current;
    let line1, line2;
    if (earth) {
      line1 = `${flagEmoji(shown.cc)} ${shown.name}`.trim();
      line2 = `${shown.country ? shown.country + ' · ' : ''}Earth analog of ${regionName}` +
        (shown.match ? ` · ${Math.round(shown.match)}% terrain match` : '');
    } else if (view === 'overview') {
      line1 = '🌑 Lunar south pole';
      line2 = 'Whole-cap overview · NASA LRO LOLA';
    } else if (hasOwnMoonTile(current)) {
      line1 = `🌑 ${regionName}`;
      line2 = 'Moon · Artemis candidate landing region · NASA LRO LOLA';
    } else {
      line1 = `🌑 ${moonViewName[0].toUpperCase()}${moonViewName.slice(1)}`;
      line2 = `Moon · stand-in view (no rover tile for ${regionName} yet)`;
    }
    badge.hidden = false;
    badge.innerHTML = `<strong>${line1}</strong><span>${line2}</span>`;
    note.textContent = `${line1} · ${line2}`;
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
