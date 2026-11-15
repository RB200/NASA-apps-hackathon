import { REGIONS, CONSTRAINTS, MOON_RADIUS_KM } from './regions.js';
import { sampleMoon, SAMPLE_EARTH } from './sample.js';

const API_BASE = 'http://localhost:8000'; // FastAPI backend (build step 4)
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const C = Object.fromEntries(CONSTRAINTS.map(c => [c.key, c]));
const $ = id => document.getElementById(id);
// ISO two-letter country code → flag emoji (🇨🇱). Empty if unknown.
const flag = cc => /^[A-Za-z]{2}$/.test(cc ?? '')
  ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';

const roverPage = new URL('../lunar-rover-simulation/frontend/terrain.html', import.meta.url);
if (location.port === '5173' && /^\/(?:index\.html)?$/.test(location.pathname)
    && ['localhost', '127.0.0.1'].includes(location.hostname)) roverPage.port = '5175';

// ---------- 2D south-pole map ----------
// The resized South_Pole.png is registered against the previous 608 km LOLA polar map.
// The fit includes a small rotation and uses Leaflet's upward-positive image y axis.
const MAP_WIDTH = 4800, MAP_HEIGHT = 1620;
const POLE_X = 2399.199, POLE_Y = 810.571, PX_PER_KM = 1.583685, ROTATION_PX_PER_KM = 0.001132;
const DEG = Math.PI / 180;
function polarKm(lat, lon) { // km east / north of the pole, LOLA polar stereographic
  const rho = 2 * MOON_RADIUS_KM * Math.tan((90 + lat) / 2 * DEG);
  return [rho * Math.sin(lon * DEG), rho * Math.cos(lon * DEG)];
}
// Leaflet's simple CRS: [y up from the image bottom, x right], in image pixels.
const toLatLng = (xKm, yKm) => L.latLng(
  POLE_Y + yKm * PX_PER_KM + xKm * ROTATION_PX_PER_KM,
  POLE_X + xKm * PX_PER_KM - yKm * ROTATION_PX_PER_KM
);

const FULL = L.latLngBounds([0, 0], [MAP_HEIGHT, MAP_WIDTH]);
const moonMap = L.map('globe', { crs: L.CRS.Simple, maxZoom: 3.75, zoomSnap: 0.25,
  attributionControl: false, zoomControl: false, maxBounds: FULL, maxBoundsViscosity: 1 });
function updateMapZoomLimit() {
  const size = moonMap.getSize();
  const zoom = Math.ceil(Math.log2(Math.max(size.x / MAP_WIDTH, size.y / MAP_HEIGHT)) / moonMap.options.zoomSnap)
    * moonMap.options.zoomSnap;
  moonMap.setMaxZoom(Math.max(3.75, zoom));
  moonMap.setMinZoom(zoom);
}
updateMapZoomLimit();
moonMap.on('zoomend', () => {
  // Leaflet rounds image and pan positions separately; keep a two-screen-pixel inset.
  const inset = 2 / Math.pow(2, moonMap.getZoom());
  moonMap.setMaxBounds(L.latLngBounds([inset, inset], [MAP_HEIGHT - inset, MAP_WIDTH - inset]));
});
moonMap.on('resize', () => {
  updateMapZoomLimit();
  moonMap.panInsideBounds(moonMap.options.maxBounds, { animate: false });
});
L.control.zoom({ position: 'bottomleft' }).addTo(moonMap);
L.imageOverlay('assets/south-pole-map.webp', FULL).addTo(moonMap);

