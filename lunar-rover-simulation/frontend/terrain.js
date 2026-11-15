import { mountTraverse } from './traverse-ui.js?v=traverse-open-1';
import { gridTriangle, traverseTile } from './traverse.mjs?v=environment-1';
import { loadRover, RoverDynamics, setGravity } from './rover.js?v=traverse-1';
import { loadEarthMetadata, earthDescriptor, earthColorLut, applyWorld, earthReadout,
  mountEarthControls, moonViewForRegion, MOON_GRAVITY, REGIONS, earthSiteFromUrl, atlasBackHref,
  mountHideUi, loadMoonRegionStats, updateEarthLighting } from './earth.js?v=lunar-skybox-headlights-1';
import { mountLunarSimulation, earthSolarGeometry } from '../../frontend/lunar-simulation.js?v=environment-clock-2';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = id => document.getElementById(id);
const traverse = mountTraverse({
  readClock: () => simulation.clock.read(),
  advanceEnvironmentDay() {
    simulation.clock.skip(24 * 3_600_000);
    updateDriveTelemetry();
  },
  earthSites: () => Object.entries(earthMetadata?.sites ?? {}),
  async loadEarthSite(id) {
    const site = earthMetadata.sites[id];
    return analysisTile(await loadTraverseTile({ ...site, file: `earth/${site.file}` }), false);
  },
  refocus: () => { if (walkMode) renderer.domElement.focus({ preventScroll: true }); },
});
const assetVersion = 'moon-terrain-despike-2';
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.domElement.setAttribute('aria-label', 'Interactive LOLA elevation mesh');
renderer.domElement.tabIndex = 0;
document.querySelector('#scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#080d13');
try {
  const skybox = await new THREE.TextureLoader().loadAsync('./assets/lunar-skybox.webp');
  skybox.mapping = THREE.EquirectangularReflectionMapping;
  skybox.colorSpace = THREE.SRGBColorSpace;
  scene.background = skybox;
} catch (error) {
  console.error('Could not load the lunar skybox; using the plain space background.', error);
}
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 2, 900000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 25;
controls.maxDistance = 400000;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight('#e2e8ef', '#18212a', 1.35));
const keyLight = new THREE.DirectionalLight('#fff0d7', 4.0);
// Keep the sun direction fixed while its shadow camera covers the rover.
const driveSunOffset = new THREE.Vector3();
const sunOffset = new THREE.Vector3(-0.8, 0.60, 1.1).normalize().multiplyScalar(36);
keyLight.position.copy(sunOffset);
const shadowCamera = keyLight.shadow.camera;
Object.assign(shadowCamera, { left: -20, right: 20, top: 20, bottom: -20, near: 0.5, far: 80 });
shadowCamera.updateProjectionMatrix();
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.bias = -0.00012;
keyLight.shadow.normalBias = 0.025;
scene.add(keyLight, keyLight.target);
const fillLight = new THREE.DirectionalLight('#7195bd', 0.55);
fillLight.position.set(1, 0.4, -0.8);
scene.add(fillLight);

const metadata = await fetch(`./assets/lola-5m-metadata.json?v=${assetVersion}`).then(r => {
  if (!r.ok) throw new Error('Could not load DEM metadata');
  return r.json();
});
let surface = null;
let fineSurface = null;
let ground = null;
let siteMarker = null;
let viewMode = 'overview';
let viewData = null;
let currentView = null;
let verticalExaggeration = 2;
let walkMode = false;
let rover = null;
let dynamics = null;
let headlightLevel = -1;
let cameraOrbit = 0;
const DEFAULT_WALK_CAMERA_DISTANCE = 15;
const MIN_WALK_CAMERA_DISTANCE = 8;
const MAX_WALK_CAMERA_DISTANCE = 60;
let walkCameraDistance = DEFAULT_WALK_CAMERA_DISTANCE;
let enteringDrive = false;
let walkYaw = 0;
let walkPitch = 0.08;
const walkCameraTarget = new THREE.Vector3();
const roverFocus = new THREE.Vector3();
let walkCameraReady = false;
let lookPointerId = null;
let lastPointer = null;
let walkHudElapsed = 0;
const walkKeys = new Set();
const walkClock = new THREE.Clock();
const driveTelemetry = $('drive-telemetry');
driveTelemetry.open = matchMedia('(min-width: 821px)').matches;
const simulation = mountLunarSimulation(driveTelemetry, {
  driving: true,
  onSpeedChange: () => { if (walkMode) showPlaybackSpeed(); },
  onEpochChange: () => { if (walkMode) updateDriveTelemetry(); },
  onStart: () => renderer.domElement.focus({ preventScroll: true }),
  onPause() {
    walkKeys.clear();
    $('walk-pace').textContent = '0.0 km/h';
  },
  onReset: () => { if (walkMode) resetRover(); },
});
// Earth analog mode (earth.js). Earth tiles carry their own pixel size and height scale.
const earthMetadata = await loadEarthMetadata(assetVersion);
const pageParams = new URLSearchParams(location.search);
let earthRegion = pageParams.get('region') ?? 'de-gerlache-rim-2';
let earthSite = earthSiteFromUrl(pageParams); // a specific match chosen in the atlas ("Enter rover")
let moonSiteMetadata = null;
try {
  const response = await fetch(`./assets/moon-sites/moon-sites.json?v=${assetVersion}`);
  if (response.ok) moonSiteMetadata = await response.json();
} catch { /* preserve the overview and crater views if the local site tiles are absent */ }
if (moonSiteMetadata?.sites && !(earthRegion in moonSiteMetadata.sites)) {
  earthRegion = Object.keys(moonSiteMetadata.sites)[0];
}
const moonRegionStats = earthMetadata ? await loadMoonRegionStats() : null;
let lastMoonView = 'detail';
let refreshWorldToggle = null; // set once the Earth controls are mounted (end of file)
const isEarth = () => viewMode === 'earth';
const pixelSize = descriptor => descriptor.pixelSizeM ?? metadata.pixelSizeM;
const heightScale = descriptor => descriptor.heightScaleM ?? metadata.heightScaleM;
const atlasLink = document.querySelector('.back-link');
if (earthMetadata) atlasLink.href = atlasBackHref(atlasLink.href, earthRegion); // reopen this region's matches
const atlasPage = atlasLink.href;
atlasLink.addEventListener('click', () => { atlasLink.href = simulation.linkTo(atlasPage); });

