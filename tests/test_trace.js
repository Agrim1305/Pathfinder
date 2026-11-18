// Checks that recording a trace never changes a search: on every bundled map,
// every algorithm gives the same path, cost, visit order, visit counts and
// node count with the trace on and off, and the trace has one entry per node
// taken off the queue. Run from the project root: node tests/test_trace.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PF = require("../docs/pathfinder.js");

const MAPS = ["small", "choice", "maze", "open", "large", "detour"];
const RUNS = [["bfs"], ["ucs"], ["astar", "manhattan"], ["astar", "euclidean"]];
let checks = 0;

for (const m of MAPS) {
  const { rows, cols, start, end, grid } = PF.parseMap(fs.readFileSync(path.join(__dirname, "..", "maps", m + ".txt"), "utf8"));
  for (const [algo, h = "manhattan"] of RUNS) {
    const label = `${m} ${algo} ${algo === "astar" ? h : ""}`.trim();
    const off = PF.search(algo, rows, cols, start, end, grid, h);
    const trace = [];
    const on = PF.search(algo, rows, cols, start, end, grid, h, trace);
    assert.deepStrictEqual(on.path, off.path, `${label}: path`);
    assert.strictEqual(PF.pathCost(grid, on.path), PF.pathCost(grid, off.path), `${label}: cost`);
    assert.deepStrictEqual(on.order, off.order, `${label}: visit order`);
    assert.deepStrictEqual(on.numVisits, off.numVisits, `${label}: visit counts`);
    assert.strictEqual(on.order.length, off.order.length, `${label}: nodes taken off the queue`);
    assert.deepStrictEqual(trace.map((t) => t.node), on.order, `${label}: one trace entry per node, in order`);
    // the entry that comes out next is the one the trace listed first
    for (let i = 0; i + 1 < trace.length; i++)
      assert.deepStrictEqual(trace[i].queue[0].node, trace[i + 1].node, `${label}: step ${i} names the next node out`);
    checks++;
  }
}

console.log(`${checks} of ${checks} runs match with the trace on and off`);
