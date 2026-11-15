import { earthSolarGeometry, lunarEnvironment } from '../../frontend/lunar-simulation.js';

const MINUTE_MS = 60_000;

export function environmentClock(previous, { epoch, utc }) {
  const start = previous?.epoch === epoch && utc >= previous.start ? previous.start : utc;
  return { epoch, start, seconds: Math.floor((utc - start) / 1000) };
}

const cachedProfiles = new WeakMap();
export function environmentProfile(test) {
  const clock = test.environmentClock;
  if (!clock) return [];
  const minutes = Math.floor(clock.seconds / 60);
  let cache = cachedProfiles.get(test);
  if (!cache || cache.start !== clock.start || cache.points.length > minutes + 1) {
    cache = { start: clock.start, points: [] };
    cachedProfiles.set(test, cache);
  }
  const earth = test.tiles.earth.descriptor;
  const moon = test.tiles.moon.descriptor;
  const sample = minute => {
    const utc = clock.start + minute * MINUTE_MS;
    return {
      minute,
      earth: earthSolarGeometry(utc, earth.centerLatitude, earth.centerLongitude),
      moon: lunarEnvironment(utc, moon.centerLatitude, moon.centerLongitude),
    };
  };
  for (let minute = cache.points.length; minute <= minutes; minute++) {
    cache.points.push(sample(minute));
  }
  if (clock.seconds % 60 === 0) return cache.points;
  if (cache.latest?.minute !== clock.seconds / 60) cache.latest = sample(clock.seconds / 60);
  return [...cache.points, cache.latest];
}
