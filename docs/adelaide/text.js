/*
 * The Adelaide page's words: a name for each pin, the place search behind
 * the From and To boxes, walking times, and the sentence under "What just
 * happened". All of it comes from the map data and the search results.
 *
 * Plain script: window.AdelaideText in the browser, a CommonJS module in
 * Node for tests/test_text.js. G is a graph from AdelaideGraph.load().
 */
(function (root) {
  "use strict";

  const WALK_M_PER_S = 1.4; // about 5 km/h, with no waits at crossings
  const NEAR_M = 60; // how close a street or landmark must be to name a pin after it
  // numbers keep their units on the same line (no-break spaces)
  const num = (x) => Math.round(x).toLocaleString("en-AU");
  const walkMinutes = (m) => Math.round(m / WALK_M_PER_S / 60);
  const walkTime = (m) => (m / WALK_M_PER_S < 60 ? "under 1 min" : walkMinutes(m) + " min");
  const distText = (m) => (m < 1000 ? num(m) + " m" : (m / 1000).toFixed(1) + " km");

  // Distance from (x, y) to a polyline [x0, y0, x1, y1, ...].
  function toLine(x, y, p) {
    let best = Infinity;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], ay = p[i - 1], dx = p[i] - ax, dy = p[i + 1] - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  }

  // A pin's name: the nearest named street ("Grenfell St") or landmark
  // ("near Rundle Mall") within 60 m, whichever is closer (a street wins a
  // tie), or else "a path near" the nearest named street. Streets the same
  // distance away to the metre go to the more important one.
  // places is [[name, x, y]] in metres.
  function placeName(G, v, places) {
    const x = G.nx[v], y = G.ny[v];
    let street = "", sd = Infinity, key = Infinity;
    for (const e of G.edges) {
      if (!e.nm) continue;
      const d = toLine(x, y, e.pts), k = Math.round(d) * 10 + e.cls;
      if (k < key) [key, sd, street] = [k, d, G.names[e.nm]];
    }
    let mark = "", md = Infinity;
    for (const [name, px, py] of places) {
      const d = Math.hypot(px - x, py - y);
      if (d < md) [md, mark] = [d, name];
    }
    if (street && sd <= NEAR_M && sd <= md) return street;
    if (md <= NEAR_M) return "near " + mark;
    return street ? "a path near " + street : "a path";
  }

  // ---------- the From and To search ----------
  const norm = (s) => s.normalize("NFD").replace(/[\p{M}'’]/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // Everything the boxes can find: the landmarks, then every street name
  // (a street that shares a landmark's name is left to the landmark).
  // marks is [{ name, node }]; streets point at their name's index.
  function entries(G, marks) {
    const places = marks.map((m) => ({ label: m.name, kind: "place", node: m.node }));
    const taken = new Set(places.map((p) => p.label));
    const streets = [];
    G.names.forEach((name, nm) => {
      if (name && !taken.has(name)) (taken.add(name), streets.push({ label: name, kind: "street", nm }));
    });
    const byLabel = (a, b) => a.label.localeCompare(b.label);
    return [...places.sort(byLabel), ...streets.sort(byLabel)].map((e) => Object.assign(e, { key: norm(e.label) }));
  }

  // Matches for what was typed: names that start with it, then names with a
  // word that starts with it, then names that contain it anywhere; places
  // before streets at each level. Ignores case, accents and punctuation. An
  // empty box lists the places.
  function search(query, list, limit = 8) {
    const q = norm(query);
    if (!q) return list.filter((e) => e.kind === "place");
    const hits = [];
    list.forEach((e, i) => {
      const rank = e.key.startsWith(q) ? 0 : (" " + e.key).includes(" " + q) ? 1 : e.key.includes(q) ? 2 : -1;
      if (rank >= 0) hits.push([rank, e.kind === "place" ? 0 : 1, i, e]);
    });
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    return hits.slice(0, limit).map((h) => h[3]);
  }

  // A street chosen by name starts at its junction nearest the middle of the street.
  function streetNode(G, nm) {
    const nodes = new Set();
    for (const e of G.edges) if (e.nm === nm) nodes.add(e.a).add(e.b);
    let cx = 0, cy = 0;
    for (const v of nodes) (cx += G.nx[v]), (cy += G.ny[v]);
    (cx /= nodes.size), (cy /= nodes.size);
    let best = -1, bd = Infinity;
    for (const v of nodes) {
      const d = (G.nx[v] - cx) ** 2 + (G.ny[v] - cy) ** 2;
      if (d < bd) [bd, best] = [d, v];
    }
    return best;
  }

  // ---------- what just happened ----------
  // R is AdelaideGraph.solve(): B, U and A are BFS, Dijkstra and A*.
  function insight(R) {
    const { A, U, B } = R;
    if (!A.path) return "No walking route joins these two places on this map. Try two other places.";
    const nA = A.order.length, nU = U.order.length, fewer = Math.round(100 * (1 - nA / nU));
    const first = fewer >= 1
      ? `A* found the same ${walkTime(A.dist)} walk as Dijkstra but checked ${fewer}% fewer junctions (${num(nA)} instead of ${num(nU)}).`
      : `A* and Dijkstra found the same ${walkTime(A.dist)} walk and checked about as many junctions (${num(nA)} and ${num(nU)}).`;
    const longer = B.dist - A.dist, mins = walkMinutes(B.dist) - walkMinutes(A.dist);
    const second = longer > 5
      ? `BFS counts street segments, not metres, so its route is ${mins > 0 ? mins + " min" : num(longer) + " m"} longer.`
      : "BFS found an equally short route this time, even though it counts street segments, not metres.";
    return first + " " + second;
  }

  const api = { WALK_M_PER_S, NEAR_M, num, walkMinutes, walkTime, distText, placeName, entries, search, streetNode, insight };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AdelaideText = api;
})(typeof window !== "undefined" ? window : globalThis);