let selected = null;
const boxes = REGIONS.map(r => {
  const [cx, cy] = polarKm(r.lat, r.lon);
  const [hw, hh] = [r.boxKm[0] / 2, r.boxKm[1] / 2];
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => toLatLng(cx + dx, cy + dy));
  const polygon = L.polygon(corners, { color: '#ffb547', weight: 1.5, fillColor: '#ffb547', fillOpacity: 0.18 })
    .addTo(moonMap).on('click', () => select(r));
  const pin = L.marker(toLatLng(cx, cy), {
    icon: L.divIcon({ className: 'pin-icon', iconSize: [10, 10], iconAnchor: [5, 5],
      html: `<button class="pin${r.labelSide ? ' ' + r.labelSide : ''}" data-id="${r.id}"><span class="dot"></span><span class="txt">${r.name}</span></button>` }),
    keyboard: false,
  }).addTo(moonMap).on('click', () => select(r));
  return { region: r, polygon, pin, bounds: polygon.getBounds() };
});
const HOME_BOUNDS = boxes.reduce((b, x) => b.extend(x.bounds), L.latLngBounds(boxes[0].bounds.getSouthWest(), boxes[0].bounds.getNorthEast())).pad(0.35);
moonMap.fitBounds(HOME_BOUNDS);
const goHome = () => moonMap.flyToBounds(HOME_BOUNDS, { duration: 0.8 });

function refreshHighlight() {
  for (const b of boxes) {
    const on = b.region === selected;
    b.polygon.setStyle({ weight: on ? 2.5 : 1.5, fillOpacity: on ? 0.38 : 0.18 });
    if (on) b.polygon.bringToFront();
  }
  document.querySelectorAll('.pin').forEach(el => el.classList.toggle('active', el.dataset.id === selected?.id));
}

// ---------- Priorities ----------
// Matches rank on every terrain feature that has data on both Moon and Earth, in this order
// (1st gets the most weight). There is no settings UI: the team kept the app simple.
const DEFAULT_ORDER = ['p90Slope', 'roughness', 'relief', 'meanSlope', 'shape'];

// Which features have data on both Moon and Earth: the backend says so; without it, the sample set.
let available = new Set(['meanSlope', 'p90Slope', 'roughness', 'relief']);
const priorities = () => DEFAULT_ORDER.filter(k => available.has(k));
fetch(`${API_BASE}/health`).then(r => r.json()).then(h => {
  if (h.features) available = new Set(h.features);
  if (selected) search(); // re-rank once Shape is known to be available
}).catch(() => {});

// Rank → weight: 1st gets n, 2nd n-1, … normalized to sum 1.
function weights() {
  const keys = priorities();
  const n = keys.length;
  const total = (n * (n + 1)) / 2;
  return Object.fromEntries(keys.map((k, i) => [k, (n - i) / total]));
}

function select(r) {
  selected = r;
  refreshHighlight();
  const box = boxes.find(b => b.region === r);
  moonMap.flyToBounds(box.bounds.pad(1.2), { paddingBottomRight: [420, 0], maxZoom: 1.5, duration: 0.8 });
  $('demo').hidden = true;
  $('out').hidden = false;
  $('r-name').textContent = r.name;
  $('r-meta').textContent = `Moon · ${r.lat.toFixed(1)}°, ${r.lon.toFixed(1)}° · box ~${r.boxKm[0]}${r.boxKm[1] !== r.boxKm[0] ? ' × ' + r.boxKm[1] : ''} km`;
  search();
}

document.querySelector('[data-close]').onclick = () => {
  selected = null;
  $('demo').hidden = false;
  $('out').hidden = true;
  refreshHighlight();
  goHome();
};

// ---------- Matching ----------
let lastResult = null;

