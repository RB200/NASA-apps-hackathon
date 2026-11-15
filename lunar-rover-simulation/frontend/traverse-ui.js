import { environmentClock, environmentProfile } from './traverse-environment.mjs';
import { INTERVAL, Traverse, routeStats, profileDifference } from './traverse.mjs?v=environment-1';

const colors = { earth: '#75e2af', moon: '#c1b2ff' };
const worlds = ['earth', 'moon'];
const fmt = n => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const metres = n => `${fmt(n)} m`;
const putText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

const environmentMetrics = {
  temperature: { label: 'Lunar surface temperature estimate', axis: 'Temperature (°C)', series: ['moon'] },
  elevation: { label: 'Sun elevation', axis: 'Sun elevation (°)', series: worlds },
  irradiance: { label: 'Horizontal solar irradiance', axis: 'Irradiance (W/m²)', series: worlds },
};

function graph(svg, points, metric = null) {
  const series = metric?.series ?? worlds;
  const horizontal = metric ? 'Simulated elapsed time (min)' : 'Horizontal distance (m)';
  const vertical = metric?.axis ?? 'Rel. elevation (m)';
  svg.setAttribute('aria-label', `${metric?.label ?? 'Relative terrain elevation'} vs. ${horizontal}`);
  const width = 480, height = 150, left = 56, right = 429, top = 12, bottom = 106;
  let low = metric && points.length ? Infinity : 0;
  let high = metric && points.length ? -Infinity : 0;
  for (const point of points) for (const world of series) {
    low = Math.min(low, point[world]);
    high = Math.max(high, point[world]);
  }
  const step = 10 ** Math.floor(Math.log10(Math.max(1, high - low)));
  low = Math.floor(low / step) * step;
  high = Math.max(low + step, Math.ceil(high / step) * step);
  const distance = Math.max(metric ? 1 : INTERVAL, points.at(-1)?.distance ?? 0);
  const x = m => left + m / distance * (right - left);
  const y = m => bottom - (m - low) / (high - low) * (bottom - top);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const labels = [low, (low + high) / 2, high].map(value =>
    `<path d="M${left},${y(value)} H${right}"/><text x="${left - 5}" y="${y(value) + 4}" text-anchor="end">${fmt(value)}</text>`);
  if (low < 0 && high > 0) labels.push(`<path class="traverse-zero" d="M${left},${y(0)} H${right}"/>`);
  svg.innerHTML = `${labels.join('')}
    <text x="${left}" y="121" text-anchor="middle">0</text>
    <text x="${right}" y="121" text-anchor="middle">${fmt(distance)}</text>
    <text x="240" y="142" text-anchor="middle">${horizontal}</text>
    <text transform="translate(12 59) rotate(-90)" text-anchor="middle">${vertical}</text>
    ${series.map(world => points.length === 1 ? `<circle cx="${left}" cy="${y(points[0][world])}" r="3" fill="${colors[world]}"/>` :
      `<polyline points="${points.map(p => `${x(p.distance).toFixed(2)},${y(p[world]).toFixed(2)}`).join(' ')}"
        stroke="${colors[world]}" ${world === 'moon' ? 'stroke-dasharray="5 3"' : ''}/>`).join('')}`;
}

function drawEnvironment(container, test, key) {
  const metric = environmentMetrics[key];
  const points = environmentProfile(test).map(point => {
    const values = { distance: point.minute };
    for (const world of metric.series) values[world] = point[world][key];
    return values;
  });
  graph(container.querySelector('svg'), points, metric);
  const note = container.querySelector('.traverse-environment-note');
  note.hidden = false;
  const start = new Date(test.environmentClock.start).toISOString().slice(0, 19).replace('T', ' ');
  const detail = key === 'temperature'
    ? 'Lunar estimate at the site center. Earth temperature data are unavailable.'
    : 'Site centers at the same simulated UTC. Sunlight excludes clouds and terrain shadows.';
  putText(note, `${detail} Start: ${start} UTC. Samples every simulated minute plus the latest point.`);
  container.querySelector('.traverse-key span').hidden = key === 'temperature';
}

function localRoute(test, world) {
  const tile = test.tiles[world];
  return test.pairedRoute.map(p => {
    const { x, z } = test.coordinates(world, p);
    return tile.toLocal(x, z);
  });
}

