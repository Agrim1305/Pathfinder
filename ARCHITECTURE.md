# Architecture

## The pieces

- `pathfinder.py` is the reference: BFS, UCS (Dijkstra) and A\* on a grid, the cost rule
  `1 + max(0, climb)`, and the command-line interface. Python standard library only.
- `docs/pathfinder.js` is a line-for-line JavaScript port for the browser demo. It keeps the
  same neighbour order (up, down, left, right), the same `(priority, counter)` tie-breaking
  and the same lazy deletion. `tests/compare_js.js` runs both on every bundled map and fails
  if any path or visit count differs.
- `docs/index.html` is the grid demo. It's a static page with no build step, served by
  GitHub Pages from `docs/`.
- `docs/adelaide/` is the real-city demo. It runs the same three searches on Adelaide's
  walking network, described below.

## Adelaide CBD pipeline

The map data goes through two scripts before the browser sees it. Both live in `tools/`, and
`tools/requirements.txt` lists what they need (Shapely for prep, NetworkX for the tests).

### 1. Download: `tools/fetch_adelaide.py`

One Overpass query fetches everything in a box from West Terrace to East Terrace and from
South Terrace to just north of Adelaide Oval (latitude -34.938 to -34.912, longitude 138.583
to 138.617). It asks for buildings, highways, water, parks and grass, and rail and tram lines,
all with full geometry. Overpass often answers 429 or 504 when it's busy, so the script tries
up to four times with a growing wait. It writes `data/adelaide_raw.json`, about 9 MB, which
`.gitignore` keeps out of the repo.

### 2. Prepare: `tools/prep_adelaide.py`

This turns the raw download into `docs/adelaide/data/adelaide_cbd.json`, about 820 KB.

- **Projection to local metres.** Each point becomes metres east and south of a fixed point
  in Victoria Square (-34.9255, 138.6000), using an equirectangular projection. Across a box
  about 3 km wide the error is well under 0.1%, and the maths in the browser stays plain
  Euclidean.
- **Half-metre integer storage.** Every coordinate is stored as a whole number of half
  metres. That keeps the JSON small and is far finer than the map can show.
- **Buildings.** Outlines are repaired with Shapely if they're invalid, then simplified to
  0.6 m. The height comes from the `height` tag, or `building:levels` × 3.3 m + 1 m, or a
  typical 7 m or 10 m by footprint area when neither exists. Those estimated buildings are
  flagged, and the page draws their roofs a shade darker.
- **Walking network.** Every highway type a person can walk on is kept, except ways tagged
  `access=private`, `access=no` or `foot=no`. Only the largest connected component survives, so every pair of
  junctions has a route.
- **Degree-2 contraction.** A node with exactly two neighbours is just a bend in the road, so
  it folds into the segment that runs through it. The exception is a node where the road
  class changes, which stays so each segment has one class. What's left is 7,539 junctions
  and 11,602 segments. Each segment keeps its bend points for drawing.
- **Labels and default pins.** The script picks street label positions and landmark names,
  and places the default start near Adelaide Oval and the flag on Gouger St by Central
  Market.

### 3. One search file for the browser and Node: `docs/adelaide/graph.js`

`graph.js` is a plain script. In the browser it sets `window.AdelaideGraph`; under Node it is
a CommonJS module. The page and `tests/adelaide_routes.js` load the same file, so the
NetworkX tests in `tests/test_adelaide_routes.py` check the exact code the page runs, on 300
seeded random pairs of junctions.

The searches follow the grid rules: a FIFO queue for BFS and a binary heap for the others,
ordered by `(priority, insertion counter)`, with lazy deletion (a junction can sit in the
heap more than once, and stale copies are skipped when they come out) and a junction closed
the first time it is popped. Dijkstra and A\* count metres; BFS counts segments. A\*'s
heuristic is the straight-line distance to the flag.

`map.js` draws the map on a canvas in 2D or 3D and handles the controls. It doesn't search;
it calls `graph.js`.

### 4. Why edge lengths are measured on the stored points

A\* may close a junction the first time it pops it only if the heuristic is consistent: for
every segment from `u` to `v`, `h(u) <= length(u, v) + h(v)`. The heuristic is a straight
line between stored (rounded) junction positions.

An earlier version took segment lengths from the original, unrounded points. Rounding can
move a segment's two ends apart, so the straight line between the stored ends could be up to
0.7 m longer than the segment's measured length. That broke consistency, and A\* returned
routes up to 0.4 m longer than Dijkstra's.

Now `graph.js` measures every segment along its stored points when it loads. The straight
line between a segment's ends can never be longer than a path through those same points
(the triangle inequality), so the heuristic is consistent by construction.
`test_heuristic_is_consistent` checks every segment. The data file still carries the old
length (tenths of a metre, unrounded) in each segment's third field; `graph.js` ignores it.