async function search() {
  if (!selected) return;
  $('out').hidden = false;
  showList();
  $('status').textContent = 'Searching…';
  $('results').innerHTML = '';
  try {
    const qs = new URLSearchParams({ region: selected.id, constraints: priorities().join(','), n: 5 });
    const res = await fetch(`${API_BASE}/match?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lastResult = await res.json();
    lastResult.sample ??= false;
    lastResult.source = 'backend';
  } catch {
    lastResult = sampleMatch(selected.id, weights(), 5);
  }
  renderResults();
}

// One-click demo (team): open de Gerlache Rim 2's best Earth matches.
function startDemo() {
  select(REGIONS.find(region => region.id === 'de-gerlache-rim-2'));
}
$('demo').onclick = startDemo;
if (new URLSearchParams(location.search).get('demo') === 'de-gerlache') startDemo();

// Client-side version of the scoring, used with placeholder data only.
// Same response shape the backend should return (see CLAUDE.md "API contract").
function sampleMatch(regionId, w, n) {
  const moon = sampleMoon(regionId);
  const matches = SAMPLE_EARTH.map(e => {
    const features = {};
    let logSum = 0, wSum = 0;
    for (const k of Object.keys(moon)) {
      const score = Math.max(0, 100 * (1 - Math.abs(e[k] - moon[k]) / C[k].scale));
      features[k] = { moon: moon[k], earth: e[k], score };
      if (w[k]) { logSum += w[k] * Math.log(Math.max(score, 1)); wSum += w[k]; }
    }
    // Weighted geometric mean, same rule as the backend: one far-off feature drags the match down.
    const match = wSum ? Math.exp(logSum / wSum) : 0;
    return { id: e.id, name: e.name, country: e.country, lat: e.lat, lon: e.lon, match, features };
  }).sort((a, b) => b.match - a.match).slice(0, n);
  return { region: regionId, constraints: Object.keys(w), matches, sample: true };
}

// ---------- Panel 2: results list ----------
function thumbUrl(lat, lon, km = 20, px = 160) {
  const dLat = km / 2 / 111.32, dLon = dLat / Math.cos(lat * DEG);
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(',');
  return `${ESRI}/export?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${px},${px}&format=jpg&f=image`;
}

function renderResults() {
  const r = lastResult;
  for (const m of r.matches) m.name ??= `${m.lat.toFixed(2)}°, ${m.lon.toFixed(2)}°`;
  $('status').innerHTML = r.source !== 'backend'
    ? `<span class="tag">Sample data</span> Backend not running, showing placeholder numbers.`
    : r.sample
      ? `<span class="tag">Sample data</span> Placeholder ${(r.sampleParts ?? ['earth', 'moon']).map(p => p === 'earth' ? 'Earth' : 'Moon').join(' + ')} numbers.`
      : `${r.matches.length} best matches for ${selected.name}`;
  if (!r.matches.length) $('status').textContent = 'No bare-ground Earth terrain matches this region.';
  $('results').innerHTML = r.matches.map((m, i) => `
    <li><button class="result" data-i="${i}">
      <span class="num">${i + 1}</span>
      <img src="${thumbUrl(m.lat, m.lon)}" alt="Satellite view of ${m.name}" loading="lazy">
      <span class="r-txt"><b>${flag(m.cc)} ${m.name}</b><small>${m.country ?? ''}</small>
        <span class="pct">${Math.round(m.match)}%<small> match</small></span></span>
    </button></li>`).join('');
  $('results').querySelectorAll('.result').forEach(b => b.onclick = () => showDetail(r.matches[+b.dataset.i]));
}

// ---------- Panel 2b: one Earth location ----------
let map = null;

function showList() { $('list-view').hidden = false; $('detail-view').hidden = true; }
$('back').onclick = showList;

function fmt(k, v) {
  const d = C[k].digits ?? (v >= 100 ? 0 : 1);
  return `${v.toFixed(d)}${C[k].unit}`;
}

function missionFit(f) {
  const p90 = f.p90Slope?.earth, rough = f.roughness?.earth, relief = f.relief?.earth;
  if (![p90, rough, relief].every(Number.isFinite)) {
    return ['Unavailable', 'This match is missing measurements needed to assess mission fit.'];
  }
  if (p90 < 15 && rough < 120) return ['Landing practice', 'Gentle slopes and smooth ground, like a lander touchdown zone.'];
  if (relief > 1200 || p90 > 25) return ['Crater-rim / massif operations', 'Big height range and steep sections, like working along a crater rim.'];
  return ['Rover traversal', 'Moderate slopes and roughness, good for driving and EVA route practice.'];
}

function showDetail(m) {
  $('list-view').hidden = true;
  $('detail-view').hidden = false;
  $('d-name').textContent = `${flag(m.cc)} ${m.name}`.trim();
  $('d-meta').textContent = `${m.country ? m.country + ' · ' : ''}${m.near ? 'near ' + m.near + ' · ' : ''}${m.lat.toFixed(2)}°, ${m.lon.toFixed(2)}° · 20 × 20 km patch` +
    (m.demSource ? ` · elevation: ${m.demSource}` : '');
  $('d-score').innerHTML = `<span class="big">${Math.round(m.match)}%</span> match to ${selected.name}` +
    (lastResult.sample ? ' <span class="tag">Sample data</span>' : '');

  // Enter rover: drive this exact Earth spot, with the Moon region one keypress away.
  const sample = lastResult.source !== 'backend';
  $('d-rover').disabled = false;
  $('d-rover-note').textContent = sample
    ? 'sample match · preset Earth terrain offline'
    : 'drive this spot · toggle Moon ⇄ Earth';
  $('d-rover').onclick = () => { location.href = roverLinkFor(m); };

  const features = m.features ?? {};
  const [mission, why] = missionFit(features);
  $('d-mission').innerHTML = `<b>${mission}</b> — ${why}`;

  const keys = Object.keys(features).filter(k => C[k] &&
    [features[k]?.moon, features[k]?.earth, features[k]?.score].every(Number.isFinite));
  $('d-table').innerHTML = `<tr><th></th><th>Moon</th><th>Earth</th><th>Fit</th></tr>` + keys.map(k => {
    const f = features[k];
    const cls = f.score >= 75 ? 'good' : f.score >= 45 ? 'ok' : 'bad';
    return `<tr><td>${C[k].label}</td>
      <td>${fmt(k, f.moon)}</td><td>${fmt(k, f.earth)}</td>
      <td><span class="bar ${cls}"><i style="width:${f.score}%"></i></span></td></tr>`;
  }).join('');

  const pros = [], cons = [];
  for (const k of keys) {
    const f = features[k], diff = f.earth - f.moon;
    if (f.score >= 75) pros.push(`${C[k].label} is close to the Moon site (${fmt(k, f.earth)} vs ${fmt(k, f.moon)}).`);
    else if (f.score < 45) cons.push(`${C[k].label}: ${diff > 0 ? 'more' : 'less'} than the Moon site (${fmt(k, f.earth)} vs ${fmt(k, f.moon)}).`);
    else cons.push(`${C[k].label} is only a partial match (${fmt(k, f.earth)} vs ${fmt(k, f.moon)}).`);
  }
  cons.push('Earth-shaped terrain: erosion, not impacts. No lunar gravity, vacuum, or polar lighting.');
  $('d-pros').innerHTML = (pros.length ? pros : ['No feature is a close match.']).map(t => `<li>${t}</li>`).join('');
  $('d-cons').innerHTML = cons.map(t => `<li>${t}</li>`).join('');

  // Satellite view with the 20 km patch outlined
  const dLat = 10 / 111.32, dLon = dLat / Math.cos(m.lat * DEG);
  const bounds = [[m.lat - dLat, m.lon - dLon], [m.lat + dLat, m.lon + dLon]];
  if (!map) {
    map = L.map('d-map', { zoomControl: true, attributionControl: true });
    L.tileLayer(`${ESRI}/tile/{z}/{y}/{x}`, { maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
    map._box = L.rectangle(bounds, { color: '#ffb547', weight: 2, fill: false }).addTo(map);
  }
  map._box.setBounds(bounds);
  setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { padding: [10, 10] }); }, 0);
}

function roverLinkFor(m) {
  const url = new URL(roverPage);
  url.search = new URLSearchParams({
    region: selected.id, world: 'earth', drive: '1',
    lat: m.lat.toFixed(4), lon: m.lon.toFixed(4), name: m.name, country: m.country ?? '', cc: m.cc ?? '',
    match: Math.round(m.match),
  });
  return url.href;
}

// Coming back from the rover (…/index.html?region=…) reopens that region's matches.
const startRegion = REGIONS.find(r => r.id === new URLSearchParams(location.search).get('region'));
if (startRegion) select(startRegion);
