import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

let gravity = 1.62; // Moon by default; Earth mode (earth.js) switches it to 9.81
export function setGravity(value) { gravity = value; }
const step = 1 / 120;
const wheelRadius = 0.383;
const axleHeight = -0.617;
const maxExtension = 0.12;
const maxCompression = 0.16;
const treadSamples = [-0.317, -0.10, 0.10, 0.317].flatMap(x =>
  Array.from({ length: 7 }, (_, i) => {
    const angle = (i - 3) * Math.PI / 6;
    return new THREE.Vector3(x, -wheelRadius * Math.cos(angle), wheelRadius * Math.sin(angle));
  }));
const contactPoint = new THREE.Vector3();
const suspensionUp = new THREE.Vector3();
const contacts = [-1.701, 1.701].flatMap(x => [-1.232, 0.469, 2.170].map(z => [x, z]));
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;

// The GLB combines the chassis, tires and rims into one indexed primitive.
function separateWheels(body) {
  body.updateMatrixWorld(true);
  const mesh = body.getObjectByProperty('isMesh', true);
  const geometry = mesh.geometry;
  const positions = geometry.attributes.position;
  const indices = geometry.index.array;
  const roots = Int32Array.from({ length: positions.count }, (_, i) => i);
  function find(i) {
    while (roots[i] !== i) {
      roots[i] = roots[roots[i]];
      i = roots[i];
    }
    return i;
  }

  const welded = new Map();
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)]
      .map(value => Math.round(value * 10000)).join(',');
    if (welded.has(key)) roots[i] = welded.get(key);
    else welded.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]);
    roots[find(indices[i + 1])] = root;
    roots[find(indices[i + 2])] = root;
  }

  const bounds = new Map();
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const root = find(i);
    if (!bounds.has(root)) bounds.set(root, new THREE.Box3());
    bounds.get(root).expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
  }

  const parts = contacts.map(() => ({ tires: [], mount: [] }));
  const destinationForComponent = new Map();
  for (const [root, box] of bounds) {
    const wheel = contacts.findIndex(([x, z]) => {
      const side = Math.sign(x);
      const inner = Math.min(box.min.x * side, box.max.x * side);
      const outer = Math.max(box.min.x * side, box.max.x * side);
      return inner >= 0.67 && outer <= 2.03 &&
        box.min.z >= z - 0.39 && box.max.z <= z + 0.39 &&
        box.min.y >= -1.01 && box.max.y <= 0.40;
    });
    if (wheel === -1) continue;
    // The two wheel discs sit on either side of the fixed central axle.
    const [x] = contacts[wheel];
    const rotating = box.max.y <= -0.22 && [-0.208, 0.208].some(offset => {
      const disc = x + offset;
      return box.min.x >= disc - 0.115 && box.max.x <= disc + 0.115;
    });
    destinationForComponent.set(root, rotating ? parts[wheel].tires : parts[wheel].mount);
  }

  const chassisIndices = [];
  for (let i = 0; i < indices.length; i += 3) {
    const destination = destinationForComponent.get(find(indices[i])) ?? chassisIndices;
    destination.push(indices[i], indices[i + 1], indices[i + 2]);
  }

  geometry.setIndex(chassisIndices);
  return contacts.map(([x, z], i) => {
    const carrier = new THREE.Group();
    carrier.position.set(x, axleHeight, z);
    const tirePivot = new THREE.Group();
    carrier.add(tirePivot);
    body.add(carrier);

    for (const [parent, partIndices] of [[carrier, parts[i].mount], [tirePivot, parts[i].tires]]) {
      const partGeometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        partGeometry.setAttribute(name, attribute);
      }
      partGeometry.setIndex(partIndices);
      const part = new THREE.Mesh(partGeometry, mesh.material);
      part.matrix.copy(mesh.matrixWorld).premultiply(
        new THREE.Matrix4().makeTranslation(-x, -axleHeight, -z));
      part.matrixAutoUpdate = false;
      parent.add(part);
    }
    return { carrier, tirePivot };
  });
}

export async function loadRover() {
  const decoder = new DRACOLoader().setDecoderPath('./assets/draco/');
  let model;
  try {
    model = (await new GLTFLoader().setDRACOLoader(decoder)
      .loadAsync('./assets/space-exploration-vehicle.glb')).scene;
  } finally {
    decoder.dispose();
  }
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.rotation.y = Math.PI;
  model.position.set(center.x, -bounds.min.y - 1, center.z);
  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  body.add(model);
  body.userData.wheels = separateWheels(body);
  return body;
}

export class RoverDynamics {
  constructor(body, terrain, x, z, yaw) {
    Object.assign(this, { body, terrain, yaw, vx: 0, vz: 0, vy: 0, pitch: 0, roll: 0, time: 0, distance: 0 });
    body.position.set(x, terrain(x, z).y + 1, z);
    body.rotation.set(0, -yaw, 0);
    for (const { carrier, tirePivot } of body.userData.wheels) {
      carrier.position.y = axleHeight;
      tirePivot.rotation.x = 0;
    }
    this.updateSuspension();
  }

