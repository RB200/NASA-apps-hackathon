const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
const J2000 = Date.UTC(2000, 0, 1, 12);
const SPEEDS = [1, 60, 3600, 21600, 86400];
const CLOCK_GAIN_PER_DAY_US = 56.02; // Ashby & Patla, NIST, Table II (pub. 957328).
const sin = degrees => Math.sin(degrees * DEG);
const cos = degrees => Math.cos(degrees * DEG);

export function speedAt(position) {
  const index = Math.min(Math.floor(position / 100), SPEEDS.length - 2);
  const fraction = position / 100 - index;
  return SPEEDS[index] * (SPEEDS[index + 1] / SPEEDS[index]) ** fraction;
}

export function createLunarClock(start, now = () => performance.now()) {
  let epoch = start;
  let elapsed = 0;
  let anchor = null;
  let speed = 1;

  function elapsedAt(time) {
    return elapsed + (anchor === null ? 0 : (time - anchor) * speed);
  }

  return {
    get running() { return anchor !== null; },
    read() {
      const progress = elapsedAt(now());
      return { epoch, elapsed: progress, utc: epoch + progress, speed, running: anchor !== null };
    },
    start() { anchor ??= now(); },
    pause() {
      elapsed = elapsedAt(now());
      anchor = null;
    },
    setSpeed(multiplier) {
      const time = now();
      elapsed = elapsedAt(time);
      if (anchor !== null) anchor = time;
      speed = multiplier;
    },
    reset(newEpoch = epoch) {
      epoch = newEpoch;
      elapsed = 0;
      anchor = null;
    },
    restore(progress, running) {
      elapsed = progress;
      anchor = running ? now() : null;
    },
  };
}

// IAU lunar mean orientation and periodic terms from JPL NAIF pck00011.tpc,
// BODY301 and BODY3_NUT_PREC_ANGLES. Rates here are degrees per Julian century.
const LUNAR_TERMS = [
  [125.045, -1935.5364525, -3.8787, 1.5419, 3.5610],
  [250.089, -3871.072905, -0.1204, 0.0239, 0.1208],
  [260.008, 475263.3328725, 0.0700, -0.0278, -0.0642],
  [176.625, 487269.629985, -0.0172, 0.0068, 0.0158],
  [357.529, 35999.0509575, 0, 0, 0.0252],
  [311.589, 964468.49931, 0.0072, -0.0029, -0.0066],
  [134.963, 477198.869325, 0, 0.0009, -0.0047],
  [276.617, 12006.300765, 0, 0, -0.0046],
  [34.226, 63863.5132425, 0, 0, 0.0028],
  [15.134, -5806.6093575, -0.0052, 0.0008, 0.0052],
  [119.743, 131.84064, 0, 0, 0.0040],
  [239.961, 6003.1503825, 0, 0, 0.0019],
  [25.053, 473327.79642, 0.0043, -0.0009, -0.0044],
];

function solarGeometry(utc, lat, lon) {
  const days = (utc - J2000) / DAY_MS;
  const centuries = days / 36525;
  // USNO approximate geocentric Sun (aa.usno.navy.mil/faq/sun_approx).
  // Reduce ecliptic longitude to J2000 using first-order precession and use
  // J2000 obliquity. Approximate UTC as dynamical time and neglect lunar parallax.
  const anomaly = 357.529 + 0.98560028 * days;
  const longitude = 280.459 + 0.98564736 * days + 1.915 * sin(anomaly)
    + 0.020 * sin(2 * anomaly) - 1.397 * centuries;
  const distanceAu = 1.00014 - 0.01671 * cos(anomaly) - 0.00014 * cos(2 * anomaly);
  const sunX = cos(longitude);
  const sunY = sin(longitude) * cos(23.439291);
  const sunZ = sin(longitude) * sin(23.439291);

  // The rotation relative to the moving Sun gives the ~29.53 Earth-day
  // illumination cycle. The lunar pole orientation supplies seasonal declination.
  let ra = 269.9949 + 0.0031 * centuries;
  let dec = 66.5392 + 0.0130 * centuries;
  let meridian = 38.3213 + 13.17635815 * days - 1.4e-12 * days ** 2;
  for (const [phase, rate, raTerm, decTerm, meridianTerm] of LUNAR_TERMS) {
    const angle = phase + rate * centuries;
    ra += raTerm * sin(angle);
    dec += decTerm * cos(angle);
    meridian += meridianTerm * sin(angle);
  }

  // Project the Sun onto the lunar pole and the two equatorial axes, then
  // dot it with the outward radial unit vector at east-positive longitude.
  const node = -sin(ra) * sunX + cos(ra) * sunY;
  const equator = -sin(dec) * (cos(ra) * sunX + sin(ra) * sunY) + cos(dec) * sunZ;
  const pole = cos(dec) * (cos(ra) * sunX + sin(ra) * sunY) + sin(dec) * sunZ;
  const up = cos(lat) * (cos(meridian + lon) * node + sin(meridian + lon) * equator)
    + sin(lat) * pole;
  return {
    elevation: Math.asin(Math.max(-1, Math.min(1, up))) / DEG,
    irradiance: 1361 * Math.max(0, up) / distanceAu ** 2,
  };
}