const colorStops = [
  [0.00, new THREE.Color('#111c26')],
  [0.20, new THREE.Color('#233846')],
  [0.42, new THREE.Color('#53636b')],
  [0.62, new THREE.Color('#9a8f7c')],
  [0.80, new THREE.Color('#d0b78f')],
  [1.00, new THREE.Color('#f2e4c9')],
];

function elevationColor(t) {
  for (let i = 0; i < colorStops.length - 1; i++) {
    const [a, ca] = colorStops[i];
    const [b, cb] = colorStops[i + 1];
    if (t <= b) return ca.clone().lerp(cb, THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));
  }
  return colorStops.at(-1)[1].clone();
}
const colorLut = Array.from({ length: 256 }, (_, i) => elevationColor(i / 255));

async function readGrid(descriptor) {
  const response = await fetch(descriptor.url ?? `./assets/${descriptor.file}?v=${assetVersion}`);
  if (!response.ok) {
    const detail = descriptor.url ? await response.json().catch(() => null) : null;
    throw new Error(detail?.detail || `Server returned HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const expected = descriptor.width * descriptor.height * 2;
  if (buffer.byteLength !== expected) throw new Error('Terrain tile size does not match its metadata');
  const data = new Int16Array(expected / 2);
  const view = new DataView(buffer);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true);
  if (descriptor.body !== 'earth') {
    removeLunarElevationSpikes(data, descriptor);
  }
  return data;
}

// Remove isolated LOLA samples that jump sharply above or below their local terrain.
// Require the surrounding samples to agree so genuine ridges and crater rims remain intact.
function removeLunarElevationSpikes(data, descriptor) {
  const { width, height } = descriptor;
  const spacing = pixelSize(descriptor) * descriptor.stridePixels;
  const threshold = Math.max(30, spacing * 0.45) / heightScale(descriptor);
  const source = data.slice();
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const index = row * width + col;
      const neighbors = [
        source[index - width - 1], source[index - width], source[index - width + 1],
        source[index - 1], source[index + 1],
        source[index + width - 1], source[index + width], source[index + width + 1],
      ].sort((a, b) => a - b);
      const median = neighbors[4];
      const sample = source[index];
      const isolatedPeak = sample - neighbors[8] > threshold * 0.35;
      const isolatedPit = neighbors[0] - sample > threshold * 0.35;
      if (Math.abs(sample - median) > threshold && (isolatedPeak || isolatedPit)) {
        data[index] = median;
      }
    }
  }
}

function gridStats(data, scale) {
  let min = Infinity, max = -Infinity, total = 0;
  for (const raw of data) {
    const m = raw * scale;
    min = Math.min(min, m); max = Math.max(max, m); total += m;
  }
  return { min, max, mean: total / data.length };
}

function terrainHash(x, z, seed = 0) {
  let bits = Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ seed;
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}

function terrainNoise(x, z, size) {
  const ix = Math.floor(x / size), iz = Math.floor(z / size);
  const u = x / size - ix, v = z / size - iz;
  const smooth = t => t * t * (3 - 2 * t);
  const mix = THREE.MathUtils.lerp;
  return mix(mix(terrainHash(ix, iz), terrainHash(ix + 1, iz), smooth(u)),
    mix(terrainHash(ix, iz + 1), terrainHash(ix + 1, iz + 1), smooth(u)), smooth(v));
}

const colorTextureSize = 256;
const colorTileMeters = 24;
const colorPixels = new Uint8Array(colorTextureSize ** 2 * 4);

function tiledColorNoise(x, z, cells, seed) {
  const u = x * cells / colorTextureSize, v = z * cells / colorTextureSize;
  const col = Math.floor(u), row = Math.floor(v);
  const smooth = t => t * t * (3 - 2 * t);
  const mix = THREE.MathUtils.lerp;
  const hash = (i, j) => terrainHash(i % cells, j % cells, seed);
  return mix(mix(hash(col, row), hash(col + 1, row), smooth(u - col)),
    mix(hash(col, row + 1), hash(col + 1, row + 1), smooth(u - col)), smooth(v - row));
}

for (let z = 0; z < colorTextureSize; z++) {
  for (let x = 0; x < colorTextureSize; x++) {
    const patches = tiledColorNoise(x, z, 10, 3917);
    const flecks = tiledColorNoise(x, z, 72, 1279);
    const tint = tiledColorNoise(x, z, 17, 7927) - 0.5;
    const shade = 0.37 + 0.43 * patches + 0.19 * flecks;
    const index = 4 * (z * colorTextureSize + x);
    colorPixels[index] = Math.round(255 * shade);
    colorPixels[index + 1] = Math.round(255 * shade * (0.98 - 0.03 * tint));
    colorPixels[index + 2] = Math.round(255 * shade * (0.95 - 0.12 * tint));
    colorPixels[index + 3] = 255;
  }
}
const lunarColorMap = new THREE.DataTexture(colorPixels, colorTextureSize, colorTextureSize);
lunarColorMap.wrapS = lunarColorMap.wrapT = THREE.RepeatWrapping;
lunarColorMap.magFilter = THREE.LinearFilter;
lunarColorMap.minFilter = THREE.LinearMipmapLinearFilter;
lunarColorMap.generateMipmaps = true;
lunarColorMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
lunarColorMap.needsUpdate = true;

function createSurface(data, descriptor, heightOrigin = null, colorRange = null) {
  const { width, height } = descriptor;
  const spacing = pixelSize(descriptor) * descriptor.stridePixels;
  const stats = gridStats(data, heightScale(descriptor));
  const lut = descriptor.body === 'earth' ? earthColorLut : colorLut;
  const midpoint = heightOrigin ?? (stats.min + stats.max) / 2;
  const colorMin = colorRange?.min ?? stats.min;
  const colorMax = colorRange?.max ?? stats.max;
  const positions = new Float32Array(width * height * 3);
  const colors = new Float32Array(width * height * 3);
  const colorUV = spacing <= 20 ? new Float32Array(width * height * 2) : null;
  const offsetX = descriptor.offsetX ?? 0;
  const offsetZ = descriptor.offsetZ ?? 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const heightM = data[i] * heightScale(descriptor);
      const t = (heightM - colorMin) / (colorMax - colorMin || 1);
      const color = lut[THREE.MathUtils.clamp(Math.round(t * 255), 0, 255)];
      positions[3 * i] = (col - (width - 1) / 2) * spacing;
      positions[3 * i + 1] = (heightM - midpoint) * verticalExaggeration;
      positions[3 * i + 2] = ((height - 1) / 2 - row) * spacing;
      const x = positions[3 * i] + offsetX;
      const z = positions[3 * i + 2] + offsetZ;
      if (colorUV) {
        colorUV[2 * i] = x / colorTileMeters;
        colorUV[2 * i + 1] = z / colorTileMeters;
        const patches = terrainNoise(x + 811, z, 110) - 0.5;
        const mottling = terrainNoise(x - 233, z + 571, spacing * 3) - 0.5;
        const tint = terrainNoise(x + 491, z - 319, 60) - 0.5;
        const brightness = 0.075 + 0.10 * THREE.MathUtils.clamp(t, 0, 1) +
          0.040 * patches + 0.030 * mottling;
        colors[3 * i] = brightness;
        colors[3 * i + 1] = brightness * (0.97 - 0.035 * tint);
        colors[3 * i + 2] = brightness * (0.94 - 0.14 * tint);
      } else {
        colors[3 * i] = color.r;
        colors[3 * i + 1] = color.g;
        colors[3 * i + 2] = color.b;
      }
    }
  }

  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let k = 0;
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = c;
      indices[k++] = b; indices[k++] = d; indices[k++] = c;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (colorUV) geometry.setAttribute('uv', new THREE.BufferAttribute(colorUV, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  // Diffuse lighting keeps the dust matte even under grazing sunlight.
  const material = colorUV
    ? new THREE.MeshLambertMaterial({ vertexColors: true, map: lunarColorMap, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.02, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return { mesh, stats, spacing, width, height, midpoint };
}

function clearView() {
  if (surface) {
    scene.remove(surface);
    surface.geometry.dispose(); surface.material.dispose(); surface = null;
  }
  if (fineSurface) {
    scene.remove(fineSurface);
    fineSurface.geometry.dispose(); fineSurface.material.dispose(); fineSurface = null;
  }
  if (ground) { scene.remove(ground); ground.geometry.dispose(); ground.material.dispose(); ground = null; }
  if (siteMarker) { scene.remove(siteMarker); siteMarker.geometry.dispose(); siteMarker.material.dispose(); siteMarker = null; }
}

function addGround(width, depth, y) {
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.18, depth * 1.18),
    // Unlit, same colour as the sky/space behind it: a lit slab under sloped terrain made the
    // terrain look like a tilted sheet floating above a floor.
    new THREE.MeshBasicMaterial({ color: scene.background.isColor ? scene.background : '#080d13' })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = y;
  ground.visible = false; // purely decorative; hidden so sloped tiles don't look like floating sheets
  scene.add(ground);
}

function projectPolar(lat, lon) {
  const rho = 2 * metadata.referenceRadiusM * Math.tan(THREE.MathUtils.degToRad(90 + lat) / 2);
  return { x: rho * Math.sin(THREE.MathUtils.degToRad(lon)), z: rho * Math.cos(THREE.MathUtils.degToRad(lon)) }; // +z = toward 0° lon = raster up
}

function addSiteMarker(view, descriptor, data) {
  let x = 0, z = 0, heightM;
  if (viewMode !== 'overview') {
    const row = Math.floor(view.height / 2), col = Math.floor(view.width / 2);
    heightM = data[row * view.width + col] * heightScale(descriptor);
  } else {
    // Mark the De Gerlache detail-tile center on the polar-cap overview.
    const p = projectPolar(metadata.detail.centerLatitude, metadata.detail.centerLongitude);
    const stride = descriptor.stridePixels;
    const col = THREE.MathUtils.clamp(Math.round((p.x / metadata.pixelSizeM + metadata.sampleProjectionOffset) / stride), 0, view.width - 1);
    const row = THREE.MathUtils.clamp(Math.round((metadata.lineProjectionOffset - p.z / metadata.pixelSizeM) / stride), 0, view.height - 1);
    x = (col - (view.width - 1) / 2) * view.spacing;
    z = ((view.height - 1) / 2 - row) * view.spacing;
    heightM = data[row * view.width + col] * metadata.heightScaleM;
  }
  const y = (heightM - view.midpoint) * verticalExaggeration + Math.max(12, view.spacing * 0.12);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(view.spacing * 0.65, 12), 16, 10),
    new THREE.MeshBasicMaterial({ color: '#ff9f63' })
  );
  marker.position.set(x, y, z);
  scene.add(marker); siteMarker = marker;
}

const fineTerrainOffsetY = 0.15;

function terrainAt(x, z) {
  const coarse = sampleTerrain(viewData, currentView.spacing, x, z);
  const fine = viewData.fine;
  if (!fine) return coarse;
  const spacing = metadata.pixelSizeM * fine.descriptor.stridePixels;
  const localX = x - (fine.descriptor.offsetX ?? 0);
  const localZ = z - (fine.descriptor.offsetZ ?? 0);
  if (Math.abs(localX) > (fine.descriptor.width - 1) * spacing / 2 ||
      Math.abs(localZ) > (fine.descriptor.height - 1) * spacing / 2) return coarse;

  // Both meshes render here, so contact must use the upper surface.
  const detail = sampleTerrain(fine, spacing, localX, localZ);
  detail.y += fineTerrainOffsetY;
  return detail.y >= coarse.y ? detail : coarse;
}

function sampleTerrain({ data, descriptor, positions }, spacing, x, z) {
  const col = THREE.MathUtils.clamp(x / spacing + (descriptor.width - 1) / 2, 0, descriptor.width - 1);
  const row = THREE.MathUtils.clamp((descriptor.height - 1) / 2 - z / spacing, 0, descriptor.height - 1);
  const interpolate = gridTriangle(descriptor.width, descriptor.height, col, row);
  const elevation = interpolate(i => data[i]) * heightScale(descriptor);
  const y = interpolate(i => positions[3 * i + 1]);
  return { elevation, y };
}

function updateWalkCamera(dt = 1 / 60, snap = false) {
  const forward = new THREE.Vector3(Math.sin(walkYaw + cameraOrbit), 0, -Math.cos(walkYaw + cameraOrbit));
  const distance = walkCameraDistance / Math.min(1, camera.aspect);
  const horizontalDistance = distance * Math.cos(walkPitch);
  rover.updateMatrixWorld(true);
  walkCameraTarget.copy(roverFocus).applyMatrix4(rover.matrixWorld);
  const cameraX = walkCameraTarget.x - forward.x * horizontalDistance;
  const cameraZ = walkCameraTarget.z - forward.z * horizontalDistance;
  const cameraGround = terrainAt(cameraX, cameraZ);
  const cameraY = Math.max(walkCameraTarget.y + distance * Math.sin(walkPitch), cameraGround.y + 1.6);
  const cameraPosition = new THREE.Vector3(cameraX, cameraY, cameraZ);
  if (snap || !walkCameraReady) {
    camera.position.copy(cameraPosition);
    walkCameraReady = true;
  } else {
    const { running, speed } = simulation.clock.read();
    const playbackRate = isEarth() ? 1 : running ? speed : 1;
    const followResponse = 8 + Math.max(0, playbackRate - 1) * 2;
    const follow = 1 - Math.exp(-dt * followResponse);
    camera.position.lerp(cameraPosition, follow);
  }
  const cameraClearance = terrainAt(camera.position.x, camera.position.z).y + 1.6;
  if (camera.position.y < cameraClearance) camera.position.y = cameraClearance;
  camera.lookAt(walkCameraTarget);
}

function updateDriveTelemetry() {
  if (isEarth()) {
    // Driving the Earth analog: keep showing conditions at the paired Moon site (its centre).
    const moon = REGIONS[earthRegion];
    if (moon) simulation.updateRoverPosition(moon.lat, moon.lon, moonRegionStats?.[earthRegion]?.meanSlope,
      `Mean slope, Moon site (20 km LOLA)`);
    return;
  }
  const { x, z } = rover.position;
  const { descriptor, fine } = viewData;
  const spacing = currentView.spacing;
  // Invert prepare_lola_3d.py's south-polar stereographic pixel mapping.
  const col = descriptor.firstColumn + (descriptor.width - 1) * descriptor.stridePixels / 2;
  const row = descriptor.firstRow + (descriptor.height - 1) * descriptor.stridePixels / 2;
  // Same convention as prepare_lola_3d.py / GDAL: y toward 0° longitude = raster up = +z.
  const east = (col - metadata.sampleProjectionOffset) * metadata.pixelSizeM + x;
  const north = (metadata.lineProjectionOffset - row) * metadata.pixelSizeM + z;
  const lat = -90 + THREE.MathUtils.radToDeg(2 * Math.atan(Math.hypot(east, north) / (2 * metadata.referenceRadiusM)));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(east, north));

  // Use one unexaggerated LOLA grid for the whole slope stencil.
  const fineGrid = fine?.descriptor;
  const fineX = x - (fineGrid?.offsetX ?? 0);
  const fineZ = z - (fineGrid?.offsetZ ?? 0);
  const fineSpacing = metadata.pixelSizeM * (fineGrid?.stridePixels ?? 1);
  const useFine = fineGrid && Math.abs(fineX) + fineSpacing <= (fineGrid.width - 1) * fineSpacing / 2
    && Math.abs(fineZ) + fineSpacing <= (fineGrid.height - 1) * fineSpacing / 2;
  const step = useFine ? fineSpacing : spacing;
  const grid = useFine ? fine : viewData;
  const px = useFine ? fineX : x;
  const pz = useFine ? fineZ : z;
  let slope;
  if (Math.abs(px) + step <= (grid.descriptor.width - 1) * step / 2
      && Math.abs(pz) + step <= (grid.descriptor.height - 1) * step / 2) {
    const elevation = (sx, sz) => sampleTerrain(grid, step, sx, sz).elevation;
    const riseX = elevation(px + step, pz) - elevation(px - step, pz);
    const riseZ = elevation(px, pz + step) - elevation(px, pz - step);
    slope = THREE.MathUtils.radToDeg(Math.atan(Math.hypot(riseX, riseZ) / (2 * step)));
  }
  const environment = simulation.updateRoverPosition(lat, lon, slope, `Local LOLA slope (${step} m grid)`);
  if (!environment) return;
  const longitude = THREE.MathUtils.degToRad(lon);
  const { east: solarEast, north: solarNorth, up } = environment;
  driveSunOffset.set(
    solarEast * Math.cos(longitude) + solarNorth * Math.sin(longitude),
    up,
    solarEast * Math.sin(longitude) - solarNorth * Math.cos(longitude),
  ).multiplyScalar(36);
  keyLight.intensity = up > 0 ? 4 : 0;
}

function showPlaybackSpeed() {
  const { running, speed } = simulation.clock.read();
  const rate = isEarth() ? 1 : running ? speed : 0;
  const kmh = Math.hypot(dynamics.vx, dynamics.vz) * 3.6 * rate;
  $('walk-pace').textContent = `${kmh.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km/h`;
}

const recordTraversePosition = (x, z) => traverse.record(x, z);

function updateWalker(simulatedDt, frameDt) {
  const axis = (a, b, c, d) => Number(walkKeys.has(a) || walkKeys.has(b)) -
    Number(walkKeys.has(c) || walkKeys.has(d));
  dynamics.update(simulatedDt, axis('w', 'arrowup', 's', 'arrowdown'),
    axis('d', 'arrowright', 'a', 'arrowleft'), walkKeys.has(' '),
    (currentView.width - 1) * currentView.spacing / 2 - 4,
    (currentView.height - 1) * currentView.spacing / 2 - 4, recordTraversePosition);
  walkYaw = dynamics.yaw;
  updateWalkCamera(frameDt);
  walkHudElapsed += frameDt;
  if (walkHudElapsed > 0.12) {
    const distance = dynamics.distance;
    $('walk-distance').textContent = distance < 1000 ? `${distance.toFixed(0)} m` : `${(distance / 1000).toFixed(2)} km`;
    showPlaybackSpeed();
    $('walk-ground').textContent = `${Math.round(terrainAt(rover.position.x, rover.position.z).elevation).toLocaleString()} m`;
    updateDriveTelemetry();
    walkHudElapsed = 0;
  }
}

function resetRover(spawn = null) {
  // spawn keeps the rover's spot and heading when switching between Moon and Earth.
  const x = spawn?.x ?? (viewMode === 'crater' ? metadata.craterSpawn.offsetX : 0);
  const z = spawn?.z ?? (viewMode === 'crater' ? metadata.craterSpawn.offsetZ : 0);
  walkYaw = spawn?.yaw ?? (viewMode === 'crater' ? Math.PI / 4 : 0);
  walkPitch = 0.16;
  cameraOrbit = 0;
  walkCameraDistance = DEFAULT_WALK_CAMERA_DISTANCE;
  dynamics = new RoverDynamics(rover, terrainAt, x, z, walkYaw);
  beginTraverse(x, z);
  $('walk-distance').textContent = '0 m';
  $('walk-pace').textContent = '0.0 km/h';
  $('walk-ground').textContent = `${Math.round(terrainAt(x, z).elevation).toLocaleString()} m`;
  camera.near = 0.25;
  camera.updateProjectionMatrix();
  updateWalkCamera(0, true);
  updateDriveTelemetry();
}

function enterWalkMode(spawn = null) {
  scene.add(rover);
  keyLight.castShadow = true;
  if (siteMarker) siteMarker.visible = false;
  walkMode = true;
  controls.enabled = false;
  document.querySelector('.app-shell').classList.add('walk-mode');
  $('walk-hud').hidden = false;
  const earth = isEarth();
  simulation.setWorld(earth ? 'earth' : 'moon', earth ? {
    lat: viewData?.descriptor.centerLatitude,
    lon: viewData?.descriptor.centerLongitude,
  } : null);
  driveTelemetry.hidden = false; // on Earth it shows the paired Moon site
  const paceButton = $('walk-pace').closest('button');
  paceButton.dataset.method = earth ? 'earthVelocity' : 'velocity';
  paceButton.querySelector('span').textContent = earth ? 'SPEED' : 'PLAYBACK SPEED';
  $('walk-ground').closest('button').dataset.method = earth ? 'earthGround' : 'ground';
  simulation.clock.start();
  renderer.domElement.focus({ preventScroll: true });
  resetRover(spawn);
}

function setHeadlightLevel(level) {
  const next = THREE.MathUtils.clamp(level, 0, 1);
  if (Math.abs(next - headlightLevel) < 0.005) return;
  headlightLevel = next;
  for (const { light, lensMaterial } of rover?.userData.headlights ?? []) {
    light.intensity = 3200 * next;
    lensMaterial.emissiveIntensity = 3 * next;
  }
}

function exitWalkMode() {
  if (!walkMode) return;
  walkMode = false;
  traverse.leave();
  walkKeys.clear();
  lookPointerId = null;
  lastPointer = null;
  controls.enabled = true;
  if (rover) scene.remove(rover);
  keyLight.castShadow = false;
  keyLight.intensity = 4;
  keyLight.position.copy(sunOffset);
  keyLight.target.position.set(0, 0, 0);
  if (siteMarker) siteMarker.visible = true;
  document.querySelector('.app-shell').classList.remove('walk-mode');
  $('walk-hud').hidden = true;
  driveTelemetry.hidden = true;
  simulation.pause();
  $('walk-crosshair').hidden = true;
  if (currentView) frameView(currentView);
}

function updateReadout(view, descriptor) {
  const unit = value => `${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;
  $('min-height').textContent = unit(view.stats.min);
  $('max-height').textContent = unit(view.stats.max);
  $('relief').textContent = `${(view.stats.max - view.stats.min).toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;
  $('walk-button').hidden = false;
  document.querySelector('.walk-caption').hidden = false;
  if (isEarth()) {
    earthReadout($, view, descriptor);
  } else if (viewMode === 'moon-site') {
    const lon = `${Math.abs(descriptor.centerLongitude).toFixed(2)}° ${descriptor.centerLongitude < 0 ? 'W' : 'E'}`;
    $('site-name').textContent = descriptor.name;
    $('site-coords').textContent = `${Math.abs(descriptor.centerLatitude).toFixed(2)}° S · ${lon}`;
    $('site-tag').textContent = 'LANDING SITE';
    $('view-note').textContent = `LOLA 20 M PIXELS · ${(descriptor.width * view.spacing / 1000).toFixed(2)} × ${(descriptor.height * view.spacing / 1000).toFixed(2)} KM WINDOW`;
    $('walk-button').innerHTML = '<span class="walk-button-mark" aria-hidden="true">↗</span> Drive this landing site';
    document.querySelector('.walk-caption').textContent = 'Lunar rover · LOLA terrain at true scale';
  } else if (viewMode === 'detail') {
    $('site-name').textContent = 'De Gerlache Rim 2';
    $('site-coords').textContent = '88.20° S · 64.40° W';
    $('site-tag').textContent = 'LOCAL TILE';
    $('view-note').textContent = `NATIVE 5 M PIXELS · ${(descriptor.width * metadata.pixelSizeM / 1000).toFixed(2)} × ${(descriptor.height * metadata.pixelSizeM / 1000).toFixed(2)} KM WINDOW`;
    $('walk-button').innerHTML = '<span class="walk-button-mark" aria-hidden="true">↗</span> Drive the surface';
    document.querySelector('.walk-caption').textContent = 'Lunar rover · true terrain scale';
  } else if (viewMode === 'crater') {
    $('site-name').textContent = 'Polar crater floor';
    $('site-coords').textContent = `${Math.abs(metadata.crater.centerLatitude).toFixed(2)}° S · ${metadata.crater.centerLongitude.toFixed(1)}° E`;
    $('site-tag').textContent = 'CRATER FLOOR';
    $('view-note').textContent = `CRATER VIEW · ${(descriptor.width * view.spacing / 1000).toFixed(2)} KM WINDOW · 5 M DETAIL AROUND THE EXPLORER`;
    $('walk-button').innerHTML = '<span class="walk-button-mark" aria-hidden="true">↗</span> Drive the crater';
    document.querySelector('.walk-caption').textContent = 'Lunar rover · crater slope · 20 m terrain with 5 m detail';
  } else {
    $('site-name').textContent = 'Large polar crater rim';
    $('site-coords').textContent = 'Camera starts on the rim';
    $('site-tag').textContent = 'CAP VIEW';
    $('view-note').textContent = `POLAR OVERVIEW · ${(view.spacing / 1000).toFixed(2)} KM SAMPLES · STARTING AT CRATER RIM`;
    $('walk-button').innerHTML = '<span class="walk-button-mark" aria-hidden="true">↗</span> Drive inside the crater';
    document.querySelector('.walk-caption').textContent = 'Lunar rover · starts on the inner crater slope';
  }
}

function frameView(view) {
  if (viewMode === 'overview') {
    // Start just above the northern rim of the large basin in the overview,
    // looking diagonally across its floor toward the far rim.
    const rim = { col: 648, row: 140 };
    const basin = { col: 748, row: 220 };
    const point = ({ col, row }) => {
      const x = (col - (view.width - 1) / 2) * view.spacing;
      const z = ((view.height - 1) / 2 - row) * view.spacing;
      const h = viewData.data[row * view.width + col] * metadata.heightScaleM;
      const y = (h - view.midpoint) * verticalExaggeration;
      return new THREE.Vector3(x, y, z);
    };
    const edge = point(rim);
    const floor = point(basin);
    camera.position.set(edge.x, edge.y + 2200, edge.z);
    controls.target.set(floor.x, floor.y + 500, floor.z);
    camera.near = 2;
    camera.far = 900000;
    camera.updateProjectionMatrix();
    controls.minDistance = 1500;
    controls.maxDistance = 400000;
    controls.update();
    return;
  }
  const extent = Math.max(view.width * view.spacing, view.height * view.spacing);
  const height = Math.max(view.stats.max - view.stats.min, 100) * verticalExaggeration;
  const visibleAngle = THREE.MathUtils.degToRad(camera.fov) / 2;
  const aspectFit = Math.max(0.45, Math.min(1, camera.aspect));
  const distance = Math.max(extent / (2 * Math.tan(visibleAngle) * aspectFit) * 1.28, height * 2.3, 300);
  const targetY = 0;
  controls.target.set(0, targetY, 0);
  camera.position.set(distance * 0.63, distance * 0.77, distance * 0.84);
  camera.near = Math.max(1, distance / 10000);
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(10, extent * 0.13);
  controls.maxDistance = distance * 5;
  controls.update();
}

function moonSiteDescriptor(region) {
  const site = moonSiteMetadata?.sites?.[region];
  if (!site) return null;
  return {
    ...site,
    width: moonSiteMetadata.width,
    height: moonSiteMetadata.height,
    stridePixels: moonSiteMetadata.stridePixels,
    pixelSizeM: moonSiteMetadata.pixelSizeM,
    heightScaleM: moonSiteMetadata.heightScaleM,
    body: 'moon',
    file: `moon-sites/${site.file}`,
  };
}

let pendingTraverseTile;
function loadTraverseTile(descriptor) {
  const key = descriptor.url ?? descriptor.file;
  if (pendingTraverseTile?.key === key) return pendingTraverseTile.promise;
  const promise = readGrid(descriptor).then(data => ({ descriptor, data })).catch(error => {
    if (pendingTraverseTile?.promise === promise) pendingTraverseTile = null;
    throw error;
  });
  pendingTraverseTile = { key, promise };
  return promise;
}

function analysisTile(grid, lunar) {
  return traverseTile(grid, pixelSize(grid.descriptor) * grid.descriptor.stridePixels,
    heightScale(grid.descriptor), lunar);
}

function beginTraverse(x, z) {
  const world = isEarth() ? 'earth' : 'moon';
  let reason;
  if (earthRegion !== 'de-gerlache-rim-2') {
    reason = 'Paired analysis is unavailable for this region. Traverse analysis currently supports de Gerlache Rim 2.';
  } else if (!earthMetadata?.regions?.[earthRegion]) {
    reason = 'Paired analysis is unavailable: the Earth analog tile is missing.';
  } else if (!isEarth() && !['detail', 'moon-site'].includes(viewMode)) {
    reason = 'Paired analysis requires a dedicated de Gerlache Rim 2 view. You can still drive this terrain.';
  }
  const active = viewData;
  const region = earthRegion;
  const paired = reason ? null : isEarth() ? moonSiteDescriptor(region)
    : earthDescriptor(earthMetadata, region, earthSite);
  if (!reason && !paired) reason = 'Paired analysis is unavailable: the dedicated lunar tile is missing.';
  traverse.start(world, { x, z }, reason, async () => {
    const other = await loadTraverseTile(paired);
    const earth = world === 'earth' ? active : other;
    const moon = world === 'moon' ? active : other;
    const namedMoon = { ...moon, descriptor: { ...moon.descriptor, name: REGIONS[region].name } };
    return { earth: analysisTile(earth, false), moon: analysisTile(namedMoon, true) };
  });
}

let viewRequest = 0;
async function showView(mode) {
  const request = ++viewRequest;
  viewMode = mode;
  $('loading').classList.add('visible');
  $('error-message').hidden = true;
  document.querySelectorAll('.view-button').forEach(button => {
    const active = button.dataset.view === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  try {
    const key = mode === 'earth' ? `earth:${earthRegion}:${earthSite ? `${earthSite.lat},${earthSite.lon}` : 'top'}`
      : mode === 'moon-site' ? `moon:${earthRegion}` : mode;
    if (!viewData || viewData.key !== key) {
      const descriptorForMode = mode === 'moon-site' ? moonSiteDescriptor(earthRegion)
        : mode === 'earth' ? earthDescriptor(earthMetadata, earthRegion, earthSite)
        : mode === 'detail' ? metadata.detail : mode === 'crater' ? metadata.crater : metadata.overview;
      if (!descriptorForMode) throw new Error(`LOLA terrain tile is unavailable for ${earthRegion}`);
      const descriptor = descriptorForMode;
      const data = await readGrid(descriptor);
      const fine = mode === 'crater'
        ? { descriptor: metadata.craterDetail, data: await readGrid(metadata.craterDetail) }
        : null;
      if (request !== viewRequest) return false;
      viewData = { mode, key, descriptor, data, fine };
    }
    if (mode !== 'earth') lastMoonView = mode;
    applyWorld(scene, mode === 'earth' ? 'earth' : 'moon', { keyLight, fillLight });
    setGravity(mode === 'earth' ? earthMetadata.gravity : MOON_GRAVITY);
    refreshWorldToggle?.();
    clearView();
    const view = createSurface(viewData.data, viewData.descriptor);
    viewData.positions = view.mesh.geometry.attributes.position.array;
    currentView = view;
    surface = view.mesh;
    scene.add(surface);
    if (viewData.fine) {
      const detail = createSurface(viewData.fine.data, viewData.fine.descriptor, view.midpoint, view.stats);
      fineSurface = detail.mesh;
      viewData.fine.positions = fineSurface.geometry.attributes.position.array;
      fineSurface.position.x = viewData.fine.descriptor.offsetX ?? 0;
      fineSurface.position.z = viewData.fine.descriptor.offsetZ ?? 0;
      fineSurface.position.y += fineTerrainOffsetY;
      fineSurface.renderOrder = 1;
      scene.add(fineSurface);
    }
    const extentX = view.width * view.spacing;
    const extentZ = view.height * view.spacing;
    const baseY = (view.stats.min - view.midpoint) * verticalExaggeration - Math.max(50, (view.stats.max - view.stats.min) * 0.04);
    addGround(extentX, extentZ, baseY);
    addSiteMarker(view, viewData.descriptor, viewData.data);
    updateReadout(view, viewData.descriptor);
    frameView(view);
    return true;
  } catch (error) {
    if (request !== viewRequest) return false;
    console.error(error);
    $('error-message').textContent = mode === 'earth' && earthSite
      ? `Could not load elevation for ${earthSite.name}. Make sure the backend is running and elevation data is available for this location. ${error.message}`
      : 'The elevation tile could not be loaded. Serve this folder over HTTP and check that the assets are present.';
    $('error-message').hidden = false;
    return false;
  } finally {
    if (request === viewRequest) $('loading').classList.remove('visible');
  }
}

document.querySelectorAll('.view-button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('walk-button').addEventListener('click', async () => {
  if (enteringDrive || switchingWorld) return;
  enteringDrive = true;
  $('walk-button').disabled = true;
  $('error-message').hidden = true;
  $('loading').classList.add('visible');
  try {
    if (!rover) {
      rover = await loadRover();
      new THREE.Box3().setFromObject(rover).getCenter(roverFocus);
      rover.worldToLocal(roverFocus);
      rover.traverse(part => {
        if (!part.isMesh) return;
        part.castShadow = true;
        part.receiveShadow = true;
      });
    }
    verticalExaggeration = 1;
    $('exaggeration').value = 1;
    $('exag-value').textContent = '1×';
    if (await showView(viewMode === 'overview' ? 'crater' : viewMode)) enterWalkMode();
  } catch (error) {
    console.error(error);
    $('error-message').textContent = `The rover model could not load: ${error?.message ?? 'unknown loader error'}`;
    $('error-message').hidden = false;
  } finally {
    $('loading').classList.remove('visible');
    enteringDrive = false;
    $('walk-button').disabled = false;
  }
});
$('walk-exit').addEventListener('click', exitWalkMode);
$('walk-hud').addEventListener('pointerdown', event => event.stopPropagation());

renderer.domElement.addEventListener('pointerdown', event => {
  if (!walkMode || event.button !== 0) return;
  lookPointerId = event.pointerId;
  lastPointer = [event.clientX, event.clientY];
  renderer.domElement.setPointerCapture(event.pointerId);
  event.preventDefault();
});
renderer.domElement.addEventListener('pointermove', event => {
  if (!walkMode || event.pointerId !== lookPointerId || !lastPointer) return;
  const dx = event.clientX - lastPointer[0];
  const dy = event.clientY - lastPointer[1];
  cameraOrbit += dx * 0.0042;
  walkPitch = THREE.MathUtils.clamp(walkPitch - dy * 0.0035, -0.3, 0.7);
  lastPointer = [event.clientX, event.clientY];
});
function endLook(event) {
  if (event.pointerId !== lookPointerId) return;
  lookPointerId = null;
  lastPointer = null;
}
renderer.domElement.addEventListener('pointerup', endLook);
renderer.domElement.addEventListener('pointercancel', endLook);
renderer.domElement.addEventListener('wheel', event => {
  if (!walkMode) return;
  walkCameraDistance = THREE.MathUtils.clamp(
    walkCameraDistance * Math.exp(event.deltaY * 0.001),
    MIN_WALK_CAMERA_DISTANCE,
    MAX_WALK_CAMERA_DISTANCE
  );
  updateWalkCamera();
  event.preventDefault();
}, { passive: false });

const movementKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);
addEventListener('keydown', event => {
  if (!walkMode || traverse.reportOpen) return;
  const key = event.key.toLowerCase();
  if (document.querySelector('.lunar-method-dialog[open]')) return;
  if (key === 'escape') { exitWalkMode(); return; }
  if (driveTelemetry.contains(event.target) || event.target.closest?.('button, a, input, select, summary')) return;
  if (key === 't' && !event.repeat) { toggleWorld(); return; }
  if (key === 'r' && !event.repeat) simulation.reset({ resume: simulation.clock.read().running });
  if (movementKeys.has(key)) { walkKeys.add(key); event.preventDefault(); }
});
addEventListener('keyup', event => walkKeys.delete(event.key.toLowerCase()));
addEventListener('blur', () => walkKeys.clear());

$('exaggeration').addEventListener('input', event => {
  verticalExaggeration = Number(event.target.value);
  $('exag-value').textContent = `${verticalExaggeration.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}×`;
  if (viewData) showView(viewMode);
});
$('reset-view').addEventListener('click', () => viewData && showView(viewMode));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (walkMode) updateWalkCamera();
  else if (currentView) frameView(currentView);
});

renderer.setAnimationLoop(() => {
  const frameSeconds = walkClock.getDelta();
  const dt = Math.min(frameSeconds, 0.05);
  if (walkMode && !traverse.reportOpen) {
    const running = simulation.clock.running;
    // Keep simulated UTC at the selected rate even when rendering runs slowly.
    // Bound only the physics step to preserve the rover's contact stability.
    simulation.clock.advance(frameSeconds * 1000);
    const earth = isEarth();
    if (earth) {
      const descriptor = viewData?.descriptor;
      const sun = descriptor && earthSolarGeometry(simulation.clock.read().utc,
        descriptor.centerLatitude, descriptor.centerLongitude);
      if (sun) {
        sunOffset.set(sun.east, sun.up, -sun.north).normalize().multiplyScalar(36);
        updateEarthLighting(scene, sun.elevation, { hemi: scene.children.find(o => o.isHemisphereLight), keyLight, fillLight });
        setHeadlightLevel(1 - THREE.MathUtils.smoothstep(sun.elevation, -8, -2));
      }
      else setHeadlightLevel(1);
      updateWalker(dt, dt);
    }
    else {
      setHeadlightLevel(1); // lunar rover lamps remain on throughout the Moon simulation
      if (running) updateWalker(dt * simulation.clock.read().speed, dt);
      else updateWalkCamera(dt);
    }
    traverse.tick();
    keyLight.target.position.copy(rover.position);
    keyLight.position.copy(rover.position).add(earth ? sunOffset : driveSunOffset);
  } else if (!walkMode) {
    controls.update();
  }
  renderer.render(scene, camera);
});

// ---- Earth analog mode: Moon ⇄ Earth switch (UI lives in earth.js) ----
let switchingWorld = false;
async function toggleWorld() {
  if (!earthMetadata || switchingWorld || enteringDrive || traverse.reportOpen) return;
  switchingWorld = true;
  try {
    const driving = walkMode && rover;
    // Keep the rover's spot (metres from tile centre) and heading across the switch.
    const spawn = driving ? { x: rover.position.x, z: rover.position.z, yaw: walkYaw } : null;
    const target = isEarth() ? (moonViewForRegion(earthRegion) ?? lastMoonView) : 'earth';
    if (driving) exitWalkMode();
    if (!(await showView(target))) return;
    if (driving) {
      const limitX = (currentView.width - 1) * currentView.spacing / 2 - 6;
      const limitZ = (currentView.height - 1) * currentView.spacing / 2 - 6;
      spawn.x = THREE.MathUtils.clamp(spawn.x, -limitX, limitX);
      spawn.z = THREE.MathUtils.clamp(spawn.z, -limitZ, limitZ);
      enterWalkMode(spawn);
    }
  } finally {
    switchingWorld = false;
  }
}

if (earthMetadata) {
  const refresh = mountEarthControls(earthMetadata, {
    region: earthRegion,
    onShowEarth: () => showView('earth'),
    onShowMoon: () => showView(moonViewForRegion(earthRegion)),
    async onRegion(region) {
      const driving = walkMode;
      const mode = isEarth() ? 'earth' : moonViewForRegion(region);
      if (driving) exitWalkMode();
      earthRegion = region;
      earthSite = null; // picker → that region's top match
      if (await showView(mode) && driving) enterWalkMode();
    },
    onToggle: toggleWorld,
  });
  if (!(earthRegion in earthMetadata.regions)) earthRegion = Object.keys(earthMetadata.regions)[0];
  refreshWorldToggle = () => refresh({
    earth: isEarth(),
    region: earthRegion,
    moonViewName: REGIONS[earthRegion]?.name ?? 'polar crater floor',
    site: earthSite,
    view: viewMode,
  });
  mountHideUi();
}

// From the atlas: ?world=earth opens the Earth analog; &drive=1 puts the rover straight on it.
// A region URL opens that candidate's terrain when the relevant data is available.
const initialView = pageParams.get('world') === 'earth' && earthMetadata ? 'earth'
  : pageParams.has('region') && (earthMetadata || moonSiteMetadata?.sites?.[earthRegion])
    ? moonViewForRegion(earthRegion) : 'overview';
showView(initialView).then(ok => {
  if (ok && pageParams.get('drive') === '1') $('walk-button').click();
});