  update(dt, throttle, steer, brake, limitX, limitZ) {
    this.time += dt;
    while (this.time >= step) {
      this.time -= step;
      this.integrate(throttle, steer, brake, limitX, limitZ);
    }
    return Math.hypot(this.vx, this.vz);
  }

  integrate(throttle, steer, brake, limitX, limitZ) {
    const p = this.body.position;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const relativeSpeed = this.vx * s - this.vz * c;
    const slip = this.vx * c + this.vz * s;
    const grounded = this.body.userData.wheels.some(({ carrier }) =>
      this.wheelClearance(carrier, carrier.position.y) >= -0.02);
    let lift = 0, slopeFront = 0, slopeSide = 0;
    let turn = 0;
    if (grounded) {
      for (const [x, z] of contacts) {
        const ground = this.terrain(p.x + c*x - s*z, p.z + s*x + c*z).y;
        const rest = ground + 1 + Math.sin(this.pitch)*z - Math.sin(this.roll)*x;
        // Suspension was tuned for lunar weight; scale it with gravity (k = 1 on the Moon).
        const k = gravity / 1.62;
        lift += clamp(((rest - p.y + 0.16) * 10 - this.vy * 3) * k, 0, 8 * k) / contacts.length;
        slopeFront += ground * (z - 0.469) / (4 * 1.701 ** 2);
        slopeSide += ground * x / (6 * 1.701 ** 2);
      }
      const grip = clamp(lift * 0.82, 0, 3);
      const desired = throttle > 0 ? 15 : -5;
      const motor = throttle && !brake ? clamp((desired - relativeSpeed) * 1.5, -2.8, 2.8) : 0;
      const rolling = relativeSpeed * (brake ? 9 : 0.09);
      const forwardForce = clamp(motor - rolling, -grip, grip) + gravity * slopeFront;
      const contact = clamp(lift / gravity, 0, 1);
      const forwardSpeed = relativeSpeed + forwardForce * step;
      // Steer the velocity with the chassis while the tires have ground contact.
      const turnRate = steer * clamp(forwardSpeed / 4.2, -1.15, 1.15) * contact;
      turn = turnRate * step;
      const lateralSpeed = damp(slip, 0, 14 * contact, step) - gravity * slopeSide * step;
      this.yaw += turn;
      const nextSin = Math.sin(this.yaw), nextCos = Math.cos(this.yaw);
      this.vx = nextSin * forwardSpeed + nextCos * lateralSpeed;
      this.vz = -nextCos * forwardSpeed + nextSin * lateralSpeed;
    }
    const x = clamp(p.x + this.vx * step, -limitX, limitX);
    const z = clamp(p.z + this.vz * step, -limitZ, limitZ);
    if (Math.abs(x) >= limitX) this.vx = 0;
    if (Math.abs(z) >= limitZ) this.vz = 0;
    const travel = (x - p.x) * Math.sin(this.yaw) - (z - p.z) * Math.cos(this.yaw);
    this.distance += Math.hypot(x - p.x, z - p.z);

    this.vy += (lift - gravity) * step;
    p.set(x, p.y + this.vy * step, z);
    if (grounded) {
      this.pitch = damp(this.pitch, -Math.atan(slopeFront), 5, step);
      this.roll = damp(this.roll, Math.atan(slopeSide), 5, step);
      this.body.rotation.set(this.pitch, -this.yaw, this.roll);
    }

    this.updateSuspension(travel, turn);
  }

  wheelClearance(carrier, height) {
    const { position, quaternion } = this.body;
    let clearance = -Infinity;
    for (const tread of treadSamples) {
      contactPoint.set(carrier.position.x, height, carrier.position.z)
        .add(tread).applyQuaternion(quaternion).add(position);
      const ground = this.terrain(contactPoint.x, contactPoint.z).y;
      clearance = Math.max(clearance, ground + 0.01 - contactPoint.y);
    }
    return clearance;
  }

  updateSuspension(travel = 0, turn = 0) {
    const { position, quaternion } = this.body;
    const up = Math.max(0.001, suspensionUp.set(0, 1, 0).applyQuaternion(quaternion).y);
    let chassisLift = 0;
    for (const { carrier, tirePivot } of this.body.userData.wheels) {
      const clearance = this.wheelClearance(carrier, axleHeight);

      const required = clearance / up;
      const offset = carrier.position.y - axleHeight;
      const target = clamp(required, -maxExtension, maxCompression);
      const relaxed = damp(offset, target, 18, step);
      carrier.position.y = axleHeight + clamp(Math.max(required, relaxed), -maxExtension, maxCompression);
      chassisLift = Math.max(chassisLift, clearance - maxCompression * up);
      tirePivot.rotation.x -= (travel - turn * carrier.position.x) / wheelRadius;
    }

    // Once the suspension bottoms out, move the chassis above the contact.
    if (chassisLift > 0) {
      position.y += chassisLift;
      this.vy = Math.max(0, this.vy);
    }
  }
}
