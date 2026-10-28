// Checks that the browser version (docs/pathfinder.js) gives exactly the same
// paths and visit counts as pathfinder.py on every map and algorithm.
// Run from the project root: node tests/compare_js.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const PF = require("../docs/pathfinder.js");

const root = path.join(__dirname, "..");
const python = process.env.PYTHON || "python3";
const pyScript = `
import json, sys
sys.path.insert(0, ".")
from pathfinder import parse_map, bfs, ucs, astar
out = {}
for m in ["small", "choice", "maze", "open", "large", "detour"]:
    rows, cols, s, e, g = parse_map(f"maps/{m}.txt")
    for name, fn in [("bfs", lambda: bfs(rows, cols, s, e, g)), ("ucs", lambda: ucs(rows, cols, s, e, g)),
                     ("astar_manhattan", lambda: astar(rows, cols, s, e, g, "manhattan")),
                     ("astar_euclidean", lambda: astar(rows, cols, s, e, g, "euclidean"))]:
        p, nv, _, _ = fn()
        out[m + "/" + name] = {"path": [list(x) for x in p] if p else None, "visits": nv}
print(json.dumps(out))
`;
const expected = JSON.parse(
  execFileSync(python, ["-c", pyScript], { cwd: root }).toString(),
);

let failures = 0,
  checks = 0;
for (const m of ["small", "choice", "maze", "open", "large", "detour"]) {
  const { rows, cols, start, end, grid } = PF.parseMap(
    fs.readFileSync(path.join(root, "maps", m + ".txt"), "utf8"),
  );
  const runs = {
    bfs: PF.search("bfs", rows, cols, start, end, grid),
    ucs: PF.search("ucs", rows, cols, start, end, grid),
    astar_manhattan: PF.search(
      "astar",
      rows,
      cols,
      start,
      end,
      grid,
      "manhattan",
    ),
    astar_euclidean: PF.search(
      "astar",
      rows,
      cols,
      start,
      end,
      grid,
      "euclidean",
    ),
  };
  for (const [name, res] of Object.entries(runs)) {
    checks++;
    const want = expected[m + "/" + name];
    const same =
      JSON.stringify(res.path) === JSON.stringify(want.path) &&
      JSON.stringify(res.numVisits) === JSON.stringify(want.visits);
    if (!same) {
      failures++;
      console.log("MISMATCH", m, name);
    }
  }
}
global.window = {};
require("../docs/maps.js");
for (const m of ["small", "choice", "maze", "open", "large", "detour"]) {
  checks++;
  const norm = (t) => t.replace(/\r\n/g, "\n").trim();
  if (
    norm(window.PATHFINDER_MAPS[m]) !==
    norm(fs.readFileSync(path.join(root, "maps", m + ".txt"), "utf8"))
  ) {
    failures++;
    console.log("docs/maps.js is out of date for", m);
  }
}
console.log(
  `${checks - failures} of ${checks} checks pass: browser results match pathfinder.py and the demo maps match maps/`,
);
process.exit(failures ? 1 : 0);
