import test from 'node:test';
import assert from 'node:assert/strict';
import { createLunarClock, lunarEnvironment } from '../../frontend/lunar-simulation.js';
import { environmentClock, environmentProfile } from '../frontend/traverse-environment.mjs';

test('environment history uses shared UTC, simulated elapsed time, and a live endpoint', () => {
  const epoch = Date.UTC(2026, 5, 21, 12);
  const start = environmentClock(null, { epoch, utc: epoch });
  const elapsed = environmentClock(start, { epoch, utc: epoch + 135_000 });
  const earth = { descriptor: { centerLatitude: 0, centerLongitude: 0 } };
  const moon = { descriptor: { centerLatitude: -88.2, centerLongitude: -64.4 } };
  const run = { tiles: { earth, moon }, environmentClock: elapsed };
  const profile = environmentProfile(run);
  assert.deepEqual(profile.map(p => p.minute), [0, 1, 2, 2.25]);
  assert.ok(profile.every(p => Number.isFinite(p.moon.temperature)));
  assert.ok(profile.every(p => p.earth.temperature === undefined));
  const replacement = { descriptor: { centerLatitude: 0, centerLongitude: 180 } };
  const alternative = environmentProfile({ ...run, tiles: { earth: replacement, moon } });
  assert.deepEqual(alternative.map(p => p.moon), profile.map(p => p.moon));
  assert.ok(profile[0].earth.irradiance > alternative[0].earth.irradiance);
  const newEpoch = epoch + 3_600_000;
  run.environmentClock = environmentClock(elapsed, { epoch: newEpoch, utc: newEpoch });
  assert.equal(environmentProfile(run).length, 1);
  assert.notEqual(environmentProfile(run)[0].earth.elevation, profile[0].earth.elevation);
});


test('the drive clock honors time acceleration across slow frames and skips while paused', () => {
  const clock = createLunarClock(0, () => 0, true);
  clock.start();
  clock.setSpeed(16);
  clock.advance(250);
  assert.equal(clock.read().elapsed, 4000);
  clock.pause();
  clock.advance(1000);
  assert.equal(clock.read().elapsed, 4000);
  clock.skip(86_400_000);
  assert.equal(clock.read().elapsed, 86_404_000);
  assert.equal(clock.running, false);
  assert.equal(clock.read().speed, 16);
});

test('de Gerlache stays at the model baseline during the reported run and warms in sunlight', () => {
  const start = Date.parse('2026-11-16T00:02:25Z');
  const at = offset => lunarEnvironment(start + offset, -88.2, -64.4);
  assert.equal(at(0).atDarkBaseline, true);
  assert.equal(at(102_000).temperature, at(0).temperature);
  assert.equal(at(2 * 86_400_000).atDarkBaseline, false);
  assert.ok(at(2 * 86_400_000).temperature > at(0).temperature);
});
