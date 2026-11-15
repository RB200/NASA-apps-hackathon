import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Traverse, traverseTile, routeStats, profileDifference } from '../frontend/traverse.mjs';

const flat = (spacing, width = 11) =>
  traverseTile({ descriptor: { width, height: width }, data: new Int16Array(width ** 2) },
    spacing, 1, false);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} is not near ${b}`);

test('fixed stations follow a turn and preserve the exact partial endpoint', () => {
  const run = new Traverse('earth', { x: 25, z: 20 });
  run.record(50, 20);
  run.record(50, 20); // stationary
  run.record(50, 70);
  // Backfill movement recorded while the paired DEM was loading.
  run.setTiles({ earth: flat(30), moon: flat(20) });
  run.record(50, 73);
  assert.deepEqual(run.profile().map(p => p.distance), [0, 30, 60, 78]);
  assert.deepEqual(run.route.map(p => p.distance), [0, 25, 75, 78]);
  assert.deepEqual(run.coordinates('moon', run.samples[1]), { x: 25, z: 5 });
  assert.deepEqual(run.coordinates('moon', run.profile().at(-1)), { x: 25, z: 53 });
});

test('crossing a tile edge between stations ends the comparison, even after returning', () => {
  const run = new Traverse('earth', { x: 0, z: 0 });
  run.setTiles({ earth: flat(30), moon: flat(9) }); // lunar edge at x = 45
  run.record(40, 0);
  run.record(50, 0);
  run.record(0, 0);
  assert.equal(run.distance, 100);
  assert.equal(run.pairedDistance, 45);
  assert.equal(run.incomplete, true);
  assert.equal(run.tiles.moon.elevation(50, 0), null);
  assert.deepEqual(run.profile().map(p => p.distance), [0, 30, 45]);
  assert.deepEqual(run.pairedRoute.at(-1), { x: 45, z: 0, distance: 45 });
});

test('slopes, gain, loss and profile differences use sampled elevations and along-route distances', () => {
  const points = [{ distance: 0, earth: 0, moon: 0 }, { distance: 30, earth: 30, moon: 29 },
    { distance: 60, earth: 15, moon: -5 }, { distance: 75, earth: 0, moon: -4 }];
  const result = routeStats(points, 'earth');
  assert.equal(result.distance, 75);
  near(result.average, (45 * 45 + Math.atan(0.5) * (180 / Math.PI) * 30) / 75);
  assert.deepEqual(result.steepest, { degrees: 45, from: 0, to: 30 });
  assert.equal(result.gain, 30);
  assert.equal(result.loss, 30);
  assert.equal(result.range, 30);
  assert.equal(routeStats(points.slice(0, 1), 'moon').average, null);
  const difference = profileDifference(points);
  assert.equal(difference.closest.distance, 30);
  assert.equal(difference.furthest.distance, 60);
});

test('bundled de Gerlache and Earth DEMs use the same local metre axes in either driving direction', async () => {
  const assets = new URL('../frontend/assets/', import.meta.url);
  const json = async file => JSON.parse(await readFile(new URL(file, assets), 'utf8'));
  const [lunar, earth] = await Promise.all([json('moon-sites/moon-sites.json'), json('earth/earth-metadata.json')]);
  const region = 'de-gerlache-rim-2';
  const earthSite = earth.sites[earth.regions[region].site];
  const moonSite = { ...lunar, ...lunar.sites[region] };
  const load = async (folder, descriptor, lunar) => {
    const buf = await readFile(new URL(folder + descriptor.file, assets));
    assert.equal(buf.length, 2 * descriptor.width * descriptor.height);
    const data = Int16Array.from({ length: buf.length / 2 }, (_, i) => buf.readInt16LE(i * 2));
    return traverseTile({ descriptor, data }, descriptor.pixelSizeM, descriptor.heightScaleM, lunar);
  };
  const tiles = { earth: await load('earth/', earthSite, false), moon: await load('moon-sites/', moonSite, true) };
  const angle = moonSite.centerLongitude * Math.PI / 180;
  const forward = tiles.moon.toGrid(0, 100);
  near(forward.x, 100 * Math.sin(angle));
  near(forward.z, 100 * Math.cos(angle));
  const local = [[0, 0], [0, 100], [30, 100], [30, 130]];
  const traces = ['earth', 'moon'].map(world => {
    const route = new Traverse(world, { x: 0, z: 0 });
    route.setTiles(tiles);
    local.slice(1).forEach(([east, north]) => {
      const { x, z } = tiles[world].toGrid(east, north);
      route.record(x, z);
    });
    assert.equal(route.incomplete, false);
    const profile = route.profile();
    near(profile.at(-1).distance, 160);
    assert.equal(profile[0].earth, 0);
    assert.equal(profile[0].moon, 0);
    assert.ok(profile.some(p => p.earth !== p.moon));
    return profile;
  });
  traces[0].forEach((p, i) => {
    near(p.earth, traces[1][i].earth);
    near(p.moon, traces[1][i].moon);
    near(p.distance, traces[1][i].distance);
  });
});

test('changing Earth terrain replays the route from the new center with the same lunar start', () => {
  for (const world of ['earth', 'moon']) {
    const run = new Traverse(world, { x: 90, z: 30 });
    run.setTiles({ earth: flat(30), moon: flat(30) });
    run.record(125, 30);
    run.record(125, 65);
    const comparison = run.withEarthTile(flat(10));
    assert.equal(comparison.distance, run.distance);
    assert.deepEqual(comparison.starts.earth, { x: 0, z: 0 });
    assert.deepEqual(comparison.starts.moon, run.starts.moon);
    assert.deepEqual(
      comparison.route.map(point => comparison.coordinates('moon', point)),
      run.route.map(point => run.coordinates('moon', point)),
    );
    assert.equal(run.incomplete, false);
  }
});
