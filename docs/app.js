/*
 * Grid page: state, controls, the timeline, results and the URL hash.
 * Searches: pathfinder.js through runs.js. Landscape: terrain.js.
 * Drawing: board.js. Camera and map input: shared/view.js. Theme: shared/theme.js.
 */
(function () {
  "use strict";
  const PF = window.Pathfinder, T = window.Terrain, Runs = window.Runs, Board = window.Board;
  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MAPS = { detour: "Detour", choice: "Choice", small: "Small", maze: "Maze", open: "Open field", large: "Large" };
  const DRAW_MS = 1200, WALK_MS = 2400, FADE_MS = 300;
  const HINTS = {
    start: "Click a dry cell to move the start, or drag a pin.",
    end: "Click a dry cell to move the flag, or drag a pin.",
    creek: "Click or drag to add creek, or to dry it out. Shift and drag to move the map.",
    raise: "Click or drag to raise the ground by 1. Shift and drag to move the map.",
    lower: "Click or drag to lower the ground by 1. Shift and drag to move the map.",
  };

  const S = {
    map: "detour", base: null, grid: null, start: null, end: null, tool: "start", note: "",
    layers: { explored: true, skipped: false, bfs: true, best: true, numbers: false },
    t: 0, playing: false, last: 0,
    hover: null, focus: null,
    style: "terrain", fromStyle: "terrain", fadeStart: 0,
  };
  let R = null, terrain = null, terrainKey = "", labels = [], view = null, lastHash = "";

  const rows = () => S.grid.length, cols = () => S.grid[0].length;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const dry = ([r, c]) => S.grid[r][c] !== -1;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // ---------- timeline: one clock for the search, the routes and the marker ----------
  function timing() {
    const N = R.longest, stepMs = Math.max(8, Math.min(60, 5000 / N)), searchEnd = N * stepMs;
    return { N, stepMs, searchEnd, total: searchEnd + DRAW_MS + WALK_MS };
  }
  const stepAt = (t) => Math.min(timing().N, Math.floor(t / timing().stepMs + 1e-9));

  function seek(t) {
    S.t = Math.max(0, Math.min(timing().total, t));
    renderTimeline();
    view.kick();
  }
  function seekStep(k) {
    const tm = timing();
    seek(k >= tm.N ? tm.total : k * tm.stepMs);
  }
  function pause() {
    S.playing = false;
    renderTimeline();
  }
  function play() {
    const tm = timing();
    if (S.t >= tm.total) S.t = 0;
    if (reduce) return seek(tm.total); // no animation: show the final state at once
    S.playing = true;
    S.last = performance.now();
    renderTimeline();
    view.kick();
  }

  // ---------- the run ----------
  function refresh(how) {
    const key = `${rows()}x${cols()}:${encodeGrid()}`;
    if (key !== terrainKey) {
      // only rebuild the landscape when the ground changed, not when a pin moved
      terrainKey = key;
      terrain = T.buildTerrain(S.grid);
      labels = creekLabel();
    }
    R = Runs.solve(S.grid, S.start, S.end);
    renderResults();
    renderSparkline();
    writeHash();
    S.playing = false;
    if (how === "replay") {
      S.t = 0;
      play();
    } else seek(timing().total);
    renderTools();
  }

  // "Creek, impassable" on the creek cell nearest the middle of the creek.
  function creekLabel() {
    const cells = [];
    S.grid.forEach((row, r) => row.forEach((v, c) => v === -1 && cells.push([r, c])));
    if (!cells.length) return [];
    const mr = cells.reduce((a, [r]) => a + r, 0) / cells.length, mc = cells.reduce((a, [, c]) => a + c, 0) / cells.length;
    const [r, c] = cells.reduce((b, x) => ((x[0] - mr) ** 2 + (x[1] - mc) ** 2 < (b[0] - mr) ** 2 + (b[1] - mc) ** 2 ? x : b));
    return [{ text: "Creek, impassable", u: c + 0.5, v: r + 0.5, water: true }];
  }

  function loadMap(name, keep = {}) {
    S.map = MAPS[name] ? name : "detour";
    S.base = PF.parseMap(window.PATHFINDER_MAPS[S.map]);
    S.grid = keep.grid || S.base.grid.map((row) => row.slice());
    S.start = keep.start || S.base.start.slice();
    S.end = keep.end || S.base.end.slice();
    $("map").value = S.map;
  }

  const edited = () => S.grid.some((row, r) => row.some((v, c) => v !== S.base.grid[r][c]));

  // ---------- URL hash: view, map, pins and any edits (theme.js adds theme) ----------
  const encodeGrid = () => S.grid.map((row) => row.map((v) => (v === -1 ? "x" : v)).join("")).join("");
  function decodeGrid(str, base) {
    if (!str || str.length !== base.rows * base.cols || !/^[0-9x]+$/.test(str)) return null;
    return base.grid.map((row, r) => row.map((_, c) => (str[r * base.cols + c] === "x" ? -1 : Number(str[r * base.cols + c]))));
  }
  function decodePin(str, grid) {
    const m = /^(\d+)-(\d+)$/.exec(str || "");
    if (!m) return null;
    const p = [Number(m[1]), Number(m[2])];
    return p[0] < grid.length && p[1] < grid[0].length && grid[p[0]][p[1]] !== -1 ? p : null;
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const name = MAPS[p.get("map")] ? p.get("map") : "detour";
    const base = PF.parseMap(window.PATHFINDER_MAPS[name]);
    const grid = decodeGrid(p.get("g"), base) || base.grid.map((row) => row.slice());
    let start = decodePin(p.get("s"), grid), end = decodePin(p.get("e"), grid);
    if (!start || !end || same(start, end)) start = end = null;
    if (start === null && (grid[base.start[0]][base.start[1]] === -1 || grid[base.end[0]][base.end[1]] === -1)) return loadMap(name);
    loadMap(name, { grid, start: start || undefined, end: end || undefined });
  }
  function writeHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    p.set("view", "2d");
    p.set("map", S.map);
    p.set("s", S.start.join("-"));
    p.set("e", S.end.join("-"));
    if (edited()) p.set("g", encodeGrid());
    else p.delete("g");
    lastHash = "#" + p;
    if (lastHash !== location.hash) history.replaceState(null, "", lastHash);
  }

  // ---------- clicking, dragging and painting cells ----------
  function cellAt(X, Y) {
    const [u, v] = view.unP(X, Y), r = Math.floor(v), c = Math.floor(u);
    return r >= 0 && r < rows() && c >= 0 && c < cols() ? [r, c] : null;
  }
  function note(text) {
    S.note = text;
    renderTools();
  }

  function apply(cell, stroke) {
    const [r, c] = cell, tool = S.tool, g = S.grid;
    if (tool === "start" || tool === "end") {
      if (!dry(cell)) return note("Creek cells can't hold a pin.");
      if (same(cell, tool === "start" ? S.end : S.start)) return note(tool === "start" ? "The flag is already there." : "The start is already there.");
      S[tool] = cell;
      S.tool = tool === "start" ? "end" : "start";
      S.note = "";
      return refresh("replay");
    }
    if (stroke.done.has(r * cols() + c)) return;
    stroke.done.add(r * cols() + c);
    if (tool === "creek") {
      if (same(cell, S.start) || same(cell, S.end)) return note("Pins can't sit in the creek. Move the pin first.");
      stroke.mode = stroke.mode || (g[r][c] === -1 ? "dry" : "creek");
      if (stroke.mode === "creek" && g[r][c] !== -1) g[r][c] = -1;
      else if (stroke.mode === "dry" && g[r][c] === -1) g[r][c] = Math.max(0, S.base.grid[r][c]);
      else return;
    } else {
      if (g[r][c] === -1) return note("Creek cells have no ground to raise or lower.");
      const v = Math.max(0, Math.min(9, g[r][c] + (tool === "raise" ? 1 : -1)));
      if (v === g[r][c]) return note(tool === "raise" ? "9 is the highest ground." : "0 is the lowest ground.");
      g[r][c] = v;
    }
    S.note = "";
    refresh("end");
  }

  // Pressing on a pin drags it, whatever the tool. Paint tools take the press
  // too, unless Shift is held to move the map.
  function grab(X, Y, e) {
    const cell = cellAt(X, Y);
    if (!cell) return null;
    const pin = same(cell, S.start) ? "start" : same(cell, S.end) ? "end" : null;
    if (pin) {
      let moved = false;
      return {
        move(x, y) {
          const to = cellAt(x, y);
          if (!to || !dry(to) || same(to, S[pin]) || same(to, pin === "start" ? S.end : S.start)) return;
          S[pin] = to;
          moved = true;
          refresh("end");
        },
        up() {
          if (moved) refresh("replay");
          else apply(cell, { done: new Set() });
        },
      };
    }
    if (S.tool === "start" || S.tool === "end" || e.shiftKey) return null;
    const stroke = { done: new Set() };
    apply(cell, stroke);
    let lx = X, ly = Y;
    return {
      // a fast drag can jump several cells between events, so paint the cells in between too
      move(x, y) {
        const n = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / (view.cam.k / 4)));
        for (let i = 1; i <= n; i++) {
          const to = cellAt(lx + ((x - lx) * i) / n, ly + ((y - ly) * i) / n);
          if (to) apply(to, stroke);
        }
        lx = x;
        ly = y;
      },
      up() {},
    };
  }

  // ---------- drawing ----------
  function frame(now) {
    let busy = false;
    const tm = timing();
    if (S.playing) {
      // a frame's timestamp can be a little older than the moment Play was pressed
      S.t = Math.min(tm.total, S.t + Math.max(0, now - S.last));
      S.last = now;
      if (S.t >= tm.total) S.playing = false;
      busy = S.playing;
      renderTimeline();
    }
    let fade = 1;
    if (S.fadeStart) {
      fade = clamp01((now - S.fadeStart) / FADE_MS);
      if (fade < 1) busy = true;
      else S.fadeStart = 0;
    }
    if (S.fadeStart === 0) S.fromStyle = S.style;
    // keyboard: the cell under the centre of the map is the cursor
    const focused = $("cv").matches(":focus-visible");
    const f = focused ? cellAt(view.W / 2, view.H / 2) : null;
    if (String(f) !== String(S.focus)) {
      S.focus = f;
      renderTip();
    }
    const after = S.t - tm.searchEnd;
    Board.draw(view, {
      terrain, grid: S.grid, R, labels, start: S.start, end: S.end,
      k: stepAt(S.t), routeFrac: clamp01(after / DRAW_MS), walkFrac: clamp01((after - DRAW_MS) / WALK_MS),
      style: S.style, fromStyle: S.fromStyle, fade,
      layers: S.layers, hover: S.hover, focus: S.focus,
    });
    if (S.hover || S.focus) placeTip();
    return busy;
  }

  // The map style follows the theme: Terrain in light, Night in dark.
  function setStyle(name, fade) {
    const ov = T.STYLES[name].overlay, box = $("mapbox");
    for (const k in ov) box.style.setProperty("--ov-" + k, ov[k]); // layer swatches match the map
    box.classList.toggle("dark-map", T.STYLES[name].dark);
    if (name === S.style) return;
    S.fromStyle = S.style;
    S.style = name;
    S.fadeStart = fade ? performance.now() : 0;
    view.kick();
  }

  // ---------- page text ----------
  const fmt = (n) => n.toLocaleString("en-AU");

  function renderResults() {
    const h = Runs.headline(R);
    $("headline").textContent = h.title;
    $("summary").textContent = h.text;
    const best = Math.min(...Runs.ALGOS.map((a) => R[a].cost ?? Infinity));
    const fewest = Math.min(...Runs.ALGOS.map((a) => R[a].nodes));
    $("results").innerHTML =
      '<div class="res-head"><span>Algorithm</span><span>Effort</span><span>Steps</span></div>' +
      Runs.ALGOS.map((a) => {
        const x = R[a], badges = [];
        if (x.path && x.cost === best) badges.push("best route");
        if (x.nodes === fewest) badges.push("fewest nodes");
        return `<div class="res-row">
          <span class="nm"><i class="k ${a}"></i>${x.name}${badges.map((b) => `<span class="badge">${b}</span>`).join("")}</span>
          <span class="mono">${x.path ? x.cost : "none"}</span><span class="mono">${x.path ? x.steps : "none"}</span>
          <span class="bar"><i class="${a}" style="width:${(100 * x.nodes) / R.longest}%"></i></span>
          <span class="nodes"><b class="mono">${fmt(x.nodes)}</b> nodes taken off the queue (includes stale)</span>
        </div>`;
      }).join("");
    const fewer = R.ucs.nodes - R.astar.nodes;
    $("callout").hidden = !R.astar.path;
    $("callout").innerHTML = fewer > 0
      ? `<p class="big mono">${fmt(fewer)}</p><p class="lead">fewer nodes taken off the queue than Dijkstra</p>
         <p class="sub">${fmt(R.skipped.length)} ${R.skipped.length === 1 ? "cell" : "cells"} Dijkstra expanded ${R.skipped.length === 1 ? "was" : "were"} never expanded by A*. Turn on Cells A* skipped to see them hatched on the map.</p>`
      : `<p class="big mono">0</p><p class="lead">nodes saved by A* on this board</p>
         <p class="sub">A* takes the same ${fmt(R.astar.nodes)} nodes off the queue as Dijkstra. Every route of the same length ties, so the heuristic can't rank them.</p>`;
  }

  function renderSparkline() {
    const N = R.longest, W = 600, H = 56, peak = Math.max(1, ...Runs.ALGOS.map((a) => R[a].peak));
    const x = (i) => ((i / N) * W).toFixed(1), y = (v) => (H - 2 - (v / peak) * (H - 6)).toFixed(1);
    const line = (a) => `<polyline class="${a}" points="0,${y(1)} ${R[a].trace.map((t, i) => `${x(i + 1)},${y(t.frontier)}`).join(" ")}" />`;
    const marks = ["astar", "ucs"].filter((a) => R[a].path).map((a) => `<line class="flag ${a}" x1="${x(R[a].nodes)}" x2="${x(R[a].nodes)}" y1="0" y2="${H}" />`);
    $("spark").innerHTML = `${marks.join("")}${["bfs", "ucs", "astar"].map(line).join("")}<line id="cursor" x1="0" x2="0" y1="0" y2="${H}" />`;
    $("peaks").innerHTML = Runs.ALGOS.map((a) => `<span class="${a}">${R[a].name} peak ${R[a].peak}</span>`).join(", ");
    $("flags").innerHTML = ["astar", "ucs"].filter((a) => R[a].path)
      .map((a) => `<span style="left:${(100 * R[a].nodes) / N}%">${R[a].name} reaches the flag</span>`).join("");
  }

  function renderTimeline() {
    const tm = timing(), k = stepAt(S.t), scrub = $("scrub");
    scrub.max = tm.N;
    scrub.value = k;
    const after = S.t - tm.searchEnd;
    $("stepLabel").textContent = `Step ${fmt(k)} of ${fmt(tm.N)}` +
      (after > 0 && after < DRAW_MS ? ". Drawing the routes." : after >= DRAW_MS && S.t < tm.total ? ". Walking the best route." : "");
    scrub.setAttribute("aria-valuetext", `Step ${k} of ${tm.N}`);
    $("play").textContent = S.playing ? "Pause" : S.t >= tm.total ? "Replay" : "Play";
    $("prev").disabled = $("toStart").disabled = S.t <= 0;
    $("next").disabled = S.t >= tm.total;
    const cur = $("cursor");
    if (cur) cur.setAttribute("x1", ((k / tm.N) * 600).toFixed(1)), cur.setAttribute("x2", ((k / tm.N) * 600).toFixed(1));
  }

  function renderTools() {
    document.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === S.tool)));
    document.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", String(S.layers[b.dataset.layer])));
    $("hint").textContent = S.note || HINTS[S.tool];
    $("resetMap").hidden = !edited();
  }

  // ---------- tooltip: the A* numbers for the cell under the pointer or the keyboard cursor ----------
  function tipText([r, c]) {
    const v = S.grid[r][c], k = r * cols() + c, A = R.astar;
    const head = v === -1 ? `Cell (${r}, ${c}), creek` : `Cell (${r}, ${c}), elevation ${v}`;
    const pin = same([r, c], S.start) ? "The start. " : same([r, c], S.end) ? "The flag. " : "";
    if (v === -1) return [head, "Creek, impassable"];
    const s = A.closeStep[k];
    if (s >= 0) {
      const t = A.trace[s], h = t.f - t.g;
      return [head, `g ${t.g} + h ${h} = f ${t.f}`, `${pin}A* expanded it at step ${s + 1} of ${A.nodes}`];
    }
    return [head, pin + (A.reached[k] ? "In A*'s queue, never expanded" : "Never reached by A*")];
  }
  function renderTip() {
    const cell = S.hover || S.focus, tip = $("tip");
    tip.hidden = !cell;
    if (cell) tip.innerHTML = tipText(cell).map((l, i) => (i ? `<span class="mono">${l}</span>` : `<b>${l}</b>`)).join("");
  }
  function placeTip() {
    const cell = S.hover || S.focus, tip = $("tip");
    if (!cell || tip.hidden) return;
    const [X, Y] = view.P(cell[1] + 1, cell[0], terrain.heightAt(cell[1] + 1, cell[0]) * terrain.zScale);
    const x = Math.min(view.W - tip.offsetWidth - 8, Math.max(8, X + 6)), y = Math.min(view.H - tip.offsetHeight - 8, Math.max(8, Y));
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ---------- controls ----------
  function fitBoard(instant) {
    const pts = [0, 0, cols(), rows()];
    const k = view.framing(pts, 0, 0).k;
    view.kRange = [k * 0.6, k * 8];
    view.fit(pts, instant);
  }

  function bind() {
    const sel = $("map");
    for (const [name, label] of Object.entries(MAPS)) {
      const m = PF.parseMap(window.PATHFINDER_MAPS[name]);
      sel.add(new Option(`${label}, ${m.rows} by ${m.cols}`, name));
    }
    sel.addEventListener("change", () => {
      loadMap(sel.value);
      S.tool = "start";
      S.note = "";
      refresh("replay");
      fitBoard(false);
    });
    document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => {
      S.tool = b.dataset.tool;
      S.note = "";
      renderTools();
    }));
    document.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => {
      S.layers[b.dataset.layer] = !S.layers[b.dataset.layer];
      renderTools();
      view.kick();
    }));
    $("resetPins").addEventListener("click", () => {
      const s = S.base.start, e = S.base.end;
      if (!dry(s) || !dry(e)) return note("A pin's first cell is creek now. Reset the map first.");
      S.start = s.slice();
      S.end = e.slice();
      S.tool = "start";
      S.note = "";
      refresh("replay");
    });
    $("resetMap").addEventListener("click", () => {
      S.grid = S.base.grid.map((row) => row.slice());
      const moved = !dry(S.start) || !dry(S.end);
      if (moved) {
        S.start = S.base.start.slice();
        S.end = S.base.end.slice();
      }
      S.note = moved ? "The map is back to how it started, and so are the pins." : "";
      refresh("end");
    });
    $("play").addEventListener("click", () => (S.playing ? pause() : play()));
    $("toStart").addEventListener("click", () => {
      S.playing = false;
      seek(0);
    });
    $("prev").addEventListener("click", () => {
      S.playing = false;
      const tm = timing(), k = stepAt(S.t);
      seekStep(S.t > tm.searchEnd ? tm.N - 1 : k - 1);
    });
    $("next").addEventListener("click", () => {
      S.playing = false;
      const tm = timing(), k = stepAt(S.t);
      seek(k >= tm.N ? tm.total : (k + 1) * tm.stepMs);
    });
    $("scrub").addEventListener("input", (e) => {
      S.playing = false;
      seekStep(Number(e.target.value));
    });
    $("zin").addEventListener("click", () => view.zoomAt(view.W / 2, view.H / 2, 1.3));
    $("zout").addEventListener("click", () => view.zoomAt(view.W / 2, view.H / 2, 1 / 1.3));
    $("fit").addEventListener("click", () => fitBoard(false));

    const cv = $("cv");
    cv.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      const r = cv.getBoundingClientRect(), cell = cellAt(e.clientX - r.left, e.clientY - r.top);
      if (String(cell) === String(S.hover)) return;
      S.hover = cell;
      renderTip();
      view.kick();
    });
    cv.addEventListener("pointerleave", () => {
      S.hover = null;
      renderTip();
      view.kick();
    });
    cv.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && S.focus) {
        e.preventDefault();
        apply(S.focus, { done: new Set() });
      }
    });
    cv.addEventListener("focus", () => view.kick());
    cv.addEventListener("blur", () => view.kick());
    addEventListener("resize", () => view.resize());
    addEventListener("hashchange", () => {
      if (location.hash === lastHash) return;
      readHash();
      refresh("end");
      fitBoard(false);
    });
  }

  // ---------- start ----------
  bind();
  readHash();
  view = new MapView($("cv"), {
    mode3d: false,
    height: (w) => Math.round(Math.max(340, Math.min(w * 0.8, innerHeight - 230))),
    draw: frame,
    pick: (X, Y) => {
      const cell = cellAt(X, Y);
      if (cell) apply(cell, { done: new Set() });
    },
    grab,
    keyStep: 1,
    // leave room for the layer chips across the top
    fit: { fill: [0.92, 0.84], minSpan: 1, kRange: [2, 400], nudge: 24 },
  });
  setStyle(PathfinderTheme.current() === "dark" ? "night" : "terrain", false);
  PathfinderTheme.onChange((theme, fade) => setStyle(theme === "dark" ? "night" : "terrain", fade));
  fitBoard(true);
  // open on the finished run, so the first view already makes the point
  refresh("end");
})();
