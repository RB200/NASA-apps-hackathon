"""Prebuild Earth terrain for every match shown by the atlas."""

import argparse
from itertools import chain

from app import FEATURES, MOON, match
from rover_tiles import cached_tile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', action='store_true', help='List coordinates without downloading')
    args = parser.parse_args()
    # Match the atlas ranking before and after its backend health request.
    core = ('p90Slope', 'roughness', 'relief', 'meanSlope')
    full = (*core, 'shape') if 'shape' in FEATURES else core
    results = chain.from_iterable(
        match(region, list(order), 5, False)['matches']
        for region in MOON for order in dict.fromkeys((core, full))
    )
    sites = {(row['lat'], row['lon']): row for row in results}
    failures = 0
    for (lat, lon), row in sorted(sites.items()):
        label = f"{row['name']} ({lat:.4f}, {lon:.4f})"
        if args.list:
            print(label)
            continue
        try:
            _, source = cached_tile(lat, lon)
            print(f'{label}: {source}', flush=True)
        except Exception as error:
            failures += 1
            print(f'{label}: {error}', flush=True)
    print(f'{len(sites)} distinct atlas matches; {failures} failed')
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
