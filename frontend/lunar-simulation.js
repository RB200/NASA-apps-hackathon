const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
const LUNAR_SOLAR_DAY = 29.53; // NASA Moon Fact Sheet, synodic period.
const START_DAY_RANGE = 30;
const START_DAY_STEP = 0.5;
const J2000 = Date.UTC(2000, 0, 1, 12);
const SPEEDS = [[0, 1], [68, 16], [100, 60], [200, 3600], [300, 21600], [400, 86400]];
export const DRIVE_SLIDER_MAX = 68;
const CLOCK_GAIN_PER_DAY_US = 56.02; // Ashby & Patla, NIST, Table II (pub. 957328).
const sin = degrees => Math.sin(degrees * DEG);
const cos = degrees => Math.cos(degrees * DEG);

export function speedAt(position) {
  const index = SPEEDS.findIndex(([stop]) => stop >= position && stop > 0);
  const [left, slow] = SPEEDS[index - 1];
  const [right, fast] = SPEEDS[index];
  return slow * (fast / slow) ** ((position - left) / (right - left));
}

export function createLunarClock(start, now = () => performance.now(), frameDriven = false) {
  let epoch = start;
  let elapsed = 0;
  let anchor = null;
  let speed = 1;

  function elapsedAt(time) {
    return elapsed + (anchor === null || frameDriven ? 0 : (time - anchor) * speed);
  }

  return {
    get running() { return anchor !== null; },
    read() {
      const progress = elapsedAt(now());
      return { epoch, elapsed: progress, utc: epoch + progress, speed, running: anchor !== null };
    },
    start() { anchor ??= now(); },
    advance(realMs) {
      if (!frameDriven || anchor === null) return 0;
      const simulatedMs = realMs * speed;
      elapsed += simulatedMs;
      return simulatedMs;
    },
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
  const angle = meridian + lon;
  const horizontal = cos(angle) * node + sin(angle) * equator;
  const up = cos(lat) * horizontal + sin(lat) * pole;
  return {
    east: -sin(angle) * node + cos(angle) * equator,
    north: -sin(lat) * horizontal + cos(lat) * pole,
    up,
    elevation: Math.asin(Math.max(-1, Math.min(1, up))) / DEG,
    irradiance: 1361 * Math.max(0, up) / distanceAu ** 2,
  };
}

export function lunarEnvironment(utc, lat, lon) {
  if (![utc, lat, lon].every(Number.isFinite) || Math.abs(lat) > 90) return null;
  const geometry = solarGeometry(utc, lat, lon);
  const { elevation, irradiance } = geometry;

  // Illustrative thermal inertia: weight recent horizontal solar flux, then
  // apply grey-body radiative equilibrium with 12% albedo, 0.95 emissivity,
  // and a 90 K dark baseline. This is neither Diviner data nor a terrain model.
  let flux = 0.50 * irradiance;
  for (const [hours, weight] of [[4, 0.22], [12, 0.15], [24, 0.09], [48, 0.04]]) {
    flux += weight * solarGeometry(utc - hours * 3_600_000, lat, lon).irradiance;
  }
  const temperature = (90 ** 4 + 0.88 * flux / (0.95 * 5.670374419e-8)) ** 0.25 - 273.15;
  return { ...geometry, temperature, sunlight: elevation > 0 ? 'Sunlit' : 'Geometrically below horizon' };
}

const utcInputValue = utc => new Date(utc).toISOString().slice(0, 16);
const formatSpeed = speed => speed.toLocaleString('en-US', { maximumSignificantDigits: 4 });

const MOON_FACTS = ['NASA Moon Fact Sheet', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html'];
const LOLA = ['NASA PDS · LRO LOLA', 'https://pds-geosciences.wustl.edu/missions/lro/lola_faq.htm'];
const SOLAR_SOURCES = [
  ['USNO solar coordinates', 'https://aa.usno.navy.mil/faq/sun_approx'],
  ['JPL lunar orientation constants', 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc'],
];
const ROVER_SOURCE = ['Project rover model', 'https://github.com/RB200/NASA-apps-hackathon/blob/main/lunar-rover-simulation/frontend/rover.js'];

const METHODS = {
  utc: ['Simulation UTC', 'The clock adds accumulated simulated time to your chosen start date.', { plain: 'UTC = start UTC + Σ(elapsed playback × rate)', tex: String.raw`t_{\mathrm{UTC}}=t_{\mathrm{start}}+\sum_i \Delta t_i\,r_i` }],
  speed: ['Time acceleration', 'The slider changes how much simulated time passes per playback second.', { plain: 'Simulated seconds = playback seconds × rate', tex: String.raw`\Delta t_{\mathrm{sim}}=r\,\Delta t_{\mathrm{playback}}` }],
  coordinates: ['Latitude and longitude', 'The atlas uses a selected region center. The rover converts its position on the LOLA polar grid to coordinates. E and N are projected offsets, and R is the lunar reference radius.', { plain: 'Latitude = −90° + 2 atan(√(E² + N²) / 2R) · Longitude = atan2(E, N)', tex: String.raw`\begin{aligned}\varphi &=-90^\circ+\frac{360^\circ}{\pi}\arctan\!\left(\frac{\sqrt{E^2+N^2}}{2R}\right)\\\lambda &=\operatorname{atan2}(E,N)\times\frac{180^\circ}{\pi}\end{aligned}` }, LOLA],
  temperature: ['Estimated surface temperature', 'A simple thermal model blends current and recent sunlight at this location. It assumes a 90 K dark baseline, 12% albedo and 0.95 emissivity.', { plain: 'T (°C) ≈ [90⁴ + 0.88 × weighted sunlight / (0.95σ)]¹⁄⁴ − 273.15', tex: String.raw`\begin{aligned}T_{\!^\circ\mathrm{C}}&\approx\left[90^4+\frac{0.88\,F_{\mathrm{weighted}}}{0.95\,\sigma}\right]^{1/4}\\&\quad-273.15\end{aligned}` }, ['NIST Stefan–Boltzmann constant', 'https://physics.nist.gov/cgi-bin/cuu/Value?sigma']],
  solar: ['Estimated solar elevation', 'The model converts the Sun’s direction to the lunar frame, then measures its angle above the local horizontal.', { plain: 'Elevation = arcsin(Sun unit vector · local up)', tex: String.raw`\alpha=\arcsin\!\left(\hat{\boldsymbol{s}}\cdot\hat{\boldsymbol{u}}\right)` }, ...SOLAR_SOURCES],
  sunlight: ['Geometric sunlight', 'The flag uses the center of the Sun. Terrain shadows and eclipses are omitted.', { plain: 'Sunlit when solar elevation > 0°', tex: String.raw`\text{Sunlit}\quad\text{if}\quad\alpha>0^\circ` }, ...SOLAR_SOURCES],
  irradiance: ['Estimated horizontal irradiance', 'Sunlight is projected onto flat ground. The result is incoming energy per area.', { plain: 'I = 1,361 × max(0, sin elevation) / distance² W/m² · distance in AU', tex: String.raw`I=\frac{1361\,\max(0,\sin\alpha)}{d_{\mathrm{AU}}^2}\;\mathrm{W\,m^{-2}}` }, ['NASA Goddard solar irradiance', 'https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science']],
  regionalSlope: ['Regional mean slope', 'The atlas reads the selected region’s precomputed average from the lunar terrain data.', { plain: 'Mean slope = sum of sampled slope angles ÷ sample count', tex: String.raw`\bar\theta=\frac{1}{n}\sum_{i=1}^{n}\theta_i` }, LOLA],
  localSlope: ['Local LOLA slope', 'The rover samples unexaggerated ground heights on opposite sides of its position.', { plain: 'Slope = atan(√(gradient east² + gradient north²)) · gradient = rise ÷ run', tex: String.raw`\theta=\arctan\!\sqrt{\left(\frac{\Delta h_E}{\Delta E}\right)^2+\left(\frac{\Delta h_N}{\Delta N}\right)^2}` }, LOLA],
  gravity: ['Lunar gravity', 'The rover uses a constant downward acceleration. The value is a lunar surface reference.', { plain: 'g ≈ 1.62 m/s²', tex: String.raw`g\approx1.62\;\mathrm{m\,s^{-2}}` }, MOON_FACTS],
  pressure: ['Pressure', 'The Moon has a tenuous exosphere. The simulator displays a qualitative reference.', '', MOON_FACTS],
  distance: ['Mean Earth distance', 'The value is the approximate mean center-to-center distance. The instantaneous distance varies.', { plain: 'Mean distance ≈ 384,400 km', tex: String.raw`\bar d\approx384{,}400\;\mathrm{km}` }, ['JPL lunar distance reference', 'https://cneos.jpl.nasa.gov/glossary/LD.html']],
  recession: ['Mean orbital recession', 'Lunar laser ranging estimates how fast the average Earth–Moon distance increases.', { plain: 'Average change ≈ 3.8 cm/year', tex: String.raw`\overline{\dot d}\approx3.8\;\mathrm{cm\,yr^{-1}}` }, ['NASA lunar laser ranging summary', 'https://eclipse.gsfc.nasa.gov/SEcat5/secular.html']],
  relativity: ['Estimated lunar clock gain', 'A constant-rate estimate relative to a clock on the Earth geoid.', { plain: 'Gain (µs) ≈ simulated Earth days × 56.02', tex: String.raw`\Delta\tau\approx56.02\;\mathrm{\mu s}\,\frac{\Delta t_{\mathrm{sim}}}{86400\;\mathrm{s}}` }, ['NIST · Ashby and Patla, Table II', 'https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=957328']],
  traverse: ['Distance traversed', 'Each simulated step adds the horizontal distance moved. Backtracking also adds distance.', { plain: 'Distance = Σ √(Δx² + Δz²)', tex: String.raw`L=\sum_i\sqrt{(\Delta x_i)^2+(\Delta z_i)^2}` }, ROVER_SOURCE],
  velocity: ['Rover playback speed', 'The display multiplies horizontal velocity in m/s by the clock rate r and converts it to km/h.', { plain: 'Playback speed = √(vₓ² + v𝓏²) × 3.6 × rate · km/h', tex: String.raw`v_{\mathrm{playback}}=3.6r\sqrt{v_x^2+v_z^2}\;\mathrm{km/h}` }, ROVER_SOURCE],
  earthVelocity: ['Rover speed', 'The speed uses the rover’s horizontal velocity on the Earth analog tile.', { plain: 'Speed = 3.6 × horizontal velocity in m/s', tex: String.raw`v=3.6\sqrt{v_x^2+v_z^2}\;\mathrm{km/h}` }, ROVER_SOURCE],
  earthGround: ['Earth ground elevation', 'The app interpolates the NASA SRTM terrain triangle beneath the rover.', { plain: 'Height = interpolation of the three triangle heights', tex: String.raw`h=w_1h_1+w_2h_2+w_3h_3` }, ['NASA SRTMGL1', 'https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003']],
  ground: ['Ground elevation', 'The app interpolates the LOLA terrain triangle beneath the rover. Each height is weighted by the rover’s position within the triangle. Negative values are below the lunar reference radius.', { plain: 'Height = interpolation of the three triangle heights', tex: String.raw`h=w_1h_1+w_2h_2+w_3h_3` }, LOLA],
};

const KATEX_DIST = 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/';
let mathRenderer;

function loadMathRenderer() {
  mathRenderer ??= Promise.all([
    new Promise((resolve, reject) => {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = `${KATEX_DIST}katex.min.css`;
      stylesheet.integrity = 'sha384-WwGtaC6ywCHxA5cstpj/3+xIZvTez8dq2IcBQaXRkenHZ7FVVq1ZROtURwfbtTlG';
      stylesheet.crossOrigin = 'anonymous';
      stylesheet.addEventListener('load', resolve, { once: true });
      stylesheet.addEventListener('error', reject, { once: true });
      document.head.append(stylesheet);
    }),
    import(`${KATEX_DIST}katex.mjs`),
  ]).then(([, module]) => module.default).catch(() => null);
  return mathRenderer;
}

function showFormula(element, formula) {
  element.textContent = formula?.plain ?? '';
  element.hidden = !formula;
  element.dataset.tex = formula?.tex ?? '';
  if (!formula) return;
  loadMathRenderer().then(katex => {
    if (!katex || element.dataset.tex !== formula.tex) return;
    try {
      katex.render(formula.tex, element, { displayMode: true, trust: false });
    } catch {
      element.textContent = formula.plain;
    }
  });
}

function methodButton(id, text, key = '') {
  const field = key ? ` data-lunar="${key}"` : '';
  return `<button type="button" class="telemetry-method" data-method="${id}" aria-haspopup="dialog"${field}>${text}</button>`;
}

export function mountLunarSimulation(panel, {
  onStart, onPause, onReset, onSpeedChange, onEpochChange, coordinateDigits = 5, driving = false,
} = {}) {
  panel.innerHTML = `
    <summary>Lunar telemetry</summary>
    <div class="lunar-body">
      <div class="lunar-start">
        <label for="lunar-start-day" data-lunar-day-label>Moon time</label>
        <output class="lunar-day-offset" for="lunar-start-day"></output>
        <input id="lunar-start-day" type="range" min="0" max="${START_DAY_RANGE}" step="${START_DAY_STEP}" value="0"
               aria-describedby="lunar-start-utc">
        <div id="lunar-start-utc">Start UTC <time></time></div>
      </div>
      <label for="lunar-speed">Time acceleration</label>
      <div class="lunar-speed">
        ${methodButton('speed', '', 'speed')}
        ${driving ? '<span>Drive range 1–16×</span>' : ''}
        <input id="lunar-speed" data-lunar-speed type="range" min="0" max="${driving ? DRIVE_SLIDER_MAX : 400}" value="0" aria-label="Time acceleration"
               list="lunar-speed-ticks">
      </div>
      <datalist id="lunar-speed-ticks">
        <option value="0"></option><option value="68"></option><option value="100"></option><option value="200"></option>
        <option value="300"></option><option value="400"></option>
      </datalist>
      <div class="lunar-actions">
        <button type="button" data-lunar-toggle>Start</button>
        <button type="button" data-lunar-reset>Reset</button>
      </div>
      <dl>
        <dt>Simulation UTC</dt><dd>${methodButton('utc', '', 'utc')}</dd>
        <dt>Latitude, longitude</dt><dd>${methodButton('coordinates', '', 'position')}</dd>
        <dt>Surface temp. (est.)</dt><dd>${methodButton('temperature', '', 'temperature')}</dd>
        <dt>Solar elevation (est.)</dt><dd>${methodButton('solar', '', 'elevation')}</dd>
        <dt>Sunlight</dt><dd>${methodButton('sunlight', '', 'sunlight')}</dd>
        <dt>Irradiance (est.)</dt><dd>${methodButton('irradiance', '', 'irradiance')}</dd>
        <dt data-lunar="slopeLabel">Regional mean slope</dt><dd>${methodButton(driving ? 'localSlope' : 'regionalSlope', '', 'slope')}</dd>
        <dt>Lunar gravity</dt><dd>${methodButton('gravity', '≈1.62 m/s²')}</dd>
      </dl>
      <p>Geometric illumination on a horizontal surface. Terrain shadows and eclipses are omitted.</p>
      <details>
        <summary>Advanced Physics</summary>
        <dl>
          <dt>Pressure</dt><dd>${methodButton('pressure', 'Near vacuum')}</dd>
          <dt>Mean Earth distance</dt><dd>${methodButton('distance', '≈384,400 km')}</dd>
          <dt>Mean orbital recession</dt><dd>${methodButton('recession', '≈3.8 cm/yr')}</dd>
          <dt>Lunar clock gain</dt><dd>${methodButton('relativity', '', 'offset')}</dd>
        </dl>
        <p>Estimated relative to an Earth clock from simulation start, at 56.02 µs per Earth day.</p>
      </details>
      <dialog class="lunar-method-dialog" aria-labelledby="lunar-method-title">
        <h2 id="lunar-method-title"></h2>
        <p class="lunar-method-value"></p>
        <p class="lunar-method-explanation"></p>
        <p class="lunar-method-formula"></p>
        <ul class="lunar-method-sources" aria-label="Sources"></ul>
        <form method="dialog" class="lunar-actions"><button type="submit" autofocus>Close</button></form>
      </dialog>
    </div>`;

  const methodDialog = panel.querySelector('.lunar-method-dialog');
  document.body.append(methodDialog);
  document.addEventListener('click', event => {
    const trigger = event.target.closest('button[data-method]');
    if (!trigger || !Object.hasOwn(METHODS, trigger.dataset.method)) return;
    const [title, explanation, formula, ...sources] = METHODS[trigger.dataset.method];
    const value = trigger.querySelector('strong') ?? trigger;
    methodDialog.querySelector('h2').textContent = title;
    methodDialog.querySelector('.lunar-method-value').textContent = value.textContent;
    methodDialog.querySelector('.lunar-method-explanation').textContent = explanation;
    showFormula(methodDialog.querySelector('.lunar-method-formula'), formula);
    const sourceList = methodDialog.querySelector('ul');
    sourceList.replaceChildren(...sources.map(([name, url]) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = name;
      item.append(link);
      return item;
    }));
    sourceList.hidden = !sources.length;
    methodDialog.showModal();
  });

  const daySlider = panel.querySelector('#lunar-start-day');
  const dayLabel = panel.querySelector('[data-lunar-day-label]');
  const dayOffset = panel.querySelector('.lunar-day-offset');
  const startTime = panel.querySelector('#lunar-start-utc time');
  let world = 'moon';
  const slider = panel.querySelector('[data-lunar-speed]');
  const toggle = panel.querySelector('[data-lunar-toggle]');
  const fields = Object.fromEntries([...panel.querySelectorAll('[data-lunar]')]
    .map(field => [field.dataset.lunar, field]));
  const handoff = new URLSearchParams(location.hash.slice(1)).get('lunar');
  const [epoch, elapsed, sliderValue, sentAt, startDay = 0] = handoff ? handoff.split(',').map(Number) : [];
  const validHandoff = Number.isFinite(epoch) && Math.abs(epoch) < 8e15
    && Number.isFinite(elapsed) && elapsed >= 0 && Math.abs(epoch + elapsed) < 8e15
    && Number.isInteger(sliderValue) && sliderValue >= 0 && sliderValue <= 400
    && Number.isFinite(sentAt) && sentAt >= 0
    && Number.isInteger(startDay / START_DAY_STEP) && startDay >= 0 && startDay <= START_DAY_RANGE;
  const clock = createLunarClock(validHandoff ? epoch : Math.floor(Date.now() / 60000) * 60000, undefined, driving);
  const baseEpoch = clock.read().epoch - (validHandoff ? startDay * DAY_MS : 0);
  if (validHandoff) {
    daySlider.value = startDay;
    slider.value = Math.min(sliderValue, Number(slider.max));
    clock.setSpeed(speedAt(Number(slider.value)));
    const transit = sentAt ? Math.max(0, Date.now() - sentAt) * speedAt(sliderValue) : 0;
    clock.restore(elapsed + transit, !!sentAt && !driving);
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  function showStart() {
    const days = Number(daySlider.value);
    const dayText = `${days} Earth ${days === 1 ? 'day' : 'days'}`;
    const lunarText = `${(days / LUNAR_SOLAR_DAY).toFixed(3)} lunar solar days`;
    dayLabel.textContent = world === 'earth' ? 'Earth time' : 'Moon time';
    dayOffset.textContent = world === 'earth' ? lunarText : dayText;
    daySlider.setAttribute('aria-valuetext', world === 'earth' ? `${dayText}, ${lunarText}` : dayText);
    startTime.dateTime = `${utcInputValue(clock.read().epoch)}Z`;
    startTime.textContent = startTime.dateTime.slice(0, -1).replace('T', ' ');
  }
  showStart();

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
    return environment;
  }

  function pause() {
    clock.pause();
    onPause?.();
    render();
  }

  daySlider.addEventListener('input', () => {
    const nextEpoch = baseEpoch + Number(daySlider.value) * DAY_MS;
    if (nextEpoch === clock.read().epoch) return;
    const running = clock.running;
    clock.reset(nextEpoch);
    if (running) clock.start();
    showStart();
    onEpochChange?.();
    render();
  });
  slider.addEventListener('input', () => {
    clock.setSpeed(speedAt(Number(slider.value)));
    onSpeedChange?.();
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
    setWorld(selectedWorld) {
      world = selectedWorld;
      showStart();
    },
    updateRoverPosition(lat, lon, slope, slopeLabel) {
      locationData = { lat, lon, slope, slopeLabel };
      return render();
    },
    linkTo(href) {
      const url = new URL(href, location.href);
      const { epoch, elapsed, running } = clock.read();
      url.hash = new URLSearchParams({ lunar: [epoch, elapsed, slider.value, running ? Date.now() : 0, daySlider.value].join(',') });
      return url.href;
    },
  };
}
