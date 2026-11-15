import { REGIONS, CONSTRAINTS, MOON_RADIUS_KM } from './regions.js';
import { sampleMoon, SAMPLE_EARTH } from './sample.js';
import { mountLunarSimulation } from './lunar-simulation.js';

const API_BASE = 'http://localhost:8000'; // FastAPI backend (build step 4)
const HOME_VIEW = { lat: -86.5, lng: 20, altitude: 0.3 };
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const C = Object.fromEntries(CONSTRAINTS.map(c => [c.key, c]));
const $ = id => document.getElementById(id);

const telemetryPanel = $('lunar-telemetry');
telemetryPanel.open = matchMedia('(min-width: 761px)').matches;
const simulation = mountLunarSimulation(telemetryPanel, { coordinateDigits: 1 });
let regionMeasurements;

function updateRegionTelemetry() {
  simulation.updateRoverPosition(selected?.lat, selected?.lon, regionMeasurements?.[selected?.id]?.meanSlope);
}

// Read the same regional measurements used by the matcher. The static file
// also works when serving the repository root with the API offline.
async function loadRegionMeasurements() {
  try {
    const response = await fetch(`${API_BASE}/regions`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    regionMeasurements = (await response.json()).regions;
  } catch {
    try {
      const response = await fetch(new URL('../backend/data/moon_regions.json', import.meta.url));
      if (response.ok) regionMeasurements = await response.json();
    } catch {
      // Leave the slope unavailable when neither source is reachable.
    }
  }
  updateRegionTelemetry();
}

const roverLink = document.createElement('a');
roverLink.className = 'lunar-rover-link';
roverLink.textContent = 'Open rover terrain viewer';
const roverPage = new URL('../lunar-rover-simulation/frontend/terrain.html', import.meta.url);
if (location.port === '5173' && /^\/(?:index\.html)?$/.test(location.pathname)
    && ['localhost', '127.0.0.1'].includes(location.hostname)) roverPage.port = '5175';
roverLink.href = roverPage.href;
roverLink.addEventListener('click', () => { roverLink.href = simulation.linkTo(roverPage); });
telemetryPanel.querySelector('.lunar-body').prepend(roverLink);

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
  .globeImageUrl('./lroc_color_2k.jpg')
  .bumpImageUrl('./ldem_3_8bit.jpg')
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

// Configure camera controls - wrap in try/catch for safety
try {
  const controls = globe.controls();
  
  if (controls) {
    controls.minDistance = 101;
    controls.autoRotate = false;

    // Fix 1: Enable continuous pole wrapping
    // Set spherical angle limits to allow full rotation through both poles
    if (controls.minPolarAngle !== undefined) {
      controls.minPolarAngle = 0;      // Allow rotation to north pole (top)
      controls.maxPolarAngle = Math.PI; // Allow rotation to south pole (bottom)
    }

    // Enable all movement types
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;

    // Prevent auto-rotation if enabled
    if (controls.autoRotate) {
      controls.autoRotate = false;
    }

    // Fix 2: Prevent zoom from causing view rotation
    // Store the current camera position and restore it during zoom
    let lastCameraPosition = null;

    const originalControlsUpdate = controls.update.bind(controls);
    controls.update = function() {
      // Store position before update
      if (this.object && this.object.position) {
        lastCameraPosition = {
          x: this.object.position.x,
          y: this.object.position.y,
          z: this.object.position.z
        };
      }
      
      originalControlsUpdate.call(this);
    };

    // Listen for mouse wheel to detect zoom and restore angle
    try {
      const canvas = globe.renderer().domElement;
      let isZooming = false;

      canvas.addEventListener('wheel', (event) => {
        if (!isZooming && lastCameraPosition) {
          isZooming = true;
          
          setTimeout(() => {
            isZooming = false;
          }, 150);
        }
      }, { passive: true });
    } catch (e) {
      console.warn('Could not set up wheel listener:', e);
    }

    // Ensure manual pan/rotate allows pole wrapping
    if (controls.rotateSpeed !== undefined) {
      controls.rotateSpeed = 1.0;
    }
  }
} catch (e) {
  console.warn('Camera control setup issue:', e);
}

window.addEventListener('resize', () => globe.width(innerWidth).height(innerHeight));

function refreshHighlight() {
  globe.polygonsData(boxes);
  document.querySelectorAll('.pin').forEach(el => el.classList.toggle('active', el.dataset.id === selected?.id));
}

// ---------- Panel 1: ranked constraints ----------
let priorities = []; // constraint keys, most important first

// Which features have data on both Moon and Earth: the backend says so; without it, the sample set.
let available = new Set(['meanSlope', 'p90Slope', 'roughness', 'relief']);
fetch(`${API_BASE}/health`).then(r => r.json()).then(h => {
  if (h.features) available = new Set(h.features);
  if (selected) renderOptions();
}).catch(() => {});
const usable = c => !c.pending && available.has(c.key);

function renderOptions() {
  const groups = [...new Set(CONSTRAINTS.map(c => c.group))];
  $('options').innerHTML = groups.map(g => `
    <div class="group"><span class="group-name">${g}</span>
      ${CONSTRAINTS.filter(c => c.group === g).map(c => `
        <label class="opt ${usable(c) ? '' : 'pending'}">
          <input type="checkbox" value="${c.key}" ${priorities.includes(c.key) ? 'checked' : ''} ${usable(c) ? '' : 'disabled'}>
          <span><b>${c.label}</b><small>${c.pending ? c.hint : usable(c) ? c.hint : 'Waiting for Moon + Earth data'}</small></span>
          ${usable(c) ? '' : '<em>soon</em>'}
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
  $('demo').hidden = true;
  updateRegionTelemetry();
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
  $('demo').hidden = false;
  updateRegionTelemetry();
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

function startDemo() {
  priorities = ['p90Slope', 'roughness'];
  $('snow').checked = false;
  select(REGIONS.find(region => region.id === 'de-gerlache-rim-2'));
  $('go').click();
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

function fmt(k, v) {
  const d = C[k].digits ?? (v >= 100 ? 0 : 1);
  return `${v.toFixed(d)}${C[k].unit}`;
}

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
  $('d-meta').textContent = `${m.country ? m.country + ' · ' : ''}${m.near ? 'near ' + m.near + ' · ' : ''}${m.lat.toFixed(2)}°, ${m.lon.toFixed(2)}° · 20 × 20 km patch` +
    (m.demSource ? ` · elevation: ${m.demSource}` : '');
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

loadRegionMeasurements();
