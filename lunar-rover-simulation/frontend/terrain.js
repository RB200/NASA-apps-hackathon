import { loadRover, RoverDynamics } from './rover.js?v=ground-contact';
import { mountLunarSimulation } from '../../frontend/lunar-simulation.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = id => document.getElementById(id);
const assetVersion = 'crater-lod-3';
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
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 2, 900000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 25;
controls.maxDistance = 400000;
controls.maxPolarAngle = Math.PI * 0.49;

const ambientLight = new THREE.HemisphereLight('#e2e8ef', '#18212a', 1.35);
scene.add(ambientLight);
const keyLight = new THREE.DirectionalLight('#fff0d7', 4.0);
// Keep the sun direction fixed while its shadow camera covers the rover.
const sunOffset = new THREE.Vector3(-0.8, 0.60, 1.1).normalize().multiplyScalar(36);
const sunDirection = sunOffset.clone().normalize();
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(260, 24, 16),
  new THREE.MeshBasicMaterial({ color: '#fff9e8', fog: false, toneMapped: false })
);
sun.visible = false;
scene.add(sun);
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
const regionSelect = $('region-select');
for (const [id, region] of Object.entries(metadata.regions)) {
  regionSelect.add(new Option(region.name, id));
}
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
let cameraOrbit = 0;
let enteringDrive = false;
let walkYaw = 0;
let walkPitch = 0.08;
const roverFocus = new THREE.Vector3();
const walkCameraTarget = new THREE.Vector3();
let walkCameraReady = false;
let lookPointerId = null;
let lastPointer = null;
let walkHudElapsed = 0;
const walkKeys = new Set();
const walkClock = new THREE.Clock();
const driveTelemetry = $('drive-telemetry');
driveTelemetry.open = matchMedia('(min-width: 821px)').matches;
const simulation = mountLunarSimulation(driveTelemetry, {
  onStart: () => renderer.domElement.focus({ preventScroll: true }),
  onPause() {
    walkKeys.clear();
    $('walk-pace').textContent = '0.0 km/h';
  },
  onReset: () => { if (walkMode) resetRover(); },
});
const atlasLink = document.querySelector('.back-link');
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
  const response = await fetch(`./assets/${descriptor.file}?v=${assetVersion}`);
  if (!response.ok) throw new Error(`Could not load ${descriptor.file}`);
  const buffer = await response.arrayBuffer();
  const expected = descriptor.width * descriptor.height * 2;
  if (buffer.byteLength !== expected) throw new Error('Terrain tile size does not match its metadata');
  const data = new Int16Array(expected / 2);
  const view = new DataView(buffer);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true);
  return data;
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

