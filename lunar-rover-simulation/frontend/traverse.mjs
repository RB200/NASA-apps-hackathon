// Route analysis works in tile metres, independently of the rendered mesh and rover dynamics.
export const INTERVAL = 30;

export function gridTriangle(width, height, col, row) {
  const c = Math.floor(col), r = Math.floor(row);
  const a = r * width + c, b = r * width + Math.min(c + 1, width - 1);
  const d = Math.min(r + 1, height - 1) * width + c;
  const e = Math.min(r + 1, height - 1) * width + Math.min(c + 1, width - 1);
  const u = col - c, v = row - r;
  return read => u + v <= 1
    ? read(a) * (1 - u - v) + read(b) * u + read(d) * v
    : read(e) * (u + v - 1) + read(d) * (1 - u) + read(b) * (1 - v);
}

export function traverseTile({ descriptor, data }, spacing, scale, lunar) {
  const { width, height, centerLongitude } = descriptor;
  // Earth rows run north to south. On LOLA's south-polar grid, local north
  // points radially away from the pole at the tile's center longitude.
  const angle = lunar ? centerLongitude * Math.PI / 180 : 0;
  const c = Math.cos(angle), s = Math.sin(angle);
  const halfX = (width - 1) * spacing / 2, halfZ = (height - 1) * spacing / 2;
  return {
    descriptor, spacing, halfX, halfZ,
    toLocal: (x, z) => ({ east: c * x - s * z, north: s * x + c * z }),
    toGrid: (east, north) => ({ x: c * east + s * north, z: -s * east + c * north }),
    // Clip geometrically before sampling. The tolerance here only absorbs
    // floating point roundoff when converting a clipped edge back to pixels.
    elevation(x, z) {
      if (Math.abs(x) > halfX + 1e-8 || Math.abs(z) > halfZ + 1e-8) return null;
      const col = Math.max(0, Math.min(width - 1, (x + halfX) / spacing));
      const row = Math.max(0, Math.min(height - 1, (halfZ - z) / spacing));
      return gridTriangle(width, height, col, row)(i => data[i]) * scale;
    },
  };
}

export class Traverse {
  constructor(world, start) {
    Object.assign(this, { world, start, distance: 0, pairedDistance: 0,
      samples: [], route: [{ ...start, distance: 0 }], next: INTERVAL,
      incomplete: false, tiles: null });
  }

  setTiles(tiles) {
    this.tiles = tiles;
    this.starts = { earth: { x: 0, z: 0 }, moon: { x: 0, z: 0 }, [this.world]: this.start };
    this.baseline = this.elevations(this.start);
    this.pairedRoute = [{ ...this.start, distance: 0 }];
    this.samples.push({ ...this.start, distance: 0, earth: 0, moon: 0 });
    for (let i = 1; i < this.route.length; i++) this.sampleSegment(this.route[i - 1], this.route[i]);
  }

  coordinates(world, point) {
    if (world === this.world) return { x: point.x, z: point.z };
    const { east, north } = this.tiles[this.world].toLocal(point.x - this.start.x, point.z - this.start.z);
    return this.tiles[world].toGrid(east, north);
  }

  elevations(point) {
    return Object.fromEntries(['earth', 'moon'].map(world => {
      const { x, z } = this.coordinates(world, point);
      return [world, this.tiles[world].elevation(x, z)];
    }));
  }

  sample(point) {
    const { earth, moon } = this.elevations(point);
    return { ...point, earth: earth - this.baseline.earth, moon: moon - this.baseline.moon };
  }

  record(x, z) {
    const prev = this.route.at(-1);
    const length = Math.hypot(x - prev.x, z - prev.z);
    if (!(length > 0)) return;
    this.distance += length;
    const point = { x, z, distance: this.distance };
    this.route.push(point);
    if (this.tiles) this.sampleSegment(prev, point);
  }

  sampleSegment(a, b) {
    if (this.incomplete) return;
    let fraction = 1;
    // A straight segment in either (rotated) grid can leave a rectangular tile
    // at most once. Check every segment, including those between sample stations.
    for (const world of ['earth', 'moon']) {
      const p = this.coordinates(world, a), q = this.coordinates(world, b);
      const { halfX, halfZ } = this.tiles[world];
      for (const [axis, limit] of [['x', halfX], ['z', halfZ]]) {
        if (Math.abs(q[axis]) <= limit) continue;
        const edge = Math.sign(q[axis]) * limit;
        fraction = Math.min(fraction, (edge - p[axis]) / (q[axis] - p[axis]));
      }
    }
    fraction = Math.max(0, fraction);
    const length = b.distance - a.distance;
    const pointAt = t => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
      distance: a.distance + length * t });
    const end = fraction === 1 ? b : pointAt(fraction);
    while (this.next <= end.distance) {
      this.samples.push(this.sample({ ...pointAt((this.next - a.distance) / length), distance: this.next }));
      this.next += INTERVAL;
    }
    if (end.distance > this.pairedDistance) this.pairedRoute.push(end);
    this.pairedDistance = end.distance;
    this.incomplete = fraction < 1;
  }

  withEarthTile(earth) {
    const start = this.world === 'earth' ? { x: 0, z: 0 } : this.start;
    const comparison = new Traverse(this.world, start);
    comparison.setTiles({ earth, moon: this.tiles.moon });
    for (let i = 1; i < this.route.length; i++) {
      const point = this.route[i];
      comparison.record(start.x + (point.x - this.start.x), start.z + (point.z - this.start.z));
    }
    return comparison;
  }

  profile() {
    const end = this.pairedRoute?.at(-1);
    if (!end || end.distance - this.samples.at(-1).distance < 1e-6) return this.samples;
    return [...this.samples, this.sample(end)];
  }
}

export function routeStats(samples, world) {
  let gain = 0, loss = 0, min = 0, max = 0, weightedSlope = 0, steepest = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const rise = b[world] - a[world], run = b.distance - a.distance;
    gain += Math.max(0, rise);
    loss += Math.max(0, -rise);
    min = Math.min(min, b[world]);
    max = Math.max(max, b[world]);
    const degrees = Math.atan2(Math.abs(rise), run) * 180 / Math.PI;
    weightedSlope += degrees * run;
    if (!steepest || degrees > steepest.degrees) steepest = { degrees, from: a.distance, to: b.distance };
  }
  const distance = samples.at(-1)?.distance ?? 0;
  return { distance, average: distance ? weightedSlope / distance : null, steepest, gain, loss, range: max - min };
}

export function profileDifference(samples) {
  if (samples.length < 2) return null;
  // Compare measured stations beyond the shared, zeroed starting elevation.
  const points = samples.slice(1);
  const gap = p => Math.abs(p.earth - p.moon);
  const closest = points.reduce((a, b) => gap(a) <= gap(b) ? a : b);
  const furthest = points.reduce((a, b) => gap(a) >= gap(b) ? a : b);
  return { closest, furthest, gap };
}
