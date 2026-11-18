// Checks the numbers behind the grid views (docs/runs.js) on every bundled
// map: "cells A* skipped" is exactly Dijkstra's closed cells minus A*'s, A*'s
// route costs the same as Dijkstra's, and the counts match the raw searches.
// Run from the project root: node tests/test_layers.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PF = require("../docs/pathfinder.js");
const Runs = require("../docs/runs.js");

const MAPS = ["small", "choice", "maze", "open", "large", "detour"];
let checks = 0;

for (const m of MAPS) {
  const { rows, cols, start, end, grid } = PF.parseMap(fs.readFileSync(path.join(__dirname, "..", "maps", m + ".txt"), "utf8"));
  const R = Runs.solve(grid, start, end);
  // Closed cells straight from the search: every distinct node taken off the queue.
  const closed = (algo) => new Set(PF.search(algo, rows, cols, start, end, grid, "manhattan").order.map(([r, c]) => r * cols + c));
  const ucs = closed("ucs"), astar = closed("astar");

  const want = [...ucs].filter((k) => !astar.has(k)).sort((a, b) => a - b);
  assert.deepStrictEqual([...R.skipped].sort((a, b) => a - b), want, `${m}: cells A* skipped`);
  assert.strictEqual(R.astar.cost, R.ucs.cost, `${m}: A* costs the same as Dijkstra`);
  for (const algo of Runs.ALGOS) {
    const raw = PF.search(algo, rows, cols, start, end, grid, "manhattan");
    assert.strictEqual(R[algo].nodes, raw.order.length, `${m} ${algo}: nodes taken off the queue`);
    assert.strictEqual(R[algo].cells, closed(algo).size, `${m} ${algo}: distinct cells`);
    assert.strictEqual(R[algo].cost, PF.pathCost(grid, raw.path), `${m} ${algo}: cost`);
  }
  checks++;
}

// The headline follows the numbers: on the demo map BFS pays more, on the
// flat open map every route costs the same.
const load = (m) => PF.parseMap(fs.readFileSync(path.join(__dirname, "..", "maps", m + ".txt"), "utf8"));
const detour = load("detour"), open = load("open");
assert.strictEqual(Runs.headline(Runs.solve(detour.grid, detour.start, detour.end)).title, "BFS pays for the climb. A* goes around it.");
assert.strictEqual(Runs.headline(Runs.solve(open.grid, open.start, open.end)).title, "No climb to dodge between these pins.");
checks++;

console.log(`${checks} of ${checks} layer checks pass`);