function drawMaps(dialog, test, zoom, overlay) {
  const split = dialog.querySelector('.traverse-maps');
  const combined = dialog.querySelector('.traverse-overlay-map');
  split.hidden = overlay;
  combined.hidden = !overlay;
  const overlayCanvas = combined.querySelector('canvas');
  const overlayContext = overlayCanvas.getContext('2d');
  const maps = worlds.map(world => ({ world, tile: test.tiles[world], route: localRoute(test, world) }));
  let span = 0;
  for (const { tile, route } of maps) {
    if (zoom) {
      for (const { east, north } of route) span = Math.max(span, 2.25 * Math.abs(east - route[0].east), 2.25 * Math.abs(north - route[0].north));
      span = Math.max(span, 180);
    } else {
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const p = tile.toLocal(x * tile.halfX, z * tile.halfZ);
        const center = overlay ? route[0] : { east: 0, north: 0 };
        span = Math.max(span, 2.05 * Math.abs(p.east - center.east), 2.05 * Math.abs(p.north - center.north));
      }
    }
  }
  const overlayRoutes = [];
  for (const { world, tile, route } of maps) {
    const canvas = dialog.querySelector(`canvas[data-world="${world}"]`);
    const ctx = canvas.getContext('2d'), size = canvas.width, metresPerPixel = span / size;
    const center = zoom || overlay ? route[0] : { east: 0, north: 0 };
    const px = e => (e - center.east) / metresPerPixel + size / 2;
    const py = n => (center.north - n) / metresPerPixel + size / 2;
    const raster = new Float32Array(size * size).fill(NaN);
    let min = Infinity, max = -Infinity;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = tile.toGrid(center.east + (x + 0.5 - size / 2) * metresPerPixel,
        center.north + (size / 2 - y - 0.5) * metresPerPixel);
      const h = tile.elevation(p.x, p.z);
      if (h == null) continue;
      raster[y * size + x] = h;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < raster.length; i++) {
      const h = raster[i];
      const neighbor = value => Number.isFinite(value) ? value : h;
      const east = i % size < size - 1 ? raster[i + 1] : h;
      const gradient = (neighbor(raster[i - size]) - neighbor(east)) / metresPerPixel;
      const shade = 0.25 + 0.55 * ((h - min) / (max - min || 1)) + 0.15 * Math.tanh(gradient);
      img.data.set(Number.isNaN(h) ? [19, 28, 33, 255] : [
        shade * (world === 'earth' ? 246 : 255),
        shade * (world === 'earth' ? 211 : 255),
        shade * (world === 'earth' ? 158 : 255), 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    const pixels = route.map(({ east, north }) => ({ x: px(east), y: py(north) }));
    if (overlay) {
      overlayContext.save();
      overlayContext.globalAlpha = world === 'earth' ? 1 : 0.5;
      overlayContext.drawImage(canvas, 0, 0);
      overlayContext.restore();
      overlayRoutes.push(pixels);
    } else {
      drawRoute(ctx, pixels, colors[world], 3);
      drawMapLabels(ctx, pixels, colors[world], metresPerPixel);
    }
  }
  if (overlay) {
    drawRoute(overlayContext, overlayRoutes[0], colors.earth, 4);
    drawRoute(overlayContext, overlayRoutes[1], colors.moon, 2.5, [5, 5]);
    drawMapLabels(overlayContext, overlayRoutes[0], '#fff', span / overlayCanvas.width);
  }
}

function drawRoute(ctx, pixels, color, width, dash = []) {
  ctx.beginPath();
  pixels.forEach(({ x, y }, i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.lineJoin = ctx.lineCap = 'round';
  if (!dash.length) {
    ctx.strokeStyle = '#10171a'; ctx.lineWidth = 7; ctx.stroke();
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  ctx.setLineDash([]);
}

function drawMapLabels(ctx, route, finishColor, metresPerPixel) {
  const size = ctx.canvas.width;
  for (const [point, label, fill, offset] of [[route[0], 'S', '#fff', -13], [route.at(-1), 'F', finishColor, 13]]) {
    const { x, y } = point;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#10171a'; ctx.lineWidth = 4;
    ctx.strokeText(label, x + offset, y + 4); ctx.fillText(label, x + offset, y + 4);
  }
  const bar = 10 ** Math.floor(Math.log10(metresPerPixel * size / 3));
  ctx.fillStyle = '#10171a'; ctx.fillRect(6, size - 38, Math.max(80, bar / metresPerPixel + 16), 32);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  ctx.fillText(metres(bar), 14, size - 21);
  ctx.fillRect(14, size - 15, bar / metresPerPixel, 2);
  ctx.fillStyle = '#10171a'; ctx.fillRect(size - 52, 6, 46, 24);
  ctx.fillStyle = '#fff'; ctx.fillText('↑ N', size - 45, 23);
}

export function mountTraverse({ refocus, earthSites, loadEarthSite, readClock }) {
  const panel = document.getElementById('live-traverse');
  const status = panel.querySelector('p');
  const liveGraph = panel.querySelector('svg');
  const liveChart = document.getElementById('traverse-live-chart');
  const liveMetric = document.getElementById('traverse-live-metric');
  const reportMetric = document.getElementById('traverse-report-metric');
  const reportEnvironment = document.querySelector('.traverse-environment');
  liveMetric.add(new Option('Terrain elevation by distance', ''));
  for (const [key, metric] of Object.entries(environmentMetrics)) {
    liveMetric.add(new Option(metric.label, key));
    reportMetric.add(new Option(metric.label, key));
  }
  const ready = document.getElementById('traverse-ready');
  const finish = document.getElementById('traverse-finish');
  const report = document.getElementById('traverse-report');
  const overlay = document.getElementById('traverse-overlay');
  const zoom = document.getElementById('traverse-zoom');
  const earthPicker = document.getElementById('traverse-earth-site');
  const earthStatus = document.getElementById('traverse-earth-status');
  let original, selectedEarth, earthRequest = 0;
  const refreshMaps = () => drawMaps(report, shown, zoom.checked, overlay.checked);

  const reopen = document.getElementById('traverse-last');
  let current, last, shown, driving = false, lastPaint = 0, drawnDistance, drawnClock;
  const update = (force = false) => {
    if (!force && performance.now() - lastPaint < 200) return;
    lastPaint = performance.now();
    panel.hidden = !driving && !last;
    finish.disabled = !current?.test.tiles || !hasResults(current.test);
    finish.hidden = !driving;
    ready.hidden = !last;
    reopen.hidden = !last;
    if (!current) {
      status.textContent = driving ? 'Recording finished. Reset the rover to start a new test.' : 'A completed test is ready to review.';
      liveChart.hidden = true;
      return;
    }
    const { test, reason } = current;
    liveChart.hidden = !test.tiles;
    putText(status, reason || (!test.tiles ? 'Loading paired elevation tiles…' :
      test.incomplete ? `Incomplete · tile edge at ${metres(test.pairedDistance)} · driven ${metres(test.distance)}` :
        `Recording · ${metres(test.distance)} · ${INTERVAL} m stations`));
    if (!panel.open || !test.tiles) return;
    if (liveMetric.value) {
      if (force || drawnClock !== test.environmentClock) {
        drawEnvironment(liveChart, test, liveMetric.value);
        drawnClock = test.environmentClock;
      }
    } else if (force || drawnDistance !== test.pairedDistance) {
      liveChart.querySelector('.traverse-environment-note').hidden = true;
      liveChart.querySelector('.traverse-key span').hidden = false;
      graph(liveGraph, test.profile());
      drawnDistance = test.pairedDistance;
    }
  };

  function showReport() {
    if (!last || report.open) return;
    original = shown = last;
    selectedEarth = '';
    earthRequest++;
    earthPicker.replaceChildren(new Option(`Original · ${original.tiles.earth.descriptor.name}`, ''));
    for (const [id, site] of earthSites()) {
      if (original.tiles.earth.descriptor.file === `earth/${site.file}`) continue;
      earthPicker.add(new Option(`${site.name} · ${site.country} (${site.centerLatitude.toFixed(2)}°, ${site.centerLongitude.toFixed(2)}°)`, id));
    }
    earthStatus.textContent = 'Try the same recorded route from the center of another Earth terrain.';
    zoom.checked = true;
    reportMetric.value = liveMetric.value || 'temperature';
    renderReport();
    report.scrollTop = 0;
    report.showModal();
  }

  function renderReport() {
    const test = shown;
    const points = test.profile();
    const stats = worlds.map(world => routeStats(points, world));
    const state = report.querySelector('.traverse-result-status');
    state.textContent = `${test.incomplete ? 'Incomplete: paired sampling stopped at the tile edge.' : 'Complete.'}
      Drove ${metres(test.distance)} on ${test.world === 'earth' ? 'Earth' : 'the Moon'}; ${metres(test.pairedDistance)} compared.`;
    for (const world of worlds) {
      const { descriptor, spacing } = test.tiles[world], { x, z } = test.starts[world];
      const center = `${descriptor.centerLatitude.toFixed(3)}°, ${descriptor.centerLongitude.toFixed(3)}°`;
      report.querySelector(`[data-tile="${world}"]`).textContent =
        `${descriptor.name} · ${spacing} m grid · tile center: ${center} · start: ${metres(x)}, ${metres(z)} (tile X, Z)`;
    }
    graph(report.querySelector('svg'), points);
    const rows = [
      ['Compared horizontal distance', s => metres(s.distance)],
      ['Average absolute slope', s => s.average == null ? '—' : `${fmt(s.average)}°`],
      ['Maximum sampled slope', s => s.steepest ? `${fmt(s.steepest.degrees)}°` : '—'],
      ['Elevation gain', s => metres(s.gain)], ['Elevation loss', s => metres(s.loss)],
      ['Elevation range', s => metres(s.range)],
    ];
    report.querySelector('tbody').innerHTML = rows.map(([name, value]) =>
      `<tr><th scope="row">${name}</th>${stats.map(s => `<td>${value(s)}</td>`).join('')}</tr>`).join('');
    const diff = profileDifference(points);
    const peak = (s, label) => `${label}’s steepest sampled section was ${fmt(s.steepest.degrees)}° (from ${metres(s.steepest.from)} to ${metres(s.steepest.to)}).`;
    report.querySelector('.traverse-interpretation').textContent = !diff
      ? 'The route has no measurable paired segment.'
      : `${diff.closest === diff.furthest ?
        `At ${metres(diff.closest.distance)}, the starting-relative elevations differ by ${metres(diff.gap(diff.closest))}.` :
        `Beyond the start, the profiles are closest at ${metres(diff.closest.distance)} (a ${metres(diff.gap(diff.closest))} gap) and differ most at ${metres(diff.furthest.distance)} (a ${metres(diff.gap(diff.furthest))} gap).`} ${peak(stats[0], 'Earth')} ${peak(stats[1], 'The Moon')}`;
    refreshMaps();
    drawEnvironment(reportEnvironment, test, reportMetric.value);
  }

  const hasResults = test => test.distance > 0 || test.environmentClock?.seconds >= 60;
  function complete(open = false) {
    const entry = current;
    current = null;
    if (entry && !entry.reason && hasResults(entry.test)) {
      entry.ready.then(() => {
        if (entry.test.tiles && (!last || entry.test.sequence > last.sequence)) {
          last = entry.test;
          if (open) showReport();
        }
        update(true);
      });
    }
    update(true);
  }
  let sequence = 0;
  finish.addEventListener('click', () => { complete(true); refocus(); });
  reopen.addEventListener('click', showReport);
  liveMetric.addEventListener('change', () => update(true));
  reportMetric.addEventListener('change', () => drawEnvironment(reportEnvironment, shown, reportMetric.value));
  zoom.addEventListener('change', refreshMaps);
  overlay.addEventListener('change', refreshMaps);
  earthPicker.addEventListener('change', async () => {
    const request = ++earthRequest;
    const id = earthPicker.value;
    if (id) earthStatus.textContent = 'Loading Earth terrain…';
    try {
      const earth = id ? await loadEarthSite(id) : null;
      if (request !== earthRequest || !report.open) return;
      shown = earth ? original.withEarthTile(earth) : original;
      selectedEarth = id;
      renderReport();
      earthStatus.textContent = id
        ? 'Same recorded route, sampled from the new Earth terrain’s center.'
        : 'Original Earth terrain restored.';
    } catch (error) {
      if (request !== earthRequest || !report.open) return;
      console.warn('Could not load the alternative Earth terrain.', error);
      earthPicker.value = selectedEarth;
      earthStatus.textContent = 'Could not load that terrain. The previous comparison is still shown.';
    }
  });
  report.addEventListener('close', refocus);
  panel.addEventListener('toggle', () => {
    update(true);
    if (driving && document.activeElement === panel.querySelector('summary')) refocus();
  });
  return {
    get reportOpen() { return report.open; },
    start(world, start, reason, loadPair) {
      driving = true;
      const test = new Traverse(world, start);
      test.sequence = ++sequence;
      test.environmentClock = environmentClock(null, readClock());
      const entry = { test, reason };
      current = entry;
      if (!reason) entry.ready = loadPair().then(tiles => test.setTiles(tiles)).catch(error => {
        console.warn('Could not load the traverse terrain pair.', error);
        entry.reason = 'Paired comparison unavailable: one of the elevation tiles could not load.';
      }).finally(() => {
        if (current === entry) update(true);
      });
      update(true);
    },
    record(x, z) { if (current && !current.reason) current.test.record(x, z); },
    tick() {
      if (current && !current.reason) {
        const test = current.test;
        const previous = test.environmentClock;
        const next = environmentClock(previous, readClock());
        if (next.start !== previous.start || next.seconds !== previous.seconds) test.environmentClock = next;
      }
      update();
    },
    leave() {
      driving = false;
      panel.open = false;
      complete();
    },
  };
}