export function lunarEnvironment(utc, lat, lon) {
  if (![utc, lat, lon].every(Number.isFinite) || Math.abs(lat) > 90) return null;
  const { elevation, irradiance } = solarGeometry(utc, lat, lon);

  // Illustrative thermal inertia: weight recent horizontal solar flux, then
  // apply grey-body radiative equilibrium with 12% albedo, 0.95 emissivity,
  // and a 90 K dark baseline. This is neither Diviner data nor a terrain model.
  let flux = 0.50 * irradiance;
  for (const [hours, weight] of [[4, 0.22], [12, 0.15], [24, 0.09], [48, 0.04]]) {
    flux += weight * solarGeometry(utc - hours * 3_600_000, lat, lon).irradiance;
  }
  const temperature = (90 ** 4 + 0.88 * flux / (0.95 * 5.670374419e-8)) ** 0.25 - 273.15;
  return { elevation, irradiance, temperature, sunlight: elevation > 0 ? 'Sunlit' : 'Geometrically below horizon' };
}

const utcInputValue = utc => new Date(utc).toISOString().slice(0, 16);
const formatSpeed = speed => speed.toLocaleString('en-US', { maximumSignificantDigits: 4 });

export function mountLunarSimulation(panel, { onStart, onPause, onReset, coordinateDigits = 5 } = {}) {
  panel.innerHTML = `
    <summary>Lunar telemetry</summary>
    <div class="lunar-body">
      <label>Simulation start (UTC)<input data-lunar-start type="datetime-local" min="1900-01-01T00:00" max="2099-12-31T23:59" required></label>
      <label>Time acceleration <output data-lunar="speed"></output>
        <input data-lunar-speed type="range" min="0" max="400" value="0" aria-label="Time acceleration"
               list="lunar-speed-ticks">
      </label>
      <datalist id="lunar-speed-ticks">
        <option value="0"></option><option value="100"></option><option value="200"></option>
        <option value="300"></option><option value="400"></option>
      </datalist>
      <div class="lunar-actions">
        <button type="button" data-lunar-toggle>Start</button>
        <button type="button" data-lunar-reset>Reset</button>
      </div>
      <dl>
        <dt>Simulation UTC</dt><dd data-lunar="utc"></dd>
        <dt>Latitude, longitude</dt><dd data-lunar="position"></dd>
        <dt>Surface temp. (est.)</dt><dd data-lunar="temperature"></dd>
        <dt>Solar elevation (est.)</dt><dd data-lunar="elevation"></dd>
        <dt>Sunlight</dt><dd data-lunar="sunlight"></dd>
        <dt>Irradiance (est.)</dt><dd data-lunar="irradiance"></dd>
        <dt data-lunar="slopeLabel">Regional mean slope</dt><dd data-lunar="slope"></dd>
        <dt>Lunar gravity</dt><dd>≈1.62 m/s²</dd>
      </dl>
      <p>Geometric illumination on a horizontal surface. Terrain shadows and eclipses are omitted.</p>
      <details>
        <summary>Advanced Physics</summary>
        <dl>
          <dt>Pressure</dt><dd>Near vacuum</dd>
          <dt>Mean Earth distance</dt><dd>≈384,400 km</dd>
          <dt>Mean orbital recession</dt><dd>≈3.8 cm/yr</dd>
          <dt>Lunar clock gain</dt><dd data-lunar="offset"></dd>
        </dl>
        <p>Estimated relative to an Earth clock from simulation start, at 56.02 µs per Earth day.</p>
      </details>
    </div>`;

  const input = panel.querySelector('[data-lunar-start]');
  const slider = panel.querySelector('[data-lunar-speed]');
  const toggle = panel.querySelector('[data-lunar-toggle]');
  const fields = Object.fromEntries([...panel.querySelectorAll('[data-lunar]')]
    .map(field => [field.dataset.lunar, field]));
  const handoff = new URLSearchParams(location.hash.slice(1)).get('lunar');
  const [epoch, elapsed, sliderValue, sentAt] = handoff ? handoff.split(',').map(Number) : [];
  const validHandoff = Number.isFinite(epoch) && Math.abs(epoch) < 8e15
    && Number.isFinite(elapsed) && elapsed >= 0 && Math.abs(epoch + elapsed) < 8e15
    && Number.isInteger(sliderValue) && sliderValue >= 0 && sliderValue <= 400
    && Number.isFinite(sentAt) && sentAt >= 0;
  const clock = createLunarClock(validHandoff ? epoch : Math.floor(Date.now() / 60000) * 60000);
  if (validHandoff) {
    slider.value = sliderValue;
    clock.setSpeed(speedAt(sliderValue));
    clock.restore(elapsed + (sentAt ? Math.max(0, Date.now() - sentAt) * speedAt(sliderValue) : 0), !!sentAt);
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  input.value = utcInputValue(clock.read().epoch);

  let locationData = {};
  function render() {
    const { utc, elapsed, speed, running } = clock.read();
    const { lat, lon, slope, slopeLabel } = locationData;
    const environment = lunarEnvironment(utc, lat, lon);
    const values = {
      utc: new Date(utc).toISOString().slice(0, 19).replace('T', ' '),
      speed: `${formatSpeed(speed)}×`,
      position: environment ? `${lat.toFixed(coordinateDigits)}°, ${lon.toFixed(coordinateDigits)}°` : '—',
      temperature: environment ? `${environment.temperature.toFixed(0)} °C` : '—',
      elevation: environment ? `${environment.elevation.toFixed(2)}°` : '—',
      sunlight: environment?.sunlight ?? 'Unknown',
      irradiance: environment ? `${environment.irradiance.toFixed(1)} W/m²` : '—',
      slopeLabel: slopeLabel ?? 'Regional mean slope',
      slope: Number.isFinite(slope) ? `${slope.toFixed(1)}°` : 'Unavailable',
      offset: `+${(elapsed * CLOCK_GAIN_PER_DAY_US / DAY_MS).toFixed(2)} µs`,
    };
    for (const [key, value] of Object.entries(values)) {
      if (fields[key].textContent !== value) fields[key].textContent = value;
    }
    toggle.textContent = running ? 'Pause' : 'Start';
    slider.setAttribute('aria-valuetext', `${formatSpeed(speed)} times`);
  }

  function pause() {
    clock.pause();
    onPause?.();
    render();
  }

  input.addEventListener('change', () => {
    const nextEpoch = Date.parse(`${input.value}Z`);
    if (!input.checkValidity() || !Number.isFinite(nextEpoch)) {
      input.value = utcInputValue(clock.read().epoch);
      return;
    }
    const running = clock.read().running;
    clock.reset(nextEpoch);
    if (running) clock.start();
    render();
  });
  slider.addEventListener('input', () => {
    clock.setSpeed(speedAt(Number(slider.value)));
    render();
  });
  function reset({ resume = false } = {}) {
    clock.reset();
    onPause?.();
    onReset?.();
    if (resume) clock.start();
    render();
  }

  toggle.addEventListener('click', () => {
    if (clock.running) {
      pause();
    } else {
      clock.start();
      onStart?.();
      render();
    }
  });
  panel.querySelector('[data-lunar-reset]').addEventListener('click', () => reset());
  setInterval(() => { if (!panel.hidden && panel.open && clock.running) render(); }, 100);
  panel.addEventListener('toggle', render);
  render();

  return {
    clock,
    pause,
    reset,
    updateRoverPosition(lat, lon, slope, slopeLabel) {
      locationData = { lat, lon, slope, slopeLabel };
      render();
    },
    linkTo(href) {
      const url = new URL(href, location.href);
      const { epoch, elapsed, running } = clock.read();
      url.hash = new URLSearchParams({ lunar: [epoch, elapsed, slider.value, running ? Date.now() : 0].join(',') });
      return url.href;
    },
  };
}
