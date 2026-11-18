// Runs the browser's search code (docs/adelaide/graph.js) on seeded random
// pairs of junctions and prints the results as JSON. Used by
// tests/test_adelaide_routes.py, which checks them against NetworkX.
//
//   node tests/adelaide_routes.js [pairs] [seed]
const fs = require("fs");
const path = require("path");
const AdelaideGraph = require("../docs/adelaide/graph.js");

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/adelaide/data/adelaide_cbd.json"), "utf8"));
const G = AdelaideGraph.load(raw);
const pairs = Number(process.argv[2] || 300);
let seed = Number(process.argv[3] || 7);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const runs = [];
for (let i = 0; i < pairs; i++) {
  const s = Math.floor(rnd() * G.N), t = Math.floor(rnd() * G.N);
  const r = AdelaideGraph.solve(G, s, t);
  const out = (x) => ({ found: !!x.path, dist: x.path ? x.dist : null, segments: x.pe.length, expanded: x.order.length, path: x.path });
  runs.push({ s, t, bfs: out(r.B), ucs: out(r.U), astar: out(r.A) });
}
const edges = G.edges.map((e) => [e.a, e.b, e.len]);
const coords = Array.from(G.nx, (x, i) => [x, G.ny[i]]);
process.stdout.write(JSON.stringify({ edges, coords, runs }));
