"""Download raw OpenStreetMap data for Adelaide's city centre from Overpass.

    python tools/fetch_adelaide.py            # writes data/adelaide_raw.json

The raw file is large (about 9 MB) and is not committed; tools/prep_adelaide.py
turns it into the compact file the demo loads. Map data (c) OpenStreetMap
contributors, ODbL.
"""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

# south, west, north, east: West Terrace to East Terrace, South Terrace to just
# north of Adelaide Oval.
BBOX = (-34.938, 138.583, -34.912, 138.617)
URL = "https://overpass-api.de/api/interpreter"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "adelaide_raw.json"


def query(bbox):
    b = "({},{},{},{})".format(*bbox)
    parts = [
        'way["building"]', 'relation["building"]', 'way["highway"]',
        'way["natural"="water"]', 'relation["natural"="water"]', 'way["waterway"]',
        'way["leisure"~"park|garden|pitch|stadium|golf_course"]',
        'relation["leisure"~"park|garden|stadium|golf_course"]',
        'way["landuse"~"grass|recreation_ground"]',
        'way["railway"~"rail|tram|light_rail"]',
    ]
    return "[out:json][timeout:170];(" + "".join(p + b + ";" for p in parts) + ");out geom;"


def main():
    data = urllib.parse.urlencode({"data": query(BBOX)}).encode()
    req = urllib.request.Request(URL, data=data, headers={
        # Overpass refuses requests without a descriptive User-Agent.
        "User-Agent": "Pathfinder-demo/1.0 (https://github.com/Agrim1305)",
    })
    for attempt in range(1, 5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            json.loads(body)  # fail early on an HTML error page
            OUT.parent.mkdir(exist_ok=True)
            OUT.write_bytes(body)
            print(f"Wrote {OUT} ({len(body) / 1e6:.1f} MB)")
            return 0
        except Exception as exc:  # 429/504 are common when Overpass is busy
            print(f"Attempt {attempt} failed: {exc}")
            time.sleep(15 * attempt)
    return 1


if __name__ == "__main__":
    sys.exit(main())
