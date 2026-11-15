"""Calculate atlas reachability from the cached Earth grids and bundled Moon grids."""

import json
import math
from pathlib import Path

import numpy as np

from app import FEATURES, MOON, match
from rover_tiles import CACHE, SIZE, SPACING_M

ROOT = Path(__file__).resolve().parents[1]
MOON_TILES = ROOT / 'lunar-rover-simulation/frontend/assets/moon-sites'
OUTPUT = ROOT / 'frontend/assets/reachability.json'
LIMITS = (10, 15, 20)


def read_grid(path, width, height, scale):
    return np.fromfile(path, dtype='<i2').reshape(height, width) * scale


def centered_grid(grid, spacing):
    """Bilinearly sample a common grid at 30 m, centered on the source."""
    height, width = grid.shape
    offsets = (np.arange(SIZE) - (SIZE - 1) / 2) * SPACING_M / spacing
    x = (width - 1) / 2 + offsets
    y = (height - 1) / 2 + offsets
    if min(x[0], y[0]) < 0 or x[-1] > width - 1 or y[-1] > height - 1:
        raise ValueError('Source grid is smaller than the comparison area')
    rows = np.array([np.interp(x, np.arange(width), row) for row in grid])
    return np.array([np.interp(y, np.arange(height), col) for col in rows.T]).T


def reachable_percent(grid):
    """Flood fill from the same central cell, using four edge neighbors."""
    height, width = grid.shape
    east_rise = np.abs(np.diff(grid, axis=1))
    south_rise = np.abs(np.diff(grid, axis=0))
    result = []
    for limit in LIMITS:
        max_rise = SPACING_M * math.tan(math.radians(limit))
        east = np.pad(east_rise <= max_rise, ((0, 0), (0, 1))).flatten().tobytes()
        south = np.pad(south_rise <= max_rise, ((0, 1), (0, 0))).flatten().tobytes()
        start = (height // 2) * width + width // 2
        seen = bytearray(grid.size)
        seen[start] = 1
        queue = [start]
        for cell in queue:
            if east[cell] and not seen[cell + 1]:
                seen[cell + 1] = 1
                queue.append(cell + 1)
            if cell % width and east[cell - 1] and not seen[cell - 1]:
                seen[cell - 1] = 1
                queue.append(cell - 1)
            if south[cell] and not seen[cell + width]:
                seen[cell + width] = 1
                queue.append(cell + width)
            if cell >= width and south[cell - width] and not seen[cell - width]:
                seen[cell - width] = 1
                queue.append(cell - width)
        result.append(round(100 * len(queue) / grid.size, 2))
    return result


def main():
    meta = json.loads((MOON_TILES / 'moon-sites.json').read_text())
    moon = {
        key: reachable_percent(centered_grid(
            read_grid(MOON_TILES / site['file'], meta['width'], meta['height'], meta['heightScaleM']),
            meta['pixelSizeM'] * meta['stridePixels'],
        ))
        for key, site in meta['sites'].items()
    }
    core = ['p90Slope', 'roughness', 'relief', 'meanSlope']
    orders = [core, core + ['shape']] if 'shape' in FEATURES else [core]
    coords = {(row['lat'], row['lon']) for region in MOON for order in orders
              for row in match(region, order, 5, False)['matches']}
    earth = {}
    for lat, lon in sorted(coords):
        key = f'{lat:.4f},{lon:.4f}'
        path = CACHE / 'rover_tiles' / f'{lat:.4f}_{lon:.4f}.bin'
        if not path.is_file():
            print(f'Missing cached grid for {key}')
            continue
        earth[key] = reachable_percent(read_grid(path, SIZE, SIZE, 1))
    OUTPUT.write_text(json.dumps({'slopeLimits': LIMITS, 'moon': moon, 'earth': earth},
                                 separators=(',', ':')) + '\n')
    print(f'Wrote {len(moon)} Moon sites and {len(earth)}/{len(coords)} Earth matches')


if __name__ == '__main__':
    main()
