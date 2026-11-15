"""Compare terrain cast shadows under the same low Sun on Earth and the Moon."""

import json
import math

import numpy as np

from prepare_reachability import MOON_TILES, OUTPUT as REACHABILITY, read_grid
from rover_tiles import CACHE, SIZE, SPACING_M

SUN_ANGLE = 5
GRID_SIZE = 480  # Fits inside the Moon tiles at every rotation.
DIRECTIONS = {
    'N': (-1, 0), 'NE': (-1, 1), 'E': (0, 1), 'SE': (1, 1),
    'S': (1, 0), 'SW': (1, -1), 'W': (0, -1), 'NW': (-1, -1),
}


def moon_grid(grid, spacing, longitude):
    """Resample the south polar stereographic tile on local north/east axes."""
    offsets = (np.arange(GRID_SIZE) - (GRID_SIZE - 1) / 2) * SPACING_M / spacing
    south, east = np.meshgrid(offsets, offsets, indexing='ij')
    angle = math.radians(longitude)
    row = (grid.shape[0] - 1) / 2 + south * math.cos(angle) + east * math.sin(angle)
    col = (grid.shape[1] - 1) / 2 - south * math.sin(angle) + east * math.cos(angle)
    r, c = np.floor(row).astype(int), np.floor(col).astype(int)
    y, x = row - r, col - c
    return ((grid[r, c] * (1 - x) + grid[r, c + 1] * x) * (1 - y)
            + (grid[r + 1, c] * (1 - x) + grid[r + 1, c + 1] * x) * y)


def shadow_percent(grid, dy, dx):
    """Sweep from the sunward edge, keeping the highest projected ray per line."""
    if dy == 0:
        grid, dy, dx = grid.T, dx, dy
    if dy > 0:
        grid = grid[::-1]
    if dx < 0:
        grid = grid[:, ::-1]

    # With the Sun above row zero, its rays fall by this amount per row.
    rise = SPACING_M * math.hypot(dy, dx) * math.tan(math.radians(SUN_ANGLE))
    horizon = np.full(grid.shape[1], -np.inf)
    shaded = 0
    for i, row in enumerate(grid):
        ray_height = row + i * rise
        if dx:
            horizon[:-1] = horizon[1:]
            horizon[-1] = -np.inf
        shaded += np.count_nonzero(horizon > ray_height)
        np.maximum(horizon, ray_height, out=horizon)
    return round(100 * shaded / grid.size, 2)


def shadow_profile(grid):
    return [shadow_percent(grid, *direction) for direction in DIRECTIONS.values()]


def main():
    meta = json.loads((MOON_TILES / 'moon-sites.json').read_text())
    moon = {}
    spacing = meta['pixelSizeM'] * meta['stridePixels']
    for key, site in meta['sites'].items():
        grid = read_grid(MOON_TILES / site['file'], meta['width'], meta['height'],
                         meta['heightScaleM'])
        moon[key] = shadow_profile(moon_grid(grid, spacing, site['centerLongitude']))

    earth = {}
    locations = json.loads(REACHABILITY.read_text())['earth']
    start = (SIZE - GRID_SIZE) // 2
    patch = slice(start, start + GRID_SIZE)
    for key in locations:
        path = CACHE / 'rover_tiles' / (key.replace(',', '_') + '.bin')
        if not path.is_file():
            raise FileNotFoundError(path)
        earth[key] = shadow_profile(read_grid(path, SIZE, SIZE, 1)[patch, patch])

    result = {'sunAngle': SUN_ANGLE, 'patchKm': GRID_SIZE * SPACING_M / 1000,
              'directions': list(DIRECTIONS), 'moon': moon, 'earth': earth}
    REACHABILITY.with_name('shadows.json').write_text(
        json.dumps(result, separators=(',', ':')) + '\n')
    print(f'Wrote shadow profiles for {len(moon)} Moon sites and {len(earth)} Earth sites')


if __name__ == '__main__':
    main()
