/*
 * Terrain model for the grid views: turns a grid of elevations into a smooth
 * landscape with a sunken creek, hillshade, contour lines and four map styles.
 *
 * Display only: the searches still run on the exact grid values. Pure code
 * with no DOM, so tests/test_terrain.js runs it in Node. In the browser it
 * sets window.Terrain.
 *
 * Coordinates are in cells: u runs along columns and v along rows, so cell
 * (r, c) covers u from c to c + 1 and v from r to r + 1. Heights are in
 * elevation units (0 to 9 on the bundled maps).
 */
(function (root) {
  "use strict";

  const DEFAULTS = {
    S: 3, // heightfield samples per cell side
    depth: 0.6, // how far the creek sits below the ground around it
    zScale: 0.3, // cells of height per elevation unit, for shading and 3D
    blurPasses: 2,
  };
  // Light from the top left, 45 degrees up.
  const LIGHT = (() => {
    const v = [-1, -1, Math.SQRT2], n = Math.hypot(...v);
    return v.map((x) => x / n);
  })();

  // ---------- colours ----------
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const clamp255 = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const css = (c) => `rgb(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])})`;

  // A height ramp: stops of [height, colour], clamped at both ends.
  function ramp(stops, z) {
    if (z <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [z1, c1] = stops[i];
      if (z <= z1) {
        const [z0, c0] = stops[i - 1];
        return mix(c0, c1, (z - z0) / (z1 - z0));
      }
    }
    return stops[stops.length - 1][1];
  }

  const TERRAIN_STOPS = [
    [-0.6, "#8FBCD2"], [0, "#E7EADE"], [2, "#D3DDBE"], [4.5, "#B4C597"], [7, "#95AA78"], [9, "#B9B398"],
  ].map(([z, c]) => [z, hex(c)]);
  const PAPER = hex("#F7F7F1");

  // Each style: a height ramp, shading (factor = a + b * light), water, and the
  // tokens the renderers need for the base, grid, contours, labels and overlay.
  const STYLES = {
    terrain: {
      label: "Terrain",
      description: "Green lowland rising to a pale rocky top, like a relief map.",
      stops: TERRAIN_STOPS,
      shade: [0.8, 0.3],
      water: hex("#8FBCD2"),
      contour: null,
      side: "#CDBFA6",
      stage: "#EEF0EC",
      grid: "rgba(255,255,255,0.45)",
      ink: "#15181D",
      dark: false,
      overlay: { astar: "#1D4ED8", bfs: "#C2410C", best: "#1D4ED8", skipped: "#0F766E" },
    },
    topo: {
      label: "Topo",
      description: "A paper walking map with a brown contour at every level.",
      stops: TERRAIN_STOPS.map(([z, c]) => [z, mix(c, PAPER, 0.62)]),
      shade: [0.9, 0.14],
      water: mix(hex("#8FBCD2"), PAPER, 0.62),
      contour: { colour: "#8A7652", alpha: 0.6 },
      side: "#E4E1D6",
      stage: "#F5F5EF",
      grid: "rgba(255,255,255,0.5)",
      ink: "#15181D",
      dark: false,
      overlay: { astar: "#1D4ED8", bfs: "#C2410C", best: "#1D4ED8", skipped: "#0F766E" },
    },
    clay: {
      label: "Clay",
      description: "A plain white model, so only the search adds colour.",
      stops: [[-0.6, hex("#C5D3DF")], [0, hex("#EEEFF1")]],
      shade: [0.74, 0.32],
      water: hex("#C5D3DF"),
      contour: null,
      side: "#D5D7DB",
      stage: "#ECEEF1",
      grid: "rgba(255,255,255,0.6)",
      ink: "#15181D",
      dark: false,
      overlay: { astar: "#1D4ED8", bfs: "#C2410C", best: "#1D4ED8", skipped: "#0F766E" },
    },
    night: {
      label: "Night",
      description: "Dark slate with bright search colours.",
      stops: [[-0.6, hex("#123B5C")], [0, hex("#16212D")], [9, hex("#4E6A82")]],
      shade: [0.45, 0.8],
      water: hex("#123B5C"),
      contour: { colour: "#CBDCEB", alpha: 0.22 },
      side: "#111A24",
      stage: "#0E151D",
      grid: "rgba(203,220,235,0.08)",
      ink: "#E8EEF4",
      dark: true,
      overlay: { astar: "#3B82F6", bfs: "#FB923C", best: "#60A5FA", skipped: "#2DD4BF" },
    },
  };

  // The shaded colour of the ground (or water) at height z with light 0 to 1,
  // as [r, g, b] with whole numbers from 0 to 255.
  function colourFor(style, z, light, water) {
    const s = STYLES[style];
    const base = water ? s.water : ramp(s.stops, z);
    const f = s.shade[0] + s.shade[1] * light;
    return base.map((x) => clamp255(x * f));
  }

  // ---------- heightfield ----------

  // Impassable cells take the average height of their passable neighbours, so
  // the creek follows the ground instead of leaving a pit. Cells walled in by
  // other creek cells take the average of neighbours filled on an earlier pass.
  function fillCreek(grid) {
    const rows = grid.length, cols = grid[0].length;
    const h = grid.map((row) => row.map((v) => (v === -1 ? null : v)));
    for (let left = true; left; ) {
      left = false;
      const next = h.map((row) => row.slice());
      let filled = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (h[r][c] !== null) continue;
          let sum = 0, n = 0;
          for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
            const v = nr >= 0 && nr < rows && nc >= 0 && nc < cols ? h[nr][nc] : null;
            if (v !== null) { sum += v; n++; }
          }
          if (n) { next[r][c] = sum / n; filled++; } else left = true;
        }
      for (let r = 0; r < rows; r++) h[r] = next[r];
      if (left && !filled) break; // no passable ground at all
    }
    return h.map((row) => row.map((v) => (v === null ? 0 : v)));
  }

  function buildTerrain(grid, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const S = o.S, rows = grid.length, cols = grid[0].length;
    const nu = cols * S + 1, nv = rows * S + 1, N = nu * nv;
    const H = fillCreek(grid);
    const cellH = (r, c) => H[Math.min(rows - 1, Math.max(0, r))][Math.min(cols - 1, Math.max(0, c))];

    // Sample every vertex by blending the four nearest cell centres.
    let z = new Float64Array(N);
    for (let j = 0; j < nv; j++) {
      const v = j / S - 0.5, r0 = Math.floor(v), ty = v - r0;
      for (let i = 0; i < nu; i++) {
        const u = i / S - 0.5, c0 = Math.floor(u), tx = u - c0;
        const top = cellH(r0, c0) + (cellH(r0, c0 + 1) - cellH(r0, c0)) * tx;
        const bot = cellH(r0 + 1, c0) + (cellH(r0 + 1, c0 + 1) - cellH(r0 + 1, c0)) * tx;
        z[j * nu + i] = top + (bot - top) * ty;
      }
    }

    // Soften with a 3x3 blur (weights 1-2-1 in each direction).
    for (let pass = 0; pass < o.blurPasses; pass++) {
      const out = new Float64Array(N);
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          let sum = 0, w = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || ii >= nu || jj < 0 || jj >= nv) continue;
              const k = (di ? 1 : 2) * (dj ? 1 : 2);
              sum += z[jj * nu + ii] * k;
              w += k;
            }
          out[j * nu + i] = sum / w;
        }
      z = out;
    }

    // A vertex is water when every cell it touches is impassable, so banks
    // slope down inside the creek cells and dry cells keep their full height.
    const water = new Uint8Array(N);
    const blocked = (r, c) => r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] === -1;
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const cs = i % S ? [Math.floor(i / S)] : [i / S - 1, i / S];
        const rs = j % S ? [Math.floor(j / S)] : [j / S - 1, j / S];
        let inside = false, all = true;
        for (const r of rs)
          for (const c of cs) {
            if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
            inside = true;
            if (!blocked(r, c)) all = false;
          }
        water[j * nu + i] = inside && all ? 1 : 0;
      }

    // Carve the water after the blur so the banks stay crisp. Each water vertex
    // sits a full depth below the lowest dry vertex next to it.
    const carved = Float64Array.from(z);
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        if (!water[k]) continue;
        let low = z[k];
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || ii >= nu || jj < 0 || jj >= nv || water[jj * nu + ii]) continue;
            low = Math.min(low, z[jj * nu + ii]);
          }
        carved[k] = low - o.depth;
      }
    z = carved;

    // Hillshade: how squarely each vertex faces the light, from 0 to 1.
    const light = new Float32Array(N), step = 1 / S;
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(nu - 1, i + 1);
        const j0 = Math.max(0, j - 1), j1 = Math.min(nv - 1, j + 1);
        const du = ((z[j * nu + i1] - z[j * nu + i0]) / ((i1 - i0) * step)) * o.zScale;
        const dv = ((z[j1 * nu + i] - z[j0 * nu + i]) / ((j1 - j0) * step)) * o.zScale;
        const n = Math.hypot(du, dv, 1);
        light[j * nu + i] = Math.max(0, Math.min(1, (-du * LIGHT[0] - dv * LIGHT[1] + LIGHT[2]) / n));
      }

    // Bilinear lookup on any per-vertex field.
    function sample(field, u, v) {
      const fu = Math.max(0, Math.min(nu - 1, u * S)), fv = Math.max(0, Math.min(nv - 1, v * S));
      const i = Math.min(nu - 2, Math.floor(fu)), j = Math.min(nv - 2, Math.floor(fv));
      const tx = fu - i, ty = fv - j, k = j * nu + i;
      const top = field[k] + (field[k + 1] - field[k]) * tx;
      const bot = field[k + nu] + (field[k + nu + 1] - field[k + nu]) * tx;
      return top + (bot - top) * ty;
    }

    // Contour line segments at one height, as [u1, v1, u2, v2, ...], by marching
    // squares over the heightfield. Squares that touch water are skipped.
    function contours(level) {
      const out = [];
      for (let j = 0; j < nv - 1; j++)
        for (let i = 0; i < nu - 1; i++) {
          const k = j * nu + i, ks = [k, k + 1, k + nu + 1, k + nu]; // corners clockwise from top left
          if (ks.some((q) => water[q])) continue;
          const zs = ks.map((q) => z[q]), up = zs.map((x) => x >= level);
          if (up.every((x) => x === up[0])) continue;
          const pos = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
          // edge e runs from corner e to corner e + 1
          const cross = (e) => {
            const a = e, b = (e + 1) % 4, t = (level - zs[a]) / (zs[b] - zs[a]);
            return [(pos[a][0] + (pos[b][0] - pos[a][0]) * t) / S, (pos[a][1] + (pos[b][1] - pos[a][1]) * t) / S];
          };
          const edges = [0, 1, 2, 3].filter((e) => up[e] !== up[(e + 1) % 4]);
          let pairs;
          if (edges.length === 2) pairs = [edges];
          else {
            // a saddle: the centre decides which corners join up
            const centre = zs.reduce((a, b) => a + b) / 4 >= level;
            pairs = centre === up[0] ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
          }
          for (const [ea, eb] of pairs) out.push(...cross(ea), ...cross(eb));
        }
      return out;
    }

    let top = -Infinity;
    for (let k = 0; k < N; k++) if (!water[k]) top = Math.max(top, z[k]);
    const levels = [];
    for (let L = 1; L <= top; L++) levels.push(L);

    return {
      rows, cols, S, nu, nv, z, water, light, zScale: o.zScale, levels,
      heightAt: (u, v) => sample(z, u, v),
      lightAt: (u, v) => sample(light, u, v),
      waterAt: (u, v) => sample(water, u, v),
      contours,
    };
  }

  const api = { buildTerrain, colourFor, STYLES, mix, css, hex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Terrain = api;
})(typeof window !== "undefined" ? window : globalThis);
