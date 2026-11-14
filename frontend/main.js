import { REGIONS, CONSTRAINTS, MOON_RADIUS_KM } from './regions.js';
import { sampleMoon, SAMPLE_EARTH } from './sample.js';

const API_BASE = 'http://localhost:8000'; // FastAPI backend (build step 4)
const TEX = 'https://unpkg.com/globe.gl@2.46.2/example/moon-landing-sites/';
const HOME_VIEW = { lat: -86.5, lng: 20, altitude: 0.3 };
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const C = Object.fromEntries(CONSTRAINTS.map(c => [c.key, c]));
const $ = id => document.getElementById(id);

// ---------- Region boxes: axis-aligned in a south-polar map (0° lon up), like NASA's map ----------
const DEG = Math.PI / 180;
function toPolar(lat, lon) {
  const rho = MOON_RADIUS_KM * (90 + lat) * DEG;
  return [rho * Math.sin(lon * DEG), rho * Math.cos(lon * DEG)];
}
function fromPolar(x, y) {
  const rho = Math.hypot(x, y);
  return [Math.atan2(x, y) / DEG, -90 + rho / MOON_RADIUS_KM / DEG]; // [lon, lat]
}
function boxPolygon(r) {
  const [cx, cy] = toPolar(r.lat, r.lon);
  const [hw, hh] = [r.boxKm[0] / 2, r.boxKm[1] / 2];
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const ring = [];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    for (let t = 0; t < 8; t++) {
      const f = t / 8;
      ring.push(fromPolar(cx + a[0] + (b[0] - a[0]) * f, cy + a[1] + (b[1] - a[1]) * f));
    }
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring.reverse()] };
}
const boxes = REGIONS.map(r => ({ region: r, geometry: boxPolygon(r) }));

// ---------- Globe ----------
let selected = null;
const globe = new Globe($('globe'))
  .globeImageUrl(TEX + 'lunar_surface.jpg')
  .bumpImageUrl(TEX + 'lunar_bumpmap.jpg')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.41.0/example/img/night-sky.png')
  .showGraticules(true)
  .showAtmosphere(false)
  .polygonsData(boxes)
  .polygonGeoJsonGeometry('geometry')
  .polygonAltitude(d => (d.region === selected ? 0.004 : 0.002))
  .polygonCapColor(d => (d.region === selected ? 'rgba(255,181,71,0.55)' : 'rgba(255,181,71,0.22)'))
  .polygonSideColor(() => 'rgba(255,181,71,0.3)')
  .polygonStrokeColor(() => '#ffb547')
  .polygonLabel(d => d.region.name)
  .onPolygonClick(d => select(d.region))
  .htmlElementsData(REGIONS)
  .htmlLat('lat').htmlLng('lon').htmlAltitude(0.006)
  .htmlElement(r => {
    const el = document.createElement('button');
    el.className = 'pin' + (r.labelSide === 'left' ? ' left' : '');
    el.dataset.id = r.id;
    el.innerHTML = `<span class="dot"></span><span class="txt">${r.name}</span>`;
    el.onclick = () => select(r);
    return el;
  })
  .pointOfView(HOME_VIEW, 0);

globe.controls().minDistance = 101;
window.addEventListener('resize', () => globe.width(innerWidth).height(innerHeight));

function refreshHighlight() {
  globe.polygonsData(boxes);
  document.querySelectorAll('.pin').forEach(el => el.classList.toggle('active', el.dataset.id === selected?.id));
}

// ---------- Panel 1: ranked constraints ----------
let priorities = []; // constraint keys, most important first

function renderOptions() {
  const groups = [...new Set(CONSTRAINTS.map(c => c.group))];
  $('options').innerHTML = groups.map(g => `
    <div class="group"><span class="group-name">${g}</span>
      ${CONSTRAINTS.filter(c => c.group === g).map(c => `
        <label class="opt ${c.pending ? 'pending' : ''}">
          <input type="checkbox" value="${c.key}" ${priorities.includes(c.key) ? 'checked' : ''} ${c.pending ? 'disabled' : ''}>
          <span><b>${c.label}</b><small>${c.hint}</small></span>
          ${c.pending ? '<em>soon</em>' : ''}
        </label>`).join('')}
    </div>`).join('');
  $('options').querySelectorAll('input').forEach(cb => cb.onchange = () => {
    priorities = cb.checked ? [...priorities, cb.value] : priorities.filter(k => k !== cb.value);
    renderChips();
  });
}

function renderChips() {
  $('chips').innerHTML = priorities.map((k, i) => `
    <li class="chip"><span class="rank">${i + 1}</span><span class="chip-txt">${C[k].label}</span>
      <span class="w">${Math.round(weights()[k] * 100)}%</span>
      <button class="icon" data-k="${k}" aria-label="Remove ${C[k].label}">×</button></li>`).join('');
  $('chips').querySelectorAll('button').forEach(b => b.onclick = () => {
    priorities = priorities.filter(k => k !== b.dataset.k);
    renderOptions(); renderChips();
  });
  $('chosen-label').hidden = priorities.length === 0;
  $('go').disabled = priorities.length === 0;
}

// Rank → weight: 1st gets n, 2nd n-1, … normalized to sum 1. No sliders to guess.
function weights() {
  const n = priorities.length;
  const total = (n * (n + 1)) / 2;
  return Object.fromEntries(priorities.map((k, i) => [k, (n - i) / total]));
}

