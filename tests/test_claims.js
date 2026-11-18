// Checks the figures quoted on the front page and in the README against a
// fresh measurement: "Across 300 random walks it checked a median of 77%
// fewer junctions than Dijkstra" and "on all 300 test walks". It runs the
// same seeded walks as tests/test_adelaide_routes.py (reading the count and
// seed from that file) and fails if a quoted percentage is more than 2
// points from the measured one, or a quoted walk count differs.
// Run from the project root: node tests/test_claims.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// The NetworkX test's own walk count and seed.
const nx = read("tests/test_adelaide_routes.py");
const pairs = Number(/^PAIRS = (\d+)/m.exec(nx)[1]);
const seed = /adelaide_routes\.js"\), str\(PAIRS\), "(\d+)"/.exec(nx)[1];
const data = JSON.parse(execFileSync("node", [path.join(__dirname, "adelaide_routes.js"), String(pairs), seed], { maxBuffer: 64 << 20 }).toString());
const walks = data.runs.filter((r) => r.s !== r.t);
const saving = walks.map((r) => 1 - r.astar.expanded / r.ucs.expanded).sort((a, b) => a - b);
const median = (saving[(walks.length - 1) >> 1] + saving[walks.length >> 1]) / 2;
const measured = median * 100;
assert.ok(walks.every((r) => Math.abs(r.astar.dist - r.ucs.dist) < 1e-6), "A* finds exactly the same distance as Dijkstra on every walk");

let checks = 0;
for (const file of ["docs/index.html", "README.md"]) {
  const text = read(file).replace(/\\\*/g, "*").replace(/\s+/g, " ");
  const fewer = [...text.matchAll(/Across (\d+) random walks it checked a median of (\d+)% fewer junctions than Dijkstra/g)];
  const all = [...text.matchAll(/on all (\d+) test walks/g)];
  assert.ok(fewer.length && all.length, `${file} quotes both figures`);
  for (const [, n, pct] of fewer) {
    assert.strictEqual(Number(n), walks.length, `${file}: says ${n} random walks, the test runs ${walks.length}`);
    assert.ok(Math.abs(Number(pct) - measured) <= 2, `${file}: says ${pct}% fewer junctions, measured ${measured.toFixed(1)}%`);
    checks++;
  }
  for (const [, n] of all) {
    assert.strictEqual(Number(n), walks.length, `${file}: says all ${n} test walks, the test runs ${walks.length}`);
    checks++;
  }
  // the README's older wording: "a median of 23% as many junctions as Dijkstra"
  for (const [, pct] of text.matchAll(/median of (\d+)% as many junctions as Dijkstra/g)) {
    assert.ok(Math.abs(100 - Number(pct) - measured) <= 2, `${file}: says ${pct}% as many junctions, measured ${(100 - measured).toFixed(1)}%`);
    checks++;
  }
}
console.log(`${checks} of ${checks} quoted figures match the measurement (${walks.length} walks, A* checks a median of ${measured.toFixed(1)}% fewer junctions)`);