// Synthetic relief at scales the underlying grid can resolve.
function terrainHeightOffset(x, z, spacing) {
  if (spacing > 20) return 0;
  const scale = spacing / 5;
  const roughness = 1.9 * (terrainNoise(x, z, 16 * scale) - 0.5) +
    1.45 * (terrainNoise(x, z, 39 * scale) - 0.5);
  const cellSize = 95 * scale;
  const ix = Math.floor(x / cellSize), iz = Math.floor(z / cellSize);
  const radius = (12 + 14 * terrainHash(ix, iz, 317)) * scale;
  const centerX = (ix + 0.36 + 0.28 * terrainHash(ix, iz, 521)) * cellSize;
  const centerZ = (iz + 0.36 + 0.28 * terrainHash(ix, iz, 719)) * cellSize;
  const distance = Math.hypot(x - centerX, z - centerZ) / radius;
  const bowl = Math.max(0, 1 - distance * distance);
  const rim = Math.max(0, 1 - Math.abs(distance - 1) / 0.25);
  return roughness + (0.42 * rim - 1.45 * bowl * bowl) * Math.sqrt(scale);
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
  const spacing = metadata.pixelSizeM * descriptor.stridePixels;
  const stats = gridStats(data, metadata.heightScaleM);
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
      const heightM = data[i] * metadata.heightScaleM;
      const t = (heightM - colorMin) / (colorMax - colorMin || 1);
      const color = colorLut[THREE.MathUtils.clamp(Math.round(t * 255), 0, 255)];
      positions[3 * i] = (col - (width - 1) / 2) * spacing;
      positions[3 * i + 1] = (heightM - midpoint) * verticalExaggeration;
      positions[3 * i + 2] = ((height - 1) / 2 - row) * spacing;
      const x = positions[3 * i] + offsetX;
      const z = positions[3 * i + 2] + offsetZ;
      const relief = terrainHeightOffset(x, z, spacing);
      positions[3 * i + 1] += relief;
      if (colorUV) {
        colorUV[2 * i] = x / colorTileMeters;
        colorUV[2 * i + 1] = z / colorTileMeters;
        const patches = terrainNoise(x + 811, z, 110) - 0.5;
        const mottling = terrainNoise(x - 233, z + 571, spacing * 3) - 0.5;
        const tint = terrainNoise(x + 491, z - 319, 60) - 0.5;
        const brightness = 0.075 + 0.10 * THREE.MathUtils.clamp(t, 0, 1) +
          0.040 * patches + 0.030 * mottling + relief * 0.008;
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
    new THREE.MeshStandardMaterial({ color: '#0c131a', roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = y;
  scene.add(ground);
}

function projectPolar(lat, lon) {
  const rho = 2 * metadata.referenceRadiusM * Math.tan(THREE.MathUtils.degToRad(90 + lat) / 2);
  return { x: rho * Math.sin(THREE.MathUtils.degToRad(lon)), z: -rho * Math.cos(THREE.MathUtils.degToRad(lon)) };
}

function addSiteMarker(view, descriptor, data) {
  let x = 0, z = 0, heightM;
  if (viewMode !== 'overview') {
    const row = Math.floor(view.height / 2), col = Math.floor(view.width / 2);
    heightM = data[row * view.width + col] * metadata.heightScaleM;
  } else {
    // Mark the De Gerlache detail-tile center on the polar-cap overview.
    const p = projectPolar(metadata.detail.centerLatitude, metadata.detail.centerLongitude);
    const stride = descriptor.stridePixels;
    const col = THREE.MathUtils.clamp(Math.round((p.x / metadata.pixelSizeM + metadata.sampleProjectionOffset - 1) / stride), 0, view.width - 1);
    const row = THREE.MathUtils.clamp(Math.round((metadata.lineProjectionOffset - 1 - p.z / metadata.pixelSizeM) / stride), 0, view.height - 1);
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
  const c0 = Math.floor(col), r0 = Math.floor(row);
  const c1 = Math.min(c0 + 1, descriptor.width - 1), r1 = Math.min(r0 + 1, descriptor.height - 1);
  const tx = col - c0, ty = row - r0;
  const a = data[r0 * descriptor.width + c0] * metadata.heightScaleM;
  const b = data[r0 * descriptor.width + c1] * metadata.heightScaleM;
  const c = data[r1 * descriptor.width + c0] * metadata.heightScaleM;
  const d = data[r1 * descriptor.width + c1] * metadata.heightScaleM;
  // Use the same triangle and vertex offsets as the rendered mesh.
  const interpolate = (a, b, c, d) => tx + ty <= 1
    ? a + (b - a) * tx + (c - a) * ty
    : d + (c - d) * (1 - tx) + (b - d) * (1 - ty);
  const elevation = interpolate(a, b, c, d);
  const yAt = (col, row) => positions[3 * (row * descriptor.width + col) + 1];
  const y = interpolate(yAt(c0, r0), yAt(c1, r0), yAt(c0, r1), yAt(c1, r1));
  return { elevation, y };
}

function updateWalkCamera(dt = 1 / 60, snap = false) {
  const forward = new THREE.Vector3(Math.sin(walkYaw + cameraOrbit), 0, -Math.cos(walkYaw + cameraOrbit));
  const cameraDistance = 15 / Math.min(1, camera.aspect);
  const horizontalDistance = cameraDistance * Math.cos(walkPitch);
  rover.updateMatrixWorld(true);
  walkCameraTarget.copy(roverFocus).applyMatrix4(rover.matrixWorld);
  const cameraX = walkCameraTarget.x - forward.x * horizontalDistance;
  const cameraZ = walkCameraTarget.z - forward.z * horizontalDistance;
  const cameraGround = terrainAt(cameraX, cameraZ);
  const cameraY = Math.max(walkCameraTarget.y + cameraDistance * Math.sin(walkPitch), cameraGround.y + 1.6);
  const cameraPosition = new THREE.Vector3(cameraX, cameraY, cameraZ);
  if (snap || !walkCameraReady) {
    camera.position.copy(cameraPosition);
    walkCameraReady = true;
  } else {
    const follow = 1 - Math.exp(-dt * 8);
    camera.position.lerp(cameraPosition, follow);
  }
  camera.position.y = Math.max(camera.position.y, terrainAt(camera.position.x, camera.position.z).y + 1.6);
  camera.lookAt(walkCameraTarget);
}

function updateDriveTelemetry() {
  const { x, z } = rover.position;
  const { descriptor, fine } = viewData;
  const spacing = currentView.spacing;
  // Invert prepare_lola_3d.py's south-polar stereographic pixel mapping.
  const col = descriptor.firstColumn + (descriptor.width - 1) * descriptor.stridePixels / 2;
  const row = descriptor.firstRow + (descriptor.height - 1) * descriptor.stridePixels / 2;
  const east = (col + 1 - metadata.sampleProjectionOffset) * metadata.pixelSizeM + x;
  const north = (row + 1 - metadata.lineProjectionOffset) * metadata.pixelSizeM - z;
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
  simulation.updateRoverPosition(lat, lon, slope, `Local LOLA slope (${step} m grid)`);
}

function updateWalker(dt) {
  const axis = (a, b, c, d) => Number(walkKeys.has(a) || walkKeys.has(b)) -
    Number(walkKeys.has(c) || walkKeys.has(d));
  const speed = dynamics.update(dt, axis('w', 'arrowup', 's', 'arrowdown'),
    axis('d', 'arrowright', 'a', 'arrowleft'), walkKeys.has(' '),
    (currentView.width - 1) * currentView.spacing / 2 - 4,
    (currentView.height - 1) * currentView.spacing / 2 - 4);
  walkYaw = dynamics.yaw;
  updateWalkCamera(dt);
  walkHudElapsed += dt;
  if (walkHudElapsed > 0.12) {
    const distance = dynamics.distance;
    $('walk-distance').textContent = distance < 1000 ? `${distance.toFixed(0)} m` : `${(distance / 1000).toFixed(2)} km`;
    $('walk-pace').textContent = `${(speed * 3.6).toFixed(1)} km/h`;
    $('walk-ground').textContent = `${Math.round(terrainAt(rover.position.x, rover.position.z).elevation).toLocaleString()} m`;
    updateDriveTelemetry();
    walkHudElapsed = 0;
  }
}

function resetRover() {
  const x = viewMode === 'crater' ? metadata.craterSpawn.offsetX : 0;
  const z = viewMode === 'crater' ? metadata.craterSpawn.offsetZ : 0;
  walkYaw = viewMode === 'crater' ? Math.PI / 4 : 0;
  walkPitch = 0.16;
  cameraOrbit = 0;
  dynamics = new RoverDynamics(rover, terrainAt, x, z, walkYaw);
  $('walk-distance').textContent = '0 m';
  $('walk-pace').textContent = '0.0 km/h';
  $('walk-ground').textContent = `${Math.round(terrainAt(x, z).elevation).toLocaleString()} m`;
  camera.near = 0.25;
  camera.updateProjectionMatrix();
  updateWalkCamera(0, true);
  updateDriveTelemetry();
}

function enterWalkMode() {
  scene.add(rover);
  keyLight.castShadow = true;
  ambientLight.intensity = 0.45;
  fillLight.intensity = 0.18;
  sun.visible = true;
  if (siteMarker) siteMarker.visible = false;
  walkMode = true;
  controls.enabled = false;
  document.querySelector('.app-shell').classList.add('walk-mode');
  $('walk-hud').hidden = false;
  driveTelemetry.hidden = false;
  simulation.clock.start();
  renderer.domElement.focus({ preventScroll: true });
  resetRover();
}

function exitWalkMode() {
  if (!walkMode) return;
  walkMode = false;
  walkKeys.clear();
  lookPointerId = null;
  lastPointer = null;
  controls.enabled = true;
  if (rover) scene.remove(rover);
  keyLight.castShadow = false;
  ambientLight.intensity = 1.35;
  fillLight.intensity = 0.55;
  sun.visible = false;
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
  if (viewMode.startsWith('region:')) {
    $('site-name').textContent = descriptor.name;
    $('site-coords').textContent = `${Math.abs(descriptor.centerLatitude).toFixed(2)}° S · ${Math.abs(descriptor.centerLongitude).toFixed(2)}° ${descriptor.centerLongitude < 0 ? 'W' : 'E'}`;
    $('site-tag').textContent = 'LOLA DEM';
    $('view-note').textContent = 'LOLA GLOBAL DEM · ~474 M SOURCE RESOLUTION · 25.6 KM WINDOW';
    $('walk-button').innerHTML = '<span class="walk-button-mark" aria-hidden="true">↗</span> Drive the surface';
    document.querySelector('.walk-caption').textContent = 'Interpolated terrain · small hazards are not represented';
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

async function showView(mode) {
  viewMode = mode;
  $('loading').classList.add('visible');
  $('error-message').hidden = true;
  document.querySelectorAll('.view-button').forEach(button => {
    const active = button.dataset.view === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  try {
    if (!viewData || viewData.mode !== mode) {
      const descriptor = mode.startsWith('region:') ? metadata.regions[mode.slice(7)] : mode === 'detail' ? metadata.detail : mode === 'crater' ? metadata.crater : metadata.overview;
      const data = await readGrid(descriptor);
      const fine = mode === 'crater'
        ? { descriptor: metadata.craterDetail, data: await readGrid(metadata.craterDetail) }
        : null;
      viewData = { mode, descriptor, data, fine };
    }
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
    console.error(error);
    $('error-message').textContent = 'The elevation tile could not be loaded. Serve this folder over HTTP and check that the assets are present.';
    $('error-message').hidden = false;
    return false;
  } finally {
    $('loading').classList.remove('visible');
  }
}

document.querySelectorAll('.view-button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
regionSelect.addEventListener('change', () => {
  if (regionSelect.value) showView(`region:${regionSelect.value}`);
});
$('walk-button').addEventListener('click', async () => {
  if (enteringDrive) return;
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
    $('error-message').textContent = 'The rover model could not load. Please try again.';
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

const movementKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);
addEventListener('keydown', event => {
  if (!walkMode) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') { exitWalkMode(); return; }
  if (driveTelemetry.contains(event.target) || event.target.closest?.('button, a, input, summary')) return;
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
  const dt = Math.min(walkClock.getDelta(), 0.05);
  if (walkMode) {
    // Drive controls keep their existing real-time pace at every time warp.
    if (simulation.clock.running) updateWalker(dt);
    else updateWalkCamera(dt);
    keyLight.target.position.copy(rover.position);
    keyLight.position.copy(rover.position).add(sunOffset);
    sun.position.copy(camera.position).addScaledVector(sunDirection, 60000);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

const initialRegion = new URLSearchParams(location.search).get('region');
if (Object.hasOwn(metadata.regions, initialRegion)) {
  regionSelect.value = initialRegion;
  showView(`region:${initialRegion}`);
} else {
  showView('overview');
}
