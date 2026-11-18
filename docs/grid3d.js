/*
 * Grid 3D: the terrain from terrain.js as a lit model on a soil-coloured
 * diorama base, drawn through the shared camera. board.js calls
 * Grid3D.surface() whenever the camera is tilted, then draws the search
 * layers on top, so 3D follows the same timeline as 2D.
 *
 * Painter's algorithm: the heightfield's sub-quads are drawn back to front by
 * their depth after turning, with the survey grid and contours stroked as we
 * go, so a hill hides the lines behind it.
 *
 * While the camera moves (s.moving), it draws one quad per cell instead of
 * nine, without contours: 400 quads instead of 3,600 on the largest map. A
 * cached flat image cannot follow a turn or a tilt, but these coarse quads
 * can. app.js draws the full detail again once the camera has stopped.
 */
(function (root) {
  "use strict";
  const T = root.Terrain;
  const cache = new WeakMap(); // terrain -> per-quad data and colours
  let order = null, orderTh = NaN, orderN = 0; // quad drawing order for the last turn angle
  let px = new Float32Array(0), py = new Float32Array(0); // projected vertices, reused

  // Per-quad heights, light, water, grid edges and contour pieces, worked out once per terrain.
  function prep(t) {
    let c = cache.get(t);
    if (c) return c;
    const S = t.S, nu = t.nu, nv = t.nv, qu = nu - 1, nq = qu * (nv - 1);
    const qz = new Float32Array(nq), ql = new Float32Array(nq), qw = new Uint8Array(nq), edges = new Uint8Array(nq);
    for (let j = 0; j < nv - 1; j++)
      for (let i = 0; i < qu; i++) {
        const q = j * qu + i, k = j * nu + i, ks = [k, k + 1, k + nu + 1, k + nu];
        qz[q] = (t.z[ks[0]] + t.z[ks[1]] + t.z[ks[2]] + t.z[ks[3]]) / 4;
        ql[q] = (t.light[ks[0]] + t.light[ks[1]] + t.light[ks[2]] + t.light[ks[3]]) / 4;
        qw[q] = ks.every((x) => t.water[x]) ? 1 : 0;
        // survey grid: 1 top edge, 2 left edge on a cell line; 4 bottom and 8 right edge of the board
        edges[q] = (j % S === 0 ? 1 : 0) | (i % S === 0 ? 2 : 0) | (j === nv - 2 ? 4 : 0) | (i === qu - 1 ? 8 : 0);
      }
    const contour = new Map(); // quad -> [u1, v1, u2, v2, level, ...]
    for (const L of t.levels) {
      const seg = t.contours(L);
      for (let a = 0; a < seg.length; a += 4) {
        const i = Math.min(qu - 1, Math.floor(((seg[a] + seg[a + 2]) / 2) * S));
        const j = Math.min(nv - 2, Math.floor(((seg[a + 1] + seg[a + 3]) / 2) * S));
        const q = j * qu + i;
        if (!contour.has(q)) contour.set(q, []);
        contour.get(q).push(seg[a], seg[a + 1], seg[a + 2], seg[a + 3], L);
      }
    }
    let low = Infinity;
    for (const z of t.z) low = Math.min(low, z);
    c = { qu, nq, qz, ql, qw, edges, contour, base: low - 1.4, rgb: {} };
    cache.set(t, c);
    return c;
  }

  function quadColours(c, style) {
    if (!c.rgb[style]) {
      const out = new Array(c.nq);
      for (let q = 0; q < c.nq; q++) out[q] = T.colourFor(style, c.qz[q], c.ql[q], c.qw[q] === 1);
      c.rgb[style] = out;
    }
    return c.rgb[style];
  }

  const quadCss = (c, style) => (c.css = c.css || {})[style] || (c.css[style] = quadColours(c, style).map(T.css));

  // One colour per cell for the coarse surface: the average of its sub-quads.
  function cellCss(t, c, style) {
    c.cellCss = c.cellCss || {};
    if (c.cellCss[style]) return c.cellCss[style];
    const rgb = quadColours(c, style), S = t.S, out = [];
    for (let r = 0; r < t.rows; r++)
      for (let col = 0; col < t.cols; col++) {
        const sum = [0, 0, 0];
        for (let j = 0; j < S; j++)
          for (let i = 0; i < S; i++) {
            const q = (r * S + j) * c.qu + col * S + i;
            for (let x = 0; x < 3; x++) sum[x] += rgb[q][x];
          }
        out.push(T.css(sum.map((x) => x / (S * S))));
      }
    return (c.cellCss[style] = out);
  }

  // Back to front: depth grows towards the viewer, so sort ascending.
  function drawOrder(c, th) {
    if (order && orderTh === th && orderN === c.nq) return order;
    const s = Math.sin(th), co = Math.cos(th), depth = new Float32Array(c.nq);
    for (let q = 0; q < c.nq; q++) depth[q] = (q % c.qu) * s + Math.floor(q / c.qu) * co;
    order = Uint32Array.from({ length: c.nq }, (_, q) => q).sort((a, b) => depth[a] - depth[b]);
    orderTh = th;
    orderN = c.nq;
    return order;
  }

  function surface(ctx, view, s) {
    const t = s.terrain, c = prep(t), S = t.S, nu = t.nu, nv = t.nv, zs = t.zScale;
    const st = T.STYLES[s.style], from = T.STYLES[s.fromStyle], f = s.fade;
    const m = view.cam, cs = Math.cos(m.th), sn = Math.sin(m.th), ct = Math.cos(m.tilt), stl = Math.sin(m.tilt);
    const k = m.k, hw = view.W / 2, hh = view.H / 2;
    const PX = (u, v) => hw + ((u - m.cx) * cs - (v - m.cy) * sn) * k;
    const PY = (u, v, z) => hh + (((u - m.cx) * sn + (v - m.cy) * cs) * ct - z * stl) * k;

    // every vertex projected once
    const N = nu * nv;
    if (px.length < N) {
      px = new Float32Array(N);
      py = new Float32Array(N);
    }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const q = j * nu + i, u = i / S, v = j / S;
        px[q] = PX(u, v);
        py[q] = PY(u, v, t.z[q] * zs);
      }
    const baseZ = c.base * zs, cols = t.cols, rows = t.rows;

    // a soft shadow under the model
    {
      const cx = PX(cols / 2, rows / 2), cy = PY(cols / 2, rows / 2, baseZ) + 18;
      const rx = (Math.abs(cols * cs) + Math.abs(rows * sn)) * k * 0.62, ry = Math.max(12, (Math.abs(cols * sn) + Math.abs(rows * cs)) * k * ct * 0.5);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
      g.addColorStop(0, st.dark ? "rgba(0,0,0,0.55)" : "rgba(30,40,30,0.22)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // The diorama's sides that face the viewer: a side faces us when its outward
    // normal points the way depth grows. Light comes from the top left, so the
    // right and bottom sides are a little darker.
    const sideCol = f >= 1 ? st.side : T.css(T.mix(T.hex(from.side), T.hex(st.side), f));
    const sides = [
      [sn < 0, 0, (q) => [q, 0], nv], // left edge
      [sn > 0, 0.18, (q) => [q, nu - 1], nv], // right edge
      [cs < 0, 0, (q) => [0, q], nu], // top edge
      [cs > 0, 0.1, (q) => [nv - 1, q], nu], // bottom edge
    ];
    for (const [faces, dark, at, n] of sides) {
      if (!faces) continue;
      ctx.beginPath();
      for (let q = 0; q < n; q++) {
        const [j, i] = at(q), idx = j * nu + i;
        q ? ctx.lineTo(px[idx], py[idx]) : ctx.moveTo(px[idx], py[idx]);
      }
      const [j1, i1] = at(n - 1), [j0, i0] = at(0);
      ctx.lineTo(PX(i1 / S, j1 / S), PY(i1 / S, j1 / S, baseZ));
      ctx.lineTo(PX(i0 / S, j0 / S), PY(i0 / S, j0 / S, baseZ));
      ctx.closePath();
      ctx.fillStyle = sideCol;
      ctx.fill();
      if (dark) {
        ctx.fillStyle = `rgba(0,0,0,${dark})`;
        ctx.fill();
      }
    }

    if (s.moving) return coarse(ctx, t, c, s, st, px, py, m.th), true;

    // The surface, back to front. Grid and contour lines are stroked once per
    // run of quads (about one row's worth) instead of once per quad: a line can
    // only be drawn over the few quads in its own run, which are at almost the
    // same depth, and it cuts the stroke calls from about 1,300 to about 60.
    const now = quadCss(c, s.style), mixA = f < 1 ? quadColours(c, s.fromStyle) : null, mixB = f < 1 ? quadColours(c, s.style) : null;
    const contourOn = st.contour, cAlpha = contourOn ? contourOn.alpha * (s.style === s.fromStyle ? 1 : f) : 0;
    const e = 0.35; // grow each quad a little so no hairline seams show between neighbours
    const ord = drawOrder(c, m.th), RUN = c.qu;
    const gridPts = [], contourPts = [];
    const flushLines = () => {
      if (gridPts.length) {
        ctx.beginPath();
        for (let x = 0; x < gridPts.length; x += 4) (ctx.moveTo(gridPts[x], gridPts[x + 1]), ctx.lineTo(gridPts[x + 2], gridPts[x + 3]));
        ctx.lineWidth = 1;
        ctx.strokeStyle = st.grid;
        ctx.stroke();
        gridPts.length = 0;
      }
      if (contourPts.length) {
        ctx.beginPath();
        for (let x = 0; x < contourPts.length; x += 4) (ctx.moveTo(contourPts[x], contourPts[x + 1]), ctx.lineTo(contourPts[x + 2], contourPts[x + 3]));
        ctx.globalAlpha = cAlpha;
        ctx.strokeStyle = contourOn.colour;
        ctx.stroke();
        ctx.globalAlpha = 1;
        contourPts.length = 0;
      }
    };
    for (let n = 0; n < ord.length; n++) {
      const q = ord[n], i = q % c.qu, j = (q - i) / c.qu, a = j * nu + i, b = a + 1, d = a + nu + 1, g = a + nu;
      const mx = (px[a] + px[b] + px[d] + px[g]) / 4, my = (py[a] + py[b] + py[d] + py[g]) / 4;
      ctx.beginPath();
      ctx.moveTo(px[a] + (px[a] > mx ? e : -e), py[a] + (py[a] > my ? e : -e));
      ctx.lineTo(px[b] + (px[b] > mx ? e : -e), py[b] + (py[b] > my ? e : -e));
      ctx.lineTo(px[d] + (px[d] > mx ? e : -e), py[d] + (py[d] > my ? e : -e));
      ctx.lineTo(px[g] + (px[g] > mx ? e : -e), py[g] + (py[g] > my ? e : -e));
      ctx.closePath();
      ctx.fillStyle = mixA ? T.css(T.mix(mixA[q], mixB[q], f)) : now[q];
      ctx.fill();
      const ed = c.edges[q];
      if (ed & 1) gridPts.push(px[a], py[a], px[b], py[b]);
      if (ed & 2) gridPts.push(px[a], py[a], px[g], py[g]);
      if (ed & 4) gridPts.push(px[g], py[g], px[d], py[d]);
      if (ed & 8) gridPts.push(px[b], py[b], px[d], py[d]);
      if (cAlpha) {
        const seg = c.contour.get(q);
        if (seg)
          for (let x = 0; x < seg.length; x += 5) {
            const zl = seg[x + 4] * zs;
            contourPts.push(PX(seg[x], seg[x + 1]), PY(seg[x], seg[x + 1], zl), PX(seg[x + 2], seg[x + 3]), PY(seg[x + 2], seg[x + 3], zl));
          }
      }
      if ((n + 1) % RUN === 0) flushLines();
    }
    flushLines();
    return true; // grid and contours are drawn
  }

  // While moving: one quad per cell, back to front, every edge a grid line.
  let cellOrder = null, cellOrderTh = NaN, cellOrderN = 0;
  function coarse(ctx, t, c, s, st, px, py, th) {
    const S = t.S, nu = t.nu, cols = t.cols, n = t.rows * cols, css = cellCss(t, c, s.style);
    if (!(cellOrder && cellOrderTh === th && cellOrderN === n)) {
      const sn = Math.sin(th), co = Math.cos(th);
      cellOrder = Uint32Array.from({ length: n }, (_, q) => q).sort((a, b) => ((a % cols) - (b % cols)) * sn + (Math.floor(a / cols) - Math.floor(b / cols)) * co);
      cellOrderTh = th;
      cellOrderN = n;
    }
    const lines = [];
    for (let x = 0; x < n; x++) {
      const q = cellOrder[x], col = q % cols, r = (q - col) / cols, a = r * S * nu + col * S, b = a + S, d = a + S * nu + S, g = a + S * nu;
      ctx.beginPath();
      ctx.moveTo(px[a], py[a]);
      ctx.lineTo(px[b], py[b]);
      ctx.lineTo(px[d], py[d]);
      ctx.lineTo(px[g], py[g]);
      ctx.closePath();
      ctx.fillStyle = css[q];
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = css[q];
      ctx.stroke(); // hides seams between neighbours
      lines.push(px[a], py[a], px[b], py[b], px[a], py[a], px[g], py[g]);
      if ((x + 1) % cols === 0 || x === n - 1) {
        ctx.beginPath();
        for (let y = 0; y < lines.length; y += 4) (ctx.moveTo(lines[y], lines[y + 1]), ctx.lineTo(lines[y + 2], lines[y + 3]));
        ctx.lineWidth = 1;
        ctx.strokeStyle = st.grid;
        ctx.stroke();
        lines.length = 0;
      }
    }
  }

  root.Grid3D = { surface };
})(window);
