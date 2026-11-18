# Architecture

## The pieces

- `pathfinder.py` is the reference: BFS, UCS (Dijkstra) and A\* on a grid, the cost rule
  `1 + max(0, climb)`, and the command-line interface. Python standard library only.
- `docs/pathfinder.js` is a line-for-line JavaScript port for the browser demo. It keeps the
  same neighbour order (up, down, left, right), the same `(priority, counter)` tie-breaking
  and the same lazy deletion. `tests/compare_js.js` runs both on every bundled map and fails
  if any path or visit count differs.
- `docs/index.html`, the front page, is the real-city demo. It runs the same three searches
  on Adelaide's walking network, described below; its code and data live in
  `docs/adelaide/`. `docs/adelaide/index.html` only forwards old links to the front page.
- `docs/grid/` is the grid demo (Grid 2D, Grid 3D and Step through). Both are static pages
  with no build step, served by GitHub Pages from `docs/`.

No page has a build step or a runtime dependency. Every script is a plain file that a page
loads with a `<script>` tag. The ones with pure logic also export themselves for Node, so the
tests run the exact code the pages run. Local files carry a version query (`app.js?v=25`),
bumped on every change, so a browser never mixes a cached old file with a new one.

## Shared code: `docs/shared/`

- **Camera, `view.js`.** Both maps use one camera, `{ th, tilt, k, cx, cy }`: turn, tilt (0
  is flat with north up), pixels per world unit and the world point at the centre. `P(x, y,
  z)` projects a world point to the canvas and `unP(X, Y)` takes a canvas pixel back to the
  ground. It handles dragging (turn in 3D, slide in 2D or with Shift), wheel and two-finger
  pinch zoom around the pointer, arrow keys and + and -, a little turning momentum, 650 ms
  ease-out tweens between 2D and 3D, framing a set of points, and HiDPI sizing with a
  ResizeObserver. Its animation loop only runs while something moves. A page can take over a
  press with `grab()`, which the grid uses for dragging pins and painting cells.
  `tests/test_view.js` checks the maths in Node.
- **Labels, `labels.js`.** Labels are placed in priority order: pins, then landmarks, then
  streets. Each label takes its first candidate spot that overlaps no label already placed,
  no pin, no control floating over the map and no edge of the canvas; with no free spot it is
  left out. `tests/test_labels.js` checks that placed boxes never overlap.
- **Theme, `theme.css` and `theme.js`.** One set of colour tokens with light and dark values
  for both pages. `theme.js` runs in `<head>`, so the right theme is set before the first
  paint. It follows the system until the header button picks Light or Dark, remembers the
  choice in localStorage and the URL hash, and fades colours for 300 ms (at once under
  reduced motion). The canvases listen and fade their own palettes. `tests/test_contrast.js`
  checks every text and control colour, and the map label colours, against WCAG AA.
- **`scroll.js`** marks rows that scroll sideways on narrow screens, so CSS can fade out the
  edge with more to see.

## The grid demo: `docs/grid/`

### Terrain model: `docs/terrain.js`

The search runs on the exact grid values; the terrain is only for display. Impassable cells
become a creek: each takes the average height of the dry ground around it, so it follows the
land instead of leaving a pit. The heightfield samples each cell 3 times per side, blends the
four nearest cell centres, and softens the result with two passes of a 3x3 blur. Then it
carves the water: every water vertex sits a fixed depth below the lowest dry vertex beside it,
after the blur, so the banks stay crisp and slope down inside the creek cells. Hillshade comes
from a light at the top left, and contour lines at every whole height come from marching
squares over the heightfield. The four map styles (Terrain, Topo, Clay, Night) are colour
functions of height, light and water, plus a few tokens each. `tests/test_terrain.js` checks
that it is deterministic, that water sits below the ground beside it, that contour points lie
on their level, and that every style gives valid colours.

### One renderer, flat or tilted

`board.js` draws everything on top of the ground through the shared camera: the search
layers, routes, marker, pins and labels. Every point sits on the terrain surface, so the same
code works flat or tilted. For the ground itself it calls `grid3d.js` whenever the camera is
tilted, and otherwise draws one cached image of the shaded terrain. So switching between Grid
2D and Grid 3D is just a camera tween on the same canvas, and keeps the run, the pins and the
timeline.

`grid3d.js` uses the painter's algorithm: the heightfield's sub-quads are sorted back to
front by their depth after turning and drawn in that order, with the survey grid and contour
lines stroked as it goes, so a hill hides the lines behind it. The model sits on a diorama
base with sides in soil colour and a soft shadow underneath. While the camera moves, it draws
one quad per cell instead of nine and drops the contours, and the full detail returns 150 ms
after the camera stops, the usual detail-while-moving trick: on the 20 by 20 map that is 60
fps while turning, against 55 fps with full detail.

### Why 3D follows the timeline instead of its own clock

There is one clock: the timeline in `app.js`. Each frame works out how far along it is (how
many steps of the search, how much of the routes, how far the marker has walked) and the
renderer draws that state. The 3D view has no animation of its own, so pausing, stepping and
scrubbing work the same in 2D and 3D, switching views never restarts anything, and reduced
motion only has to jump the one clock to the end.

### Why canvas 2D instead of WebGL

WebGL would need either a library such as Three.js or a few hundred lines of shader and
buffer code, against the rule of no runtime dependencies and no build step. The scenes are
small: at most 28 by 28 cells, or 7,056 sub-quads, and the Adelaide map's few thousand
buildings. Canvas 2D draws them fast enough, it already draws the text, routes and labels,
and the same code runs on every browser without a GPU context to lose.

### Step through and the trace

`search()` in `docs/pathfinder.js` takes an optional trace array. For every node taken off
the queue it records the node, its g and f, whether it was stale or the goal, how many
neighbours it pushed or skipped, the queue size and the next few entries in the queue. It
only reads the search's state, and `tests/test_trace.js` checks that every map and algorithm
gives the same path, cost, visit order and node count with the trace on and off. `runs.js`
turns the traces into what the page shows: costs, nodes taken off the queue (stale ones
included) and distinct cells, the cells A\* skipped, the headline, and `frontierAt()`, which
rebuilds the whole queue at any step by replaying the trace. `tests/test_layers.js` checks
these numbers, including the queue size at every step.

### Random maps: `docs/generate.js`

Maps come from a seed and use mulberry32, a small 32-bit generator, for every random choice,
never `Math.random`, so a link with `seed=` reproduces the map exactly. Ground is the sum of 1
to 3 smooth hills; creeks are channels one cell wide that start at an edge and wander inward
without touching another creek. The pins go on the dry cells nearest opposite corners, and if
they are not connected the next seed is tried and the link records the seed actually used.
`tests/test_generate.js` checks 1,500 maps.

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

### 5. The page

`docs/index.html` loads the map data with `<link rel="preload">`, so it downloads alongside
the scripts, and sizes the map before the data arrives, so nothing jumps when it appears.
`docs/adelaide/palette.js` holds the map's light and dark colours; the page fades between
them with the theme. `docs/adelaide/index.html` forwards old links to the front page, and the
front page sends old grid links (`#view=`, `#map=`) on to `grid/`.
