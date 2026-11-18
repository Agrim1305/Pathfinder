/*
 * Random grid maps from a seed. The same seed and settings give the same map
 * on any machine, because every random number comes from mulberry32 (a small
 * 32-bit generator), never Math.random.
 *
 * Settings: size 14, 20 or 28; creeks 0 to 4, each a meandering channel one
 * cell wide that enters from an edge; hills flat, rolling or steep, the sum
 * of 1, 2 or 3 smooth hills with random centres and heights from 0 to 9.
 * The start and the flag go on the dry cells nearest opposite corners. If a
 * seed leaves them unconnected, the next seed is tried, and the result says
 * which seed was used.
 *
 * Plain script: window.Generate in the browser, a CommonJS module in Node
 * for tests/test_generate.js.
 */
(function (root) {
  "use strict";
  const PF = typeof module !== "undefined" && module.exports ? require("./pathfinder.js") : root.Pathfinder;

  const SIZES = [14, 20, 28];
  const HILLS = {
    flat: { count: 1, low: 0, high: 2 },
    rolling: { count: 2, low: 3, high: 6 },
    steep: { count: 3, low: 6, high: 9 },
  };
  const DEFAULTS = { seed: 1, size: 20, creeks: 2, hills: "rolling" };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Settings outside the allowed values fall back to the defaults.
  function settings(o = {}) {
    const n = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));
    const seed = Number.isInteger(n(o.seed)) && n(o.seed) >= 0 ? n(o.seed) >>> 0 : DEFAULTS.seed;
    return {
      seed,
      size: SIZES.includes(n(o.size)) ? n(o.size) : DEFAULTS.size,
      creeks: Number.isInteger(n(o.creeks)) && n(o.creeks) >= 0 && n(o.creeks) <= 4 ? n(o.creeks) : DEFAULTS.creeks,
      hills: HILLS[o.hills] ? o.hills : DEFAULTS.hills,
    };
  }

  // A channel one cell wide from a random point on an edge, wandering inward.
  // A new cell may only touch the cell before it, so the creek never doubles
  // back on itself or meets another creek.
  function carveCreek(grid, rnd, int) {
    const n = grid.length, wet = (r, c) => r >= 0 && r < n && c >= 0 && c < n && grid[r][c] === -1;
    const around = (r, c) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (let tries = 0; tries < 40; tries++) {
      const edge = int(0, 3), p = int(1, n - 2);
      let [r, c] = [[0, p], [n - 1, p], [p, 0], [p, n - 1]][edge];
      let [dr, dc] = [[1, 0], [-1, 0], [0, 1], [0, -1]][edge];
      if (wet(r, c) || around(r, c).some(([a, b]) => wet(a, b))) continue;
      const cells = [[r, c]], mine = new Set([r * n + c]);
      const length = int(Math.floor(n * 0.5), Math.floor(n * 1.1));
      while (cells.length < length) {
        const x = rnd();
        if (x < 0.2) [dr, dc] = [dc, -dr];
        else if (x < 0.4) [dr, dc] = [-dc, dr];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) break; // left the map
        const touching = around(nr, nc).filter(([a, b]) => !(a === r && b === c));
        if (mine.has(nr * n + nc) || touching.some(([a, b]) => wet(a, b) || mine.has(a * n + b))) break;
        cells.push([nr, nc]);
        mine.add(nr * n + nc);
        [r, c] = [nr, nc];
      }
      if (cells.length < 3) continue;
      for (const [a, b] of cells) grid[a][b] = -1;
      return true;
    }
    return false;
  }

  // The dry cell nearest a corner, by steps along the grid.
  function nearestDry(grid, r0, c0) {
    const n = grid.length;
    for (let d = 0; d < 2 * n; d++)
      for (let dr = 0; dr <= d; dr++) {
        const r = r0 === 0 ? dr : n - 1 - dr, c = c0 === 0 ? d - dr : n - 1 - (d - dr);
        if (r >= 0 && r < n && c >= 0 && c < n && grid[r][c] !== -1) return [r, c];
      }
    return null;
  }

  function attempt(seed, o) {
    const rnd = mulberry32(seed), n = o.size, spec = HILLS[o.hills];
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const field = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let h = 0; h < spec.count; h++) {
      const cr = int(0, n - 1), cc = int(0, n - 1), height = int(spec.low, spec.high), sigma = n * (0.12 + rnd() * 0.12);
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) field[r][c] += height * Math.exp(-((r - cr) ** 2 + (c - cc) ** 2) / (2 * sigma * sigma));
    }
    const grid = field.map((row) => row.map((v) => Math.min(spec.high, Math.round(v))));
    for (let k = 0; k < o.creeks; k++) if (!carveCreek(grid, rnd, int)) return null;
    const start = nearestDry(grid, 0, 0), end = nearestDry(grid, n - 1, n - 1);
    if (!start || !end || (start[0] === end[0] && start[1] === end[1])) return null;
    if (!PF.search("bfs", n, n, start, end, grid).path) return null;
    return { rows: n, cols: n, grid, start, end };
  }

  // { seed, size, creeks, hills } in; the map plus the settings and the seed actually used out.
  function generate(opts) {
    const o = settings(opts);
    for (let i = 0; i < 10000; i++) {
      const seed = (o.seed + i) >>> 0, map = attempt(seed, o);
      if (map) return Object.assign(map, o, { seed });
    }
    throw new Error("No connected map found near seed " + o.seed);
  }

  const api = { generate, settings, mulberry32, SIZES, HILLS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Generate = api;
})(typeof window !== "undefined" ? window : globalThis);
