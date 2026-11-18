/*
 * Adelaide CBD walking graph: data loading and the three searches.
 *
 * Plain script, no build step. In the browser it sets window.AdelaideGraph;
 * in Node it is a CommonJS module, so tests run the exact code the page runs.
 *
 * The searches follow the same rules as pathfinder.js (the grid version):
 * a queue or binary heap ordered by (priority, insertion counter), lazy
 * deletion (a node can be pushed more than once; stale pops are skipped),
 * and a node is closed the first time it is popped.
 */
(function (root) {
  "use strict";

  // Build typed arrays and adjacency lists from the compact JSON written by
  // tools/prep_adelaide.py. Coordinates in the file are half metres.
  function load(raw) {
    const n = raw.n, N = n.length / 2;
    const G = { raw, N, names: raw.names, sp: raw.sp, ep: raw.ep };
    G.nx = new Float64Array(N);
    G.ny = new Float64Array(N);
    for (let i = 0; i < N; i++) { G.nx[i] = n[2 * i] / 2; G.ny[i] = n[2 * i + 1] / 2; }
    G.adj = Array.from({ length: N }, () => []);
    G.edges = raw.e.map((e, k) => {
      const [a, b, , cls, nm] = e;
      const pts = [G.nx[a], G.ny[a]];
      for (let i = 5; i < e.length; i += 2) pts.push(e[i] / 2, e[i + 1] / 2);
      pts.push(G.nx[b], G.ny[b]);
      // Measure the length on the stored points. The A* estimate is a straight
      // line between the same stored points, so by the triangle inequality it
      // can never exceed an edge's length. That keeps A* admissible and
      // consistent, so it may close nodes early and still return the shortest
      // route. (Measuring on the original, unrounded points broke this by up
      // to 0.7 m; tests/test_adelaide_routes.py guards against it.)
      let len = 0;
      for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      G.adj[a].push([b, k]);
      G.adj[b].push([a, k]);
      return { a, b, len, cls, nm, pts };
    });
    return G;
  }

  function search(G, alg, s, t) {
    const N = G.N;
    const closed = new Uint8Array(N);
    const came = new Int32Array(N).fill(-1), cameE = new Int32Array(N).fill(-1);
    const items = [];
    let head = 0, counter = 0;
    const less = (a, b) => (a.f !== b.f ? a.f < b.f : a.id < b.id);
    const push = (it) => {
      items.push(it);
      if (alg === "bfs") return;
      let i = items.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(items[i], items[p])) break;
        [items[i], items[p]] = [items[p], items[i]];
        i = p;
      }
    };
    const pop = () => {
      if (alg === "bfs") return items[head++];
      const top = items[0], last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < items.length && less(items[l], items[m])) m = l;
          if (r < items.length && less(items[r], items[m])) m = r;
          if (m === i) break;
          [items[i], items[m]] = [items[m], items[i]];
          i = m;
        }
      }
      return top;
    };
    const empty = () => (alg === "bfs" ? head >= items.length : items.length === 0);
    const tx = G.nx[t], ty = G.ny[t];
    const h = (v) => (alg === "astar" ? Math.hypot(G.nx[v] - tx, G.ny[v] - ty) : 0);

    const order = []; // nodes in the order they were expanded (closed)
    let pops = 0;
    push({ f: h(s), id: 0, g: 0, n: s, p: -1, e: -1 });
    while (!empty()) {
      const it = pop();
      pops++;
      const v = it.n;
      if (v === t) {
        if (!closed[v]) { came[v] = it.p; cameE[v] = it.e; order.push(v); }
        const path = [v], pe = [];
        let u = v;
        while (came[u] >= 0) { pe.push(cameE[u]); u = came[u]; path.push(u); }
        path.reverse(); pe.reverse();
        let dist = 0;
        for (const k of pe) dist += G.edges[k].len;
        return { path, pe, order, closed, pops, dist };
      }
      if (closed[v]) continue; // stale entry
      closed[v] = 1; came[v] = it.p; cameE[v] = it.e; order.push(v);
      for (const [w, k] of G.adj[v]) {
        if (closed[w]) continue;
        counter++;
        const g = it.g + (alg === "bfs" ? 1 : G.edges[k].len);
        push({ f: alg === "bfs" ? 0 : g + h(w), id: counter, g, n: w, p: v, e: k });
      }
    }
    return { path: null, pe: [], order, closed, pops, dist: Infinity };
  }

  // Polyline (metres) along a found route, with cumulative length for drawing.
  function routeLine(G, r) {
    if (!r.path) return null;
    const pts = [];
    r.pe.forEach((k, i) => {
      const e = G.edges[k], fwd = e.a === r.path[i], p = e.pts, m = p.length / 2;
      for (let j = 0; j < m; j++) {
        if (pts.length && j === 0) continue;
        const q = fwd ? j : m - 1 - j;
        pts.push(p[2 * q], p[2 * q + 1]);
      }
    });
    let L = 0;
    const cum = [0];
    for (let i = 2; i < pts.length; i += 2) {
      L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      cum.push(L);
    }
    return { pts, cum, L };
  }

  function solve(G, s, t) {
    const B = search(G, "bfs", s, t), U = search(G, "ucs", s, t), A = search(G, "astar", s, t);
    return { B, U, A, bl: routeLine(G, B), al: routeLine(G, A), skipped: U.order.filter((v) => !A.closed[v]) };
  }

  const api = { load, search, solve, routeLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AdelaideGraph = api;
})(typeof window !== "undefined" ? window : globalThis);
