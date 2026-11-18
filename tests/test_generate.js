// Checks the random map generator (docs/generate.js): the same seed and
// settings always give the same grid, and for 500 seeds at each size the
// start and flag are dry and connected, the creek count matches, each creek
// is one cell wide and enters from an edge, and the heights stay in range.
// Run from the project root: node tests/test_generate.js
const assert = require("assert");
const PF = require("../docs/pathfinder.js");
const G = require("../docs/generate.js");

// Map generation must never touch Math.random.
const realRandom = Math.random;
Math.random = () => {
  throw new Error("generate.js called Math.random");
};
let checks = 0;

// Same seed and settings, same map; and the seed it reports reproduces it.
for (const opts of [{ seed: 12345, size: 20, creeks: 3, hills: "rolling" }, { seed: 7, size: 28, creeks: 4, hills: "steep" }, { seed: 0, size: 14, creeks: 0, hills: "flat" }]) {
  const a = G.generate(opts), b = G.generate(opts), c = G.generate(Object.assign({}, opts, { seed: a.seed }));
  assert.deepStrictEqual(b, a, "same seed, same map");
  assert.deepStrictEqual(c.grid, a.grid, "the seed it used gives the same grid");
  assert.ok(a.seed >= opts.seed, "it only ever moves on to a later seed");
  checks++;
}

const lower = { flat: 0, rolling: 2, steep: 5 }; // the tallest hill's centre sits on a cell, so the top reaches near its height
let retried = 0;
for (const size of G.SIZES) {
  for (let seed = 1; seed <= 500; seed++) {
    const want = { seed, size, creeks: seed % 5, hills: ["flat", "rolling", "steep"][seed % 3] };
    const m = G.generate(want), n = size, g = m.grid, tag = `size ${size} seed ${seed}`;
    if (m.seed !== seed) retried++;
    assert.strictEqual(g.length, n, `${tag}: rows`);
    assert.ok(g.every((row) => row.length === n), `${tag}: cols`);
    // pins: dry, apart, near opposite corners, connected
    const [s, e] = [m.start, m.end];
    assert.ok(g[s[0]][s[1]] !== -1 && g[e[0]][e[1]] !== -1, `${tag}: pins on dry cells`);
    assert.ok(s[0] + s[1] < n && e[0] + e[1] >= n - 1, `${tag}: pins near opposite corners`);
    assert.ok(PF.search("bfs", n, n, s, e, g).path, `${tag}: start and flag connected`);
    // creeks: as many separate channels as asked for, one cell wide, each touching an edge
    const seen = new Set();
    let creeks = 0;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (g[r][c] !== -1 || seen.has(r * n + c)) continue;
        creeks++;
        const stack = [[r, c]];
        let edge = false;
        seen.add(r * n + c);
        while (stack.length) {
          const [a, b] = stack.pop();
          if (a === 0 || b === 0 || a === n - 1 || b === n - 1) edge = true;
          for (const [x, y] of [[a - 1, b], [a + 1, b], [a, b - 1], [a, b + 1]])
            if (x >= 0 && x < n && y >= 0 && y < n && g[x][y] === -1 && !seen.has(x * n + y)) (seen.add(x * n + y), stack.push([x, y]));
        }
        assert.ok(edge, `${tag}: every creek enters from an edge`);
      }
    assert.strictEqual(creeks, want.creeks, `${tag}: creek count`);
    for (let r = 0; r + 1 < n; r++)
      for (let c = 0; c + 1 < n; c++)
        assert.ok(!(g[r][c] === -1 && g[r + 1][c] === -1 && g[r][c + 1] === -1 && g[r + 1][c + 1] === -1), `${tag}: creeks are one cell wide`);
    // heights: whole numbers within the setting's range
    const dry = g.flat().filter((v) => v !== -1), spec = G.HILLS[want.hills];
    assert.ok(dry.every((v) => Number.isInteger(v) && v >= 0 && v <= spec.high), `${tag}: heights 0 to ${spec.high}`);
    assert.ok(Math.max(...dry) >= lower[want.hills], `${tag}: ${want.hills} ground reaches ${lower[want.hills]}`);
  }
  checks++;
}

Math.random = realRandom;
console.log(`${checks} of ${checks} generator checks pass (1,500 maps; ${retried} seeds moved on to the next one)`);
