"""Quick checks: backend/.venv/bin/python -I backend/test_app.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient  # noqa: E402

import app as backend  # noqa: E402

c = TestClient(backend.app)

h = c.get("/health").json()
assert h["ok"] and len(h["moonRegions"]) == 9, h

r = c.get("/match", params={"region": "haworth", "constraints": "p90Slope,roughness,relief", "n": 5}).json()
m = r["matches"]
assert 1 <= len(m) <= 5, r
assert all(m[i]["match"] >= m[i + 1]["match"] for i in range(len(m) - 1)), "not sorted"
assert set(m[0]["features"]) == set(backend.FEATURES)
names = [x["name"] for x in m]
assert "Rift valley (vegetated)" not in names, "bare-ground filter failed"
assert "Mauna Kea summit" not in names, "snow filter failed"
# the two Atacama rows are ~25 km apart: only one may be returned
atacama = [x for x in m if -25 < x["lat"] < -23 and -70 < x["lon"] < -68]
assert len(atacama) <= 1, "separation filter failed"

snow = c.get("/match", params={"region": "haworth", "constraints": "p90Slope", "n": 20, "include_snow": True}).json()
assert snow["eligible"] > r["eligible"], "include_snow had no effect"

assert c.get("/match", params={"region": "nope", "constraints": "relief"}).status_code == 404
assert c.get("/match", params={"region": "haworth", "constraints": "temperature"}).status_code == 400

# one far-off feature must drag the match down (geometric mean), all-decent scores barely change
import numpy as np  # noqa: E402
w = np.array([0.25, 0.25, 0.25, 0.25])
assert backend.combine(np.array([[100, 100, 100, 0.0]]), w)[0] < 40
assert abs(backend.combine(np.array([[90, 80, 85, 85.0]]), w)[0] - 85) < 1
assert abs(backend.combine(np.array([[70, 0, 0, 0.0]]), np.array([1, 0, 0, 0.0]))[0] - 70) < 1e-9  # unpicked features ignored

# priority matters: plateau region with landing-style priorities should prefer flat sites
flat = c.get("/match", params={"region": "mons-mouton", "constraints": "p90Slope,roughness", "n": 3}).json()
print("haworth:", [(x["name"], x["match"]) for x in m])
print("mons-mouton:", [(x["name"], x["match"]) for x in flat["matches"]])
print("eligible:", r["eligible"], "with snow:", snow["eligible"], "sample:", r["sample"])
print("OK")
