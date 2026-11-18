/*
 * Draws the grid map on a canvas through the shared camera
 * (docs/shared/view.js): terrain, survey grid, contours, the search layers,
 * both routes, the marker, pins and labels. Every number comes from the run
 * in docs/runs.js; app.js decides how far along the timeline we are.
 *
 * Cells are in world units: cell (r, c) covers u from c to c + 1 and v from
 * r to r + 1. Heights come from docs/terrain.js, so overlays sit on the
 * surface when the camera tilts.
 */
(function (root) {
  "use strict";
  const T = root.Terrain;
  const PX_PER_CELL = 28; // resolution of the flat terrain image
  const images = new WeakMap(); // terrain -> { style: canvas }
  const contourCache = new WeakMap(); // terrain -> [[level, segments], ...]

  const blend = (a, b, t) => (t >= 1 ? b : T.css(T.mix(T.hex(a), T.hex(b), t)));

  // The terrain as one shaded image, one pixel per 1/28 of a cell.
  function terrainImage(terrain, style) {
    let byStyle = images.get(terrain);
    if (!byStyle) images.set(terrain, (byStyle = {}));
    if (byStyle[style]) return byStyle[style];
    const R = PX_PER_CELL, w = terrain.cols * R, h = terrain.rows * R;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d"), img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / R;
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / R;
        const c = T.colourFor(style, terrain.heightAt(u, v), terrain.lightAt(u, v), terrain.waterAt(u, v) > 0.5);
        const i = (y * w + x) * 4;
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return (byStyle[style] = cv);
  }

  function contourLines(terrain) {
    if (!contourCache.has(terrain)) contourCache.set(terrain, terrain.levels.map((L) => [L, terrain.contours(L)]));
    return contourCache.get(terrain);
  }

  // The flat terrain: the image drawn through the camera's affine map.
  function flatSurface(ctx, view, s, P0) {
    const o = P0(0, 0), ux = P0(1, 0), vy = P0(0, 1), R = PX_PER_CELL;
    ctx.save();
    ctx.transform((ux[0] - o[0]) / R, (ux[1] - o[1]) / R, (vy[0] - o[0]) / R, (vy[1] - o[1]) / R, o[0], o[1]);
    ctx.imageSmoothingEnabled = true;
    if (s.fade < 1) {
      ctx.drawImage(terrainImage(s.terrain, s.fromStyle), 0, 0);
      ctx.globalAlpha = s.fade;
    }
    ctx.drawImage(terrainImage(s.terrain, s.style), 0, 0);
    ctx.restore();
  }

  function draw(view, s) {
    const ctx = view.ctx, W = view.W, H = view.H, t = s.terrain, R = s.R;
    const rows = t.rows, cols = t.cols;
    const st = T.STYLES[s.style], from = T.STYLES[s.fromStyle];
    const col = (key) => blend(from.overlay[key], st.overlay[key], s.fade);
    const stage = blend(from.stage, st.stage, s.fade), ink = blend(from.ink, st.ink, s.fade);
    const z = (u, v) => t.heightAt(u, v) * t.zScale;
    const P = (u, v, lift = 0) => view.P(u, v, z(u, v) + lift); // a point on the surface
    const P0 = (u, v) => view.P(u, v, 0);
    const cellPx = Math.hypot(...[0, 1].map((i) => P0(1, 0)[i] - P0(0, 0)[i]));

    ctx.fillStyle = stage;
    ctx.fillRect(0, 0, W, H);
    const surface = view.cam.tilt > 1e-3 && root.Grid3D ? root.Grid3D.surface : flatSurface;
    surface(ctx, view, s, P0);

    // survey grid along cell edges, following the ground
    const path = (pts) => pts.forEach(([u, v], i) => (i ? ctx.lineTo(...P(u, v)) : ctx.moveTo(...P(u, v))));
    const edge = (u0, v0, u1, v1) => {
      const n = Math.max(1, Math.round(Math.hypot(u1 - u0, v1 - v0) * t.S)), pts = [];
      for (let i = 0; i <= n; i++) pts.push([u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n]);
      path(pts);
    };
    ctx.beginPath();
    for (let r = 0; r <= rows; r++) edge(0, r, cols, r);
    for (let c = 0; c <= cols; c++) edge(c, 0, c, rows);
    ctx.lineWidth = 1;
    ctx.strokeStyle = st.grid;
    ctx.stroke();

    if (st.contour) {
      ctx.beginPath();
      for (const [L, seg] of contourLines(t)) {
        const zl = L * t.zScale;
        for (let i = 0; i < seg.length; i += 4) {
          ctx.moveTo(...view.P(seg[i], seg[i + 1], zl));
          ctx.lineTo(...view.P(seg[i + 2], seg[i + 3], zl));
        }
      }
      ctx.globalAlpha = st.contour.alpha * (s.style === s.fromStyle ? 1 : s.fade);
      ctx.strokeStyle = st.contour.colour;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const quad = (r, c, inset) => {
      const a = inset, b = 1 - inset;
      path([[c + a, r + a], [c + b, r + a], [c + b, r + b], [c + a, r + b]]);
      ctx.closePath();
    };
    const centre = ([r, c], lift) => P(c + 0.5, r + 0.5, lift);
    const kOf = (a) => Math.min(s.k, R[a].nodes);

    // Text with a halo of the stage colour, so it reads on any ground.
    const label = (txt, X, Y, font, colour, align = "center") => {
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = stage;
      ctx.strokeText(txt, X, Y);
      ctx.fillStyle = colour;
      ctx.fillText(txt, X, Y);
    };
    const FONT = "Geist, -apple-system, system-ui, sans-serif";

    // elevation numbers sit under the search layers
    if (s.layers.numbers && cellPx >= 14) {
      const size = Math.max(9, Math.min(13, cellPx * 0.3));
      ctx.globalAlpha = 0.75;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (s.grid[r][c] !== -1) label(String(s.grid[r][c]), ...centre([r, c], 0.02), `600 ${size}px ${FONT}`, ink);
      ctx.globalAlpha = 1;
    }
    // Cells A* skipped: Dijkstra has taken them off its queue by now, A* never does.
    if (s.layers.skipped && R.skipped.length) {
      const kU = kOf("ucs"), close = R.ucs.closeStep;
      ctx.save();
      ctx.beginPath();
      let any = false;
      for (const k of R.skipped) {
        if (close[k] >= kU) continue;
        quad(Math.floor(k / cols), k % cols, 0.08);
        any = true;
      }
      if (any) {
        const teal = col("skipped");
        ctx.fillStyle = teal;
        ctx.globalAlpha = 0.14;
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1;
        ctx.strokeStyle = teal;
        ctx.stroke();
        ctx.clip();
        ctx.beginPath();
        for (let x = -H; x < W; x += 7) {
          ctx.moveTo(x, H);
          ctx.lineTo(x + H, 0);
        }
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // A* explored: a dot on every cell A* has taken off its queue so far.
    const A = R.astar, kA = kOf("astar"), dot = Math.max(2, Math.min(6, cellPx * 0.11));
    if (s.layers.explored && kA > 0) {
      ctx.beginPath();
      for (let i = 0; i < kA; i++) {
        if (A.trace[i].stale) continue;
        const [X, Y] = centre(A.trace[i].node, 0.02);
        ctx.moveTo(X + dot, Y);
        ctx.arc(X, Y, dot, 0, 2 * Math.PI);
      }
      ctx.fillStyle = col("astar");
      ctx.fill();
      if (kA < A.nodes) {
        const [X, Y] = centre(A.trace[kA - 1].node, 0.02);
        ctx.beginPath();
        ctx.arc(X, Y, Math.max(7, cellPx * 0.3), 0, 2 * Math.PI);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = col("astar");
        ctx.stroke();
      }
    }

    // Routes draw themselves once the search is done.
    const route = (p, frac, colour, width, dash) => {
      if (!p || frac <= 0) return;
      const n = (p.length - 1) * frac, pts = [];
      for (let i = 0; i <= Math.floor(n); i++) pts.push([p[i][1] + 0.5, p[i][0] + 0.5]);
      const i = Math.floor(n), f = n - i;
      if (f > 0 && i + 1 < p.length) pts.push([p[i][1] + 0.5 + (p[i + 1][1] - p[i][1]) * f, p[i][0] + 0.5 + (p[i + 1][0] - p[i][0]) * f]);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach(([u, v], j) => (j ? ctx.lineTo(...P(u, v, 0.04)) : ctx.moveTo(...P(u, v, 0.04))));
      ctx.lineWidth = width + 6;
      ctx.strokeStyle = stage;
      ctx.stroke();
      if (dash) ctx.setLineDash(dash);
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.stroke();
      ctx.restore();
    };
    if (s.layers.bfs) route(R.bfs.path, s.routeFrac, col("bfs"), 3, [7, 6]);
    if (s.layers.best) route(A.path, s.routeFrac, col("best"), 4.5);

    // A marker walks the best route, slowing on climbs like a hiker would.
    if (s.layers.best && A.path && s.walkFrac > 0) {
      const p = A.path, costs = [0];
      for (let i = 1; i < p.length; i++) costs.push(costs[i - 1] + root.Pathfinder.stepCost(s.grid, ...p[i - 1], ...p[i]));
      const e = s.walkFrac < 0.5 ? 2 * s.walkFrac ** 2 : 1 - (-2 * s.walkFrac + 2) ** 2 / 2;
      const target = costs[costs.length - 1] * e;
      let i = 1;
      while (i < p.length - 1 && costs[i] < target) i++;
      const f = Math.max(0, Math.min(1, (target - costs[i - 1]) / (costs[i] - costs[i - 1] || 1)));
      const [X, Y] = P(p[i - 1][1] + 0.5 + (p[i][1] - p[i - 1][1]) * f, p[i - 1][0] + 0.5 + (p[i][0] - p[i - 1][0]) * f, 0.05);
      ctx.beginPath();
      ctx.ellipse(X, Y + 2, 8, 3.5, 0, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(X, Y - 4, 6.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = col("best");
      ctx.stroke();
    }

    for (const L of s.labels || []) {
      const [X, Y] = P(L.u, L.v, L.lift || 0);
      if (L.leader) {
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X, Y - 26);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = ink;
        ctx.stroke();
      }
      label(L.text, X, L.leader ? Y - 34 : Y, `600 12px ${FONT}`, L.water ? (st.dark ? "#9CC9EA" : "#245E7E") : ink);
    }

    // Pins: a dashed ring for the start, a flag for the goal.
    const pinR = Math.max(7, Math.min(15, cellPx * 0.3));
    {
      const [X, Y] = centre(s.start, 0.05);
      ctx.beginPath();
      ctx.arc(X, Y, pinR, 0, 2 * Math.PI);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = ink;
      ctx.stroke();
      ctx.setLineDash([]);
      label("Start", X + pinR + 4, Y, `650 12px ${FONT}`, ink, "left");
    }
    {
      const [X, Y] = centre(s.end, 0.05), h = Math.max(20, Math.min(34, cellPx * 0.8));
      ctx.beginPath();
      ctx.moveTo(X, Y + 2);
      ctx.lineTo(X, Y - h);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X, Y - h);
      ctx.lineTo(X + h * 0.55, Y - h * 0.78);
      ctx.lineTo(X, Y - h * 0.56);
      ctx.closePath();
      ctx.fillStyle = ink;
      ctx.fill();
      label("Flag", X + h * 0.6, Y - h * 0.62, `650 12px ${FONT}`, ink, "left");
    }

    // The cell under the pointer, and the keyboard cursor at the centre.
    for (const [cell, width, colour] of [[s.hover, 2, ink], [s.focus, 3, col("best")]]) {
      if (!cell) continue;
      ctx.beginPath();
      quad(cell[0], cell[1], 0.04);
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.stroke();
    }
  }

  root.Board = { draw };
})(window);