function select(r) {
  selected = r;
  refreshHighlight();
  globe.pointOfView({ lat: r.lat, lng: r.lon, altitude: 0.12 }, 900);
  $('pick').hidden = false;
  $('out').hidden = true;
  $('r-name').textContent = r.name;
  $('r-meta').textContent = `${r.lat.toFixed(1)}°, ${r.lon.toFixed(1)}° · box ~${r.boxKm[0]}${r.boxKm[1] !== r.boxKm[0] ? ' × ' + r.boxKm[1] : ''} km`;
  renderOptions(); renderChips();
}

document.querySelector('[data-close]').onclick = () => {
  selected = null;
  $('pick').hidden = true;
  $('out').hidden = true;
  refreshHighlight();
  globe.pointOfView(HOME_VIEW, 900);
};
$('out-close').onclick = () => { $('out').hidden = true; };

// ---------- Matching ----------
let lastResult = null;

$('go').onclick = async () => {
  if (!selected || !priorities.length) return;
  $('out').hidden = false;
  showList();
  $('status').textContent = 'Searching…';
  $('results').innerHTML = '';
  try {
    const qs = new URLSearchParams({ region: selected.id, constraints: priorities.join(','), n: 5,
      include_snow: $('snow').checked });
    const res = await fetch(`${API_BASE}/match?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lastResult = await res.json();
    lastResult.sample ??= false;
    lastResult.source = 'backend';
  } catch {
    lastResult = sampleMatch(selected.id, weights(), 5);
  }
  renderResults();
};

// Client-side version of the scoring, used with placeholder data only.
// Same response shape the backend should return (see CLAUDE.md "API contract").
function sampleMatch(regionId, w, n) {
  const moon = sampleMoon(regionId);
  const matches = SAMPLE_EARTH.map(e => {
    const features = {};
    let match = 0;
    for (const k of Object.keys(moon)) {
      const score = Math.max(0, 100 * (1 - Math.abs(e[k] - moon[k]) / C[k].scale));
      features[k] = { moon: moon[k], earth: e[k], score };
      match += (w[k] ?? 0) * score;
    }
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
  if (!r.matches.length) $('status').textContent = 'No bare-ground patches match. Try fewer priorities or include snow/ice.';
  $('results').innerHTML = r.matches.map((m, i) => `
    <li><button class="result" data-i="${i}">
      <span class="num">${i + 1}</span>
      <img src="${thumbUrl(m.lat, m.lon)}" alt="Satellite view of ${m.name}" loading="lazy">
      <span class="r-txt"><b>${m.name}</b><small>${m.country ?? ''}</small>
        <span class="pct">${Math.round(m.match)}%<small> match</small></span></span>
    </button></li>`).join('');
  $('results').querySelectorAll('.result').forEach(b => b.onclick = () => showDetail(r.matches[+b.dataset.i]));
}

// ---------- Panel 2b: one Earth location ----------
let map = null;

function showList() { $('list-view').hidden = false; $('detail-view').hidden = true; }
$('back').onclick = showList;

function fmt(k, v) { return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${C[k].unit}`; }

function missionFit(f) {
  const p90 = f.p90Slope.earth, rough = f.roughness.earth, relief = f.relief.earth;
  if (p90 < 15 && rough < 120) return ['Landing practice', 'Gentle slopes and smooth ground, like a lander touchdown zone.'];
  if (relief > 1200 || p90 > 25) return ['Crater-rim / massif operations', 'Big height range and steep sections, like working along a crater rim.'];
  return ['Rover traversal', 'Moderate slopes and roughness, good for driving and EVA route practice.'];
}

function showDetail(m) {
  $('list-view').hidden = true;
  $('detail-view').hidden = false;
  $('d-name').textContent = m.name;
  $('d-meta').textContent = `${m.country ? m.country + ' · ' : ''}${m.lat.toFixed(2)}°, ${m.lon.toFixed(2)}° · 20 × 20 km patch`;
  $('d-score').innerHTML = `<span class="big">${Math.round(m.match)}%</span> match to ${selected.name}` +
    (lastResult.sample ? ' <span class="tag">Sample data</span>' : '');

  const [mission, why] = missionFit(m.features);
  $('d-mission').innerHTML = `<b>${mission}</b> — ${why}`;

  const keys = Object.keys(m.features);
  $('d-table').innerHTML = `<tr><th></th><th>Moon</th><th>Earth</th><th>Fit</th></tr>` + keys.map(k => {
    const f = m.features[k];
    const cls = f.score >= 75 ? 'good' : f.score >= 45 ? 'ok' : 'bad';
    const pri = priorities.indexOf(k);
    return `<tr class="${pri >= 0 ? 'pri' : ''}"><td>${C[k].label}${pri >= 0 ? ` <span class="rank sm">${pri + 1}</span>` : ''}</td>
      <td>${fmt(k, f.moon)}</td><td>${fmt(k, f.earth)}</td>
      <td><span class="bar ${cls}"><i style="width:${f.score}%"></i></span></td></tr>`;
  }).join('');

  const pros = [], cons = [];
  for (const k of keys) {
    const f = m.features[k], diff = f.earth - f.moon;
    if (f.score >= 75) pros.push(`${C[k].label} is close to the Moon site (${fmt(k, f.earth)} vs ${fmt(k, f.moon)}).`);
    else if (f.score < 45) cons.push(`${C[k].label}: ${diff > 0 ? 'more' : 'less'} than the Moon site (${fmt(k, f.earth)} vs ${fmt(k, f.moon)}).`);
    else if (priorities.includes(k)) cons.push(`${C[k].label} is only a partial match (${fmt(k, f.earth)} vs ${fmt(k, f.moon)}).`);
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
