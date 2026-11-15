import test from 'node:test';
import assert from 'node:assert/strict';
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
