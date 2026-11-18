/*
 * Adelaide CBD map: canvas renderer and the page controls. The camera and
 * map input (drag, zoom, keys, 2D/3D tweens) live in ../shared/view.js;
 * search logic lives in graph.js; pin names, the place search and the
 * summary sentence live in text.js; the search boxes, popovers, "?" tips and
 * the timeline bar live in ../shared/ui.js.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const X = AdelaideText;
  const num = X.num;
  // the data sits beside this script, wherever the page that loads it lives
  const DATA = new URL('data/adelaide_cbd.json', document.currentScript.src).href;
  // localStorage can be blocked; then the page just forgets between visits
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* see above */ } },
  };
  const SEEN = 'pathfinder-welcome-seen', LEARN = 'pathfinder-learn-open';
  // The replay takes about 7 s however long the searches are. The three race
  // at the same pace (one junction checked per step) and the race takes
  // SEARCH_MS; each route draws over DRAW_MS as soon as its search finishes;
  // then a marker walks the shortest route over WALK_MS. Steps advance with
  // elapsed time, not one per frame. Short searches step at most 40 ms apart.
  const SEARCH_MS = 4500, DRAW_MS = 900, WALK_MS = 1600, MAX_STEP_MS = 40;
  const DIM = 0.18; // the other layers while one search is in focus
  const FOCUS_MS = 220; // fade between focus states
  const TOUR_MS = 1500; // each step of the "Start with an example" tour
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const NAME = { A: 'A*', U: 'Dijkstra', B: 'BFS' }, SEARCH = { A: 'astar', U: 'ucs', B: 'bfs' };

  class MapApp {
    constructor(raw) {
      const D = AdelaideGraph.load(raw);
      const ring = (f, off) => { const p = []; for (let i = off; i < f.length; i++) p.push(f[i] / 2); return p; };
      D.bld = raw.b.map((f) => {
        const p = ring(f, 2); let cx = 0, cy = 0, area = 0; const m = p.length / 2;
        for (let i = 0; i < m; i++) { const j = (i + 1) % m; cx += p[2 * i]; cy += p[2 * i + 1]; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
        return { h: f[0], est: f[1], p, cx: cx / m, cy: cy / m, ccw: area > 0 };
      });
      D.green = raw.g.map((f) => ring(f, 0));
      D.water = raw.w.map((f) => ring(f, 0));
      D.rail = raw.rl.map((f) => ring(f, 0));
      D.bbox = raw.bbox.map((v) => v / 2);
      D.st = raw.st; D.pl = raw.pl;
      D.places = raw.pl.map(([name, x, y]) => [name, x / 2, y / 2]);
      // each landmark starts from its nearest junction on a main named street
      const rank = new Array(D.N).fill(99);
      D.edges.forEach((e) => { if (e.nm) for (const v of [e.a, e.b]) rank[v] = Math.min(rank[v], e.cls); });
      const named = []; for (let i = 0; i < D.N; i++) if (rank[i] <= 3) named.push(i);
      D.marks = D.places.map(([name, x, y]) => {
        let best = -1, bd = 1e18;
        for (const i of named) { const d = (D.nx[i] - x) ** 2 + (D.ny[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
        return { name, node: best };
      });
      this.D = D;
      this.entries = X.entries(D, D.marks).map((e) => Object.assign(e, { hint: e.kind === 'place' ? 'Place' : 'Street' }));
      this.layers = { aExp: true, dOnly: false, bfs: true, best: true };
      this.start = D.sp; this.end = D.ep;
      this.label = { start: null, end: null }; // a name chosen from a list, kept as typed
      this.next = 'start'; // which pin a plain click on the map moves
      this.picking = null; // 'start' or 'end' after "Pick on map"
      this.note = '';
      this.hover = null; this.kbd = null; this.pinned = null; this.focus = null; // which search the map shows
      this.alpha = this.alphas(); this.fade = null;
      this.t = 0; this.playing = false; this.last = 0; this.shownK = -1;
      this.speed = 1; // the timeline's speed control; 1 plays the race in about 7 s
      this.now = null; this.nowKey = ''; // the junction being checked while paused
      this.widths = new Map(); // label widths, measured once per font and text
      // Map colours follow the page theme, fading over 300 ms (at once under reduced motion).
      const P = AdelaidePalette.PALETTES;
      this.pal = { from: P[PathfinderTheme.current()], to: P[PathfinderTheme.current()], t0: 0 };
      PathfinderTheme.onChange((theme, fade) => {
        this.pal = { from: this.pal.to, to: P[theme], t0: fade ? performance.now() : 0 };
        this.view.kick();
      });
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.res = this.solve(this.start, this.end);
      this.view = new MapView($('cv'), {
        cam: { th: -0.38, tilt: 0.92, k: 0.5, cx: 0, cy: 0 },
        mode3d: true,
        height: () => $('map').clientHeight,
        draw: (now) => this.frame(now),
        pick: (x, y) => this.pick(x, y, 26),
      });
      this.view.bindButtons($('ctl'));
      this.bind();
      const est = D.bld.filter((b) => b.est).length;
      $('about').textContent = 'Real OpenStreetMap data for the city centre: ' + num(D.bld.length) + ' buildings and a walking network of ' + num(D.N) + ' junctions and ' + num(D.edges.length) + ' street and path segments. Heights come from each building\'s mapped height or floor count. ' + num(est) + ' buildings have neither, so they use a typical height and their roofs are drawn a shade darker.';
      this.showNames();
      this.ui();
      this.fit(true);
      // A first visit opens on the welcome card with the example walk ready to play.
      if (store.get(SEEN)) this.play(true);
      else this.welcome(true, false);
    }

    // The three searches, plus how long each takes: the median of 5 timed
    // runs, measured here from outside graph.js. Also the replay's clock.
    solve(s, t) {
      const res = AdelaideGraph.solve(this.D, s, t), time = (alg) => Timing.medianMs(() => AdelaideGraph.search(this.D, alg, s, t));
      res.ms = { B: time('bfs'), U: time('ucs'), A: time('astar') };
      const n = { A: res.A.order.length, U: res.U.order.length, B: res.B.order.length };
      const N = Math.max(n.A, n.U, n.B, 1), stepMs = Math.min(MAX_STEP_MS, SEARCH_MS / N), searchEnd = N * stepMs;
      res.tm = { n, N, stepMs, searchEnd, total: searchEnd + DRAW_MS + WALK_MS };
      return res;
    }

    // ---------- choosing the walk ----------
    setPin(which, v, label, fit) {
      if (v === (which === 'start' ? this.end : this.start)) {
        this.note = which === 'start' ? 'That is already your destination. Pick another place.' : 'That is already your start. Pick another place.';
        this.showNames();
        return this.ui();
      }
      this[which] = v;
      this.label[which] = label || null;
      this.next = which === 'start' ? 'end' : 'start';
      this.walkChanged(fit);
    }
    swap() {
      [this.start, this.end] = [this.end, this.start];
      [this.label.start, this.label.end] = [this.label.end, this.label.start];
      this.walkChanged(true);
    }
    example() {
      this.start = this.D.sp; this.end = this.D.ep;
      this.label = { start: null, end: null };
      this.next = 'start';
      this.walkChanged(true);
    }
    // A new walk runs the searches and replays them at once. A click on the
    // map leaves the camera alone, so the next click lands where you aimed.
    walkChanged(fit) {
      this.note = '';
      this.res = this.solve(this.start, this.end);
      this.showNames();
      this.findRoutes(fit);
    }
    findRoutes(fit) {
      this.ui();
      if (fit) this.fit(false);
      this.play(true);
    }
    showNames() {
      const D = this.D;
      this.setFrom(this.label.start || X.placeName(D, this.start, D.places));
      this.setTo(this.label.end || X.placeName(D, this.end, D.places));
    }
    startPick(which, button) {
      if (this.picking === which) return this.stopPick(true);
      this.picking = which;
      this.pickButton = button;
      this.note = '';
      this.ui();
      this.view.canvas.focus({ preventScroll: true }); // so Enter picks the middle and Escape cancels
      this.view.kick();
    }
    stopPick(refocus) {
      const b = this.pickButton;
      this.picking = null;
      this.pickButton = null;
      this.ui();
      this.view.kick();
      if (refocus && b) b.focus({ preventScroll: true });
    }
    // A click on the map (x, y in canvas pixels) moves a pin to the nearest junction within maxPx.
    pick(x, y, maxPx) {
      const D = this.D;
      let best = -1, bd = maxPx * maxPx;
      for (let i = 0; i < D.N; i++) {
        const p = this.view.P(D.nx[i], D.ny[i], 1.5);
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) { this.note = 'No street there. Click closer to a road or path.'; return this.ui(); }
      const which = this.picking || this.next, picked = !!this.picking;
      if (picked) this.stopPick(true);
      this.setPin(which, best, null, false);
    }

    // ---------- the replay ----------
    stepAt(t) { const tm = this.res.tm; return Math.min(tm.N, Math.floor(t / tm.stepMs + 1e-9)); }
    play(fromStart) {
      const tm = this.res.tm;
      if (fromStart || this.t >= tm.total) this.t = 0;
      if (this.reduce) { this.t = tm.total; this.playing = false; } // no animation: show the end at once
      else { this.playing = true; this.last = performance.now(); }
      this.view.kick();
    }
    seek(k) {
      const tm = this.res.tm;
      this.playing = false;
      this.t = k >= tm.N ? tm.total : Math.max(0, k) * tm.stepMs;
      this.view.kick();
    }
    // Step d junctions back or forward; forward from the end of the race skips to the end.
    step(d) {
      const tm = this.res.tm;
      this.seek(Math.max(0, Math.min(tm.N, this.stepAt(this.t) + d)));
    }
    frame(now) {
      const tm = this.res.tm;
      if (this.playing) {
        this.t += Math.min(100, Math.max(0, now - this.last)) * this.speed; // a hidden tab pauses rather than jumps
        this.last = now;
        if (this.t >= tm.total) { this.t = tm.total; this.playing = false; }
      }
      this.draw();
      this.progress();
      return this.playing || this.pal.t0 > 0 || !!this.fade;
    }
    // The timeline bar and each card's count of junctions checked so far.
    progress() {
      const tm = this.res.tm, k = this.stepAt(this.t), state = this.playing ? 'playing' : this.t >= tm.total ? 'done' : 'paused';
      this.timeline(k, tm.N, state, `${num(k)} junctions checked`);
      this.nowChip();
      if (k === this.shownK) return;
      this.shownK = k;
      for (const a of ['A', 'U', 'B']) {
        const n = tm.n[a], s = Math.min(n, k), c = this.cards[a];
        c.meta.textContent = `checked ${num(s)} junctions · found in ${Timing.formatMs(this.res.ms[a])}`;
        c.bar.style.setProperty('--p', n ? s / n : 1);
      }
    }

    // While paused or stepping during the race: the junction a search checked
    // last, and how far it is from the start along that search's route to it.
    // That search is the one in focus, or else the first still going.
    checking(step) {
      const R = this.res, tm = R.tm;
      if (this.playing || this.picking || step <= 0 || this.t >= tm.searchEnd) return null;
      const alg = this.focus || ['A', 'U', 'B'].find((a) => step < tm.n[a]) || 'B';
      return { alg, v: step <= tm.n[alg] ? R[alg].order[step - 1] : -1 };
    }
    nowChip() {
      const c = this.now, key = c ? c.alg + c.v + ':' + this.start + '-' + this.end : '';
      if (key === this.nowKey) return;
      this.nowKey = key;
      $('nowChip').hidden = !c;
      if (!c) return;
      if (c.v < 0) {
        $('nowWho').textContent = NAME[c.alg] + ' has finished';
        $('nowWhat').textContent = 'It reached your destination after ' + num(this.res.tm.n[c.alg]) + ' junctions';
        return;
      }
      const D = this.D, g = AdelaideGraph.search(D, SEARCH[c.alg], this.start, c.v).dist;
      $('nowWho').textContent = NAME[c.alg] + ' is checking';
      $('nowWhat').textContent = X.placeName(D, c.v, D.places) + ' · ' + X.distText(g) + ' from the start';
    }

    // ---------- which search the map shows ----------
    // How strongly to draw each layer: all that are on, or one search's
    // junctions and route with the rest faded back.
    alphas() {
      const L = this.layers, on = (k) => (L[k] ? 1 : 0), f = this.focus;
      if (f === 'A') return { dOnly: on('dOnly') * DIM, uAll: 0, aExp: 1, bDots: 0, bfs: on('bfs') * DIM, best: 1 };
      if (f === 'U') return { dOnly: 0, uAll: 1, aExp: 0, bDots: 0, bfs: on('bfs') * DIM, best: 1 };
      if (f === 'B') return { dOnly: on('dOnly') * DIM, uAll: 0, aExp: on('aExp') * DIM, bDots: 1, bfs: 1, best: on('best') * DIM };
      return { dOnly: on('dOnly'), uAll: 0, aExp: on('aExp'), bDots: 0, bfs: on('bfs'), best: on('best') };
    }
    refocus() {
      this.focus = this.hover || this.kbd || this.pinned;
      for (const a of ['A', 'U', 'B']) this.cards[a].pin.setAttribute('aria-pressed', String(this.pinned === a));
      const to = this.alphas();
      this.fade = this.reduce ? null : { from: this.alphaNow(), to, t0: performance.now() };
      this.alpha = to;
      this.view.kick();
    }
    alphaNow() {
      const f = this.fade;
      if (!f) return this.alpha;
      const p = clamp01((performance.now() - f.t0) / FOCUS_MS);
      if (p >= 1) { this.fade = null; return this.alpha; }
      const out = {};
      for (const k in f.to) out[k] = f.from[k] + (f.to[k] - f.from[k]) * p;
      return out;
    }

    // ---------- the welcome card and the tour ----------
    welcome(open, focus) {
      $('welcome').hidden = !open;
      if (open && focus) $('welcomeGo').focus();
      if (!open) store.set(SEEN, '1');
      this.view.kick();
    }
    tour() {
      if (this.reduce) return; // no tour under reduced motion
      const steps = [
        ['step1', 'Step 1: choose any two places here, or click the map.'],
        ['step2', 'Step 2: the three searches race. A* finishes first.'],
        ['step3', 'Step 3: what the race shows, in one sentence.'],
      ];
      let i = 0;
      const next = () => {
        document.querySelectorAll('.step.touring').forEach((s) => s.classList.remove('touring'));
        if (i >= steps.length) return this.endTour();
        const [id, text] = steps[i++];
        $(id).classList.add('touring');
        $(id).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        $('tourText').textContent = text;
        $('tour').hidden = false;
        this.tourTimer = setTimeout(next, TOUR_MS);
      };
      next();
    }
    endTour() {
      clearTimeout(this.tourTimer);
      this.tourTimer = 0;
      document.querySelectorAll('.step.touring').forEach((s) => s.classList.remove('touring'));
      $('tour').hidden = true;
    }

    // ---------- controls ----------
    bind() {
      const D = this.D;
      const box = (which, input, list) => UI.combobox(input, list, {
        search: (q) => X.search(q, this.entries),
        pick: (e) => {
          if (e.node === undefined) e.node = X.streetNode(D, e.nm);
          this.setPin(which, e.node, e.label, true);
        },
        status: $('cbStatus'),
      });
      this.setFrom = box('start', $('from'), $('fromList'));
      this.setTo = box('end', $('to'), $('toList'));
      document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => this.startPick(b.dataset.pick, b)));
      $('swap').addEventListener('click', () => this.swap());
      $('find').addEventListener('click', () => this.findRoutes(true));
      $('example').addEventListener('click', () => this.example());
      // result cards: hover or focus shows that search, a click keeps it
      this.cards = {};
      document.querySelectorAll('.rc').forEach((el) => {
        const a = el.dataset.alg, pin = el.querySelector('.rc-pin');
        this.cards[a] = { pin, time: el.querySelector('.rc-time'), dist: el.querySelector('.rc-dist'), meta: el.querySelector('.rc-meta'), bar: el.querySelector('.rc-bar') };
        el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { this.hover = a; this.refocus(); } });
        el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { this.hover = null; this.refocus(); } });
        pin.addEventListener('focus', () => { this.kbd = a; this.refocus(); });
        pin.addEventListener('blur', () => { this.kbd = null; this.refocus(); });
        pin.addEventListener('click', () => { this.pinned = this.pinned === a ? null : a; this.refocus(); });
      });
      document.querySelectorAll('[data-layer]').forEach((c) => c.addEventListener('change', () => { this.layers[c.dataset.layer] = c.checked; this.refocus(); }));
      UI.popover($('layersBtn'), $('layersPanel'), () => this.view.kick());
      UI.popover($('aboutBtn'), $('aboutPanel'), () => this.view.kick());
      this.timeline = UI.timeline($('timeline'), {
        toggle: () => { if (this.playing) this.playing = false; else this.play(false); this.view.kick(); },
        seek: (k) => this.seek(k),
        step: (d) => this.step(d),
        speed: (x) => { this.speed = x; },
      });
      $('go2d').addEventListener('click', () => { this.view.set3d(false); this.ui(); });
      $('go3d').addEventListener('click', () => { this.view.set3d(true); this.ui(); });
      $('fit').addEventListener('click', () => this.fit(false));
      // the welcome card, and "?" in the header to see it again
      $('welcomeBtn').addEventListener('click', () => this.welcome(true, true));
      $('welcomeClose').addEventListener('click', () => {
        this.welcome(false);
        if (!this.playing && this.t === 0) this.play(true);
        $('welcomeBtn').focus({ preventScroll: true });
      });
      $('welcomeGo').addEventListener('click', () => { this.welcome(false); this.example(); this.tour(); });
      $('tourSkip').addEventListener('click', () => this.endTour());
      const learn = $('learn');
      learn.open = store.get(LEARN) === 'open';
      learn.addEventListener('toggle', () => store.set(LEARN, learn.open ? 'open' : 'closed'));
      this.view.canvas.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && this.picking) { e.preventDefault(); this.pick(this.view.W / 2, this.view.H / 2, Infinity); }
      });
      // Escape steps back out: picking on the map, then the tour, then the welcome card
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (this.picking) this.stopPick(true);
        else if (this.tourTimer) this.endTour();
        else if (!$('welcome').hidden) $('welcomeClose').click();
      });
    }
    ui() {
      const R = this.res, view = this.view;
      $('go3d').setAttribute('aria-pressed', String(view.mode3d)); $('go2d').setAttribute('aria-pressed', String(!view.mode3d));
      // turning and tilting are 3D only
      $('help').textContent = view.mode3d ? 'Drag to move the map. Right-drag or Ctrl and drag to turn and tilt it. Scroll or pinch to zoom.' : 'Drag to move the map. Scroll or pinch to zoom.';
      const whose = (w) => (w === 'start' ? 'start' : 'destination');
      document.querySelectorAll('[data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(this.picking === b.dataset.pick)));
      $('hint').textContent = this.note || (this.picking ? '' : `The next click on the map sets your ${whose(this.next)}.`);
      const chip = $('pickChip');
      chip.hidden = !this.picking;
      if (this.picking) {
        const small = document.createElement('small');
        small.textContent = ' Or press Enter for the middle of the map. Escape cancels.';
        chip.replaceChildren(`Click the map to set your ${whose(this.picking)}.`, document.createElement('br'), small);
      }
      view.canvas.classList.toggle('picking', !!this.picking);
      for (const a of ['A', 'U', 'B']) {
        const r = R[a], c = this.cards[a];
        c.time.textContent = r.path ? X.walkTime(r.dist) : 'No route';
        c.dist.textContent = r.path ? X.distText(r.dist) : '';
      }
      this.shownK = -1; // the counts redraw on the next frame
      $('insight').textContent = X.insight(R);
      view.kick();
    }
    // Frame both routes and the two pins.
    fit(instant) {
      const D = this.D, R = this.res, pts = [];
      [R.al, R.bl].forEach((ln) => { if (ln) for (let i = 0; i < ln.pts.length; i += 2) pts.push(ln.pts[i], ln.pts[i + 1]); });
      [this.start, this.end].forEach((v) => pts.push(D.nx[v], D.ny[v]));
      this.view.fit(pts, instant);
    }
    colours() {
      const f = this.pal.t0 ? Math.min(1, (performance.now() - this.pal.t0) / 300) : 1;
      if (f >= 1) this.pal.t0 = 0;
      return AdelaidePalette.mix(this.pal.from, this.pal.to, f);
    }

    draw() {
      const view = this.view, ctx = view.ctx, D = this.D, m = view.cam, W = view.W, H = view.H, C = this.colours();
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      const c = Math.cos(m.th), s = Math.sin(m.th), ct = Math.cos(m.tilt), st = Math.sin(m.tilt), k = m.k;
      const hw = W / 2, hh = H / 2, cx = m.cx, cy = m.cy;
      const PX = (x, y) => hw + ((x - cx) * c - (y - cy) * s) * k;
      const PY = (x, y, z) => hh + (((x - cx) * s + (y - cy) * c) * ct - z * st) * k;
      const poly = (p, z) => {
        ctx.moveTo(PX(p[0], p[1]), PY(p[0], p[1], z));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(PX(p[i], p[i + 1]), PY(p[i], p[i + 1], z));
        ctx.closePath();
      };
      // land
      const bb = D.bbox;
      ctx.beginPath(); poly([bb[0], bb[1], bb[2], bb[1], bb[2], bb[3], bb[0], bb[3]], 0);
      ctx.fillStyle = C.land; ctx.fill();
      ctx.beginPath(); D.green.forEach((p) => poly(p, 0)); ctx.fillStyle = C.green; ctx.fill();
      ctx.beginPath(); D.water.forEach((p) => poly(p, 0)); ctx.fillStyle = C.water; ctx.fill();
      // roads, thinnest first
      const W_ = [15, 10, 5.5, 7, 2.2];
      const col = [C.road0, C.road1, C.road2, C.road3, C.road0];
      const strokeCls = (cl, width, color) => {
        ctx.beginPath();
        for (const e of D.edges) {
          if (e.cls !== cl) continue;
          const p = e.pts;
          ctx.moveTo(PX(p[0], p[1]), PY(p[0], p[1], 0));
          for (let i = 2; i < p.length; i += 2) ctx.lineTo(PX(p[i], p[i + 1]), PY(p[i], p[i + 1], 0));
        }
        ctx.lineWidth = Math.max(0.6, width * k); ctx.strokeStyle = color; ctx.stroke();
      };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      strokeCls(4, W_[4], C.path);
      [2, 3, 1, 0].forEach((cl) => strokeCls(cl, W_[cl] + 2.5, C.casing));
      [2, 3, 1, 0].forEach((cl) => strokeCls(cl, W_[cl], col[cl]));
      ctx.beginPath();
      D.rail.forEach((p) => { ctx.moveTo(PX(p[0], p[1]), PY(p[0], p[1], 0)); for (let i = 2; i < p.length; i += 2) ctx.lineTo(PX(p[i], p[i + 1]), PY(p[i], p[i + 1], 0)); });
      ctx.lineWidth = Math.max(0.8, 2.2 * k); ctx.strokeStyle = C.rail; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      // buildings
      const flat = m.tilt < 0.03;
      const vis = [];
      const pad = 80;
      for (const b of D.bld) {
        const X_ = PX(b.cx, b.cy), Y_ = PY(b.cx, b.cy, 0);
        if (X_ < -pad || X_ > W + pad || Y_ < -pad || Y_ > H + pad + b.h * st * k) continue;
        vis.push(b);
        b.depth = (b.cx - cx) * s + (b.cy - cy) * c;
      }
      if (flat) {
        ctx.beginPath(); vis.forEach((b) => poly(b.p, 0));
        ctx.fillStyle = C.flat; ctx.fill(); ctx.lineWidth = 0.6; ctx.strokeStyle = C.flatEdge; ctx.stroke();
      } else {
        vis.sort((a, b) => a.depth - b.depth);
        for (const b of vis) {
          const p = b.p, n = p.length / 2, z = b.h;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const ex = p[2 * j] - p[2 * i], ey = p[2 * j + 1] - p[2 * i + 1];
            let nx = b.ccw ? ey : -ey, ny = b.ccw ? -ex : ex;
            const depthN = nx * s + ny * c;
            if (depthN <= 0) continue;
            const sx = (nx * c - ny * s) / (Math.hypot(nx, ny) || 1);
            const l = C.wall[0] + sx * C.wall[1], t = C.wall[2];
            ctx.beginPath();
            ctx.moveTo(PX(p[2 * i], p[2 * i + 1]), PY(p[2 * i], p[2 * i + 1], 0));
            ctx.lineTo(PX(p[2 * j], p[2 * j + 1]), PY(p[2 * j], p[2 * j + 1], 0));
            ctx.lineTo(PX(p[2 * j], p[2 * j + 1]), PY(p[2 * j], p[2 * j + 1], z));
            ctx.lineTo(PX(p[2 * i], p[2 * i + 1]), PY(p[2 * i], p[2 * i + 1], z));
            ctx.closePath();
            ctx.fillStyle = `rgb(${Math.round(l + t[0])},${Math.round(l + t[1])},${Math.round(l + t[2])})`; ctx.fill();
          }
          ctx.beginPath(); poly(p, z);
          ctx.fillStyle = b.est ? C.roofEst : C.roof; ctx.fill();
          ctx.lineWidth = 0.5; ctx.strokeStyle = C.roofEdge; ctx.stroke();
        }
      }
      // ---------- search overlay: the junctions each search has checked so far, then the routes ----------
      const R = this.res, tm = R.tm, time = this.t, step = this.stepAt(time), A = this.alphaNow();
      const dotR = Math.max(1.8, Math.min(4.5, 6 * k));
      const lift = 1.5;
      const dots = (order, color, alpha, skip) => {
        if (alpha < 0.01) return;
        const n = Math.min(order.length, step);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const v = order[i];
          if (skip && skip[v]) continue;
          const X_ = PX(D.nx[v], D.ny[v]), Y_ = PY(D.nx[v], D.ny[v], lift);
          ctx.moveTo(X_ + dotR, Y_); ctx.arc(X_, Y_, dotR, 0, 6.2832);
        }
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      };
      dots(R.U.order, C.skipped, A.dOnly, R.A.closed); // Dijkstra's checks that A* never needed
      dots(R.U.order, C.skipped, A.uAll);
      dots(R.B.order, C.bfsExplored, A.bDots);
      dots(R.A.order, C.explored, A.aExp);
      // the junction being checked, ringed, while paused
      this.now = this.checking(step);
      if (this.now && this.now.v >= 0) {
        const v = this.now.v, X_ = PX(D.nx[v], D.ny[v]), Y_ = PY(D.nx[v], D.ny[v], lift);
        ctx.beginPath(); ctx.arc(X_, Y_, dotR + 6, 0, 6.2832);
        ctx.lineWidth = 5; ctx.strokeStyle = C.halo; ctx.stroke();
        ctx.lineWidth = 2.5; ctx.strokeStyle = C.ink; ctx.stroke();
      }
      const drawLine = (ln, color, w, frac, alpha) => {
        if (!ln || frac <= 0 || alpha < 0.01) return;
        const target = ln.L * frac;
        ctx.beginPath();
        ctx.moveTo(PX(ln.pts[0], ln.pts[1]), PY(ln.pts[0], ln.pts[1], lift));
        for (let i = 1; i < ln.cum.length; i++) {
          const x = ln.pts[2 * i], y = ln.pts[2 * i + 1];
          if (ln.cum[i] > target) {
            const a = (target - ln.cum[i - 1]) / (ln.cum[i] - ln.cum[i - 1] || 1);
            const px = ln.pts[2 * i - 2] + (x - ln.pts[2 * i - 2]) * a, py = ln.pts[2 * i - 1] + (y - ln.pts[2 * i - 1]) * a;
            ctx.lineTo(PX(px, py), PY(px, py, lift)); break;
          }
          ctx.lineTo(PX(x, y), PY(x, y, lift));
        }
        ctx.globalAlpha = alpha;
        ctx.lineWidth = w + 4; ctx.strokeStyle = C.routeHalo; ctx.stroke();
        ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
        ctx.globalAlpha = 1;
      };
      // each route draws once its own search has finished
      const drawn = (n) => { const p = clamp01((time - n * tm.stepMs) / DRAW_MS); return 1 - Math.pow(1 - p, 3); };
      drawLine(R.bl, C.bfs, 3.5, drawn(tm.n.B), A.bfs);
      drawLine(R.al, C.best, 5, drawn(tm.n.A), A.best);
      // then a marker walks the shortest route
      const walkFrom = tm.searchEnd + DRAW_MS;
      if (R.al && time > walkFrom && A.best > 0.5) {
        const q = Math.min(1, (time - walkFrom) / WALK_MS), e2 = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
        const target = R.al.L * e2; let i = 1;
        while (i < R.al.cum.length - 1 && R.al.cum[i] < target) i++;
        const a = (target - R.al.cum[i - 1]) / (R.al.cum[i] - R.al.cum[i - 1] || 1);
        const x = R.al.pts[2 * i - 2] + (R.al.pts[2 * i] - R.al.pts[2 * i - 2]) * a, y = R.al.pts[2 * i - 1] + (R.al.pts[2 * i + 1] - R.al.pts[2 * i - 1]) * a;
        const X_ = PX(x, y), Y_ = PY(x, y, lift);
        ctx.beginPath(); ctx.ellipse(X_, Y_ + 2, 8, 3.5, 0, 0, 6.2832); ctx.fillStyle = C.markerShadow; ctx.fill();
        ctx.beginPath(); ctx.arc(X_, Y_ - 5, 6.5, 0, 6.2832); ctx.fillStyle = C.marker; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.best; ctx.stroke();
      }
      // pins first
      const sp = [PX(D.nx[this.start], D.ny[this.start]), PY(D.nx[this.start], D.ny[this.start], lift)];
      const ep = [PX(D.nx[this.end], D.ny[this.end]), PY(D.nx[this.end], D.ny[this.end], lift)];
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 8, 0, 6.2832); ctx.fillStyle = C.pinFill; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.pin; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ep[0], ep[1]); ctx.lineTo(ep[0], ep[1] - 34); ctx.lineWidth = 2.4; ctx.strokeStyle = C.pin; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ep[0], ep[1] - 34); ctx.lineTo(ep[0] + 18, ep[1] - 27); ctx.lineTo(ep[0], ep[1] - 20); ctx.closePath(); ctx.fillStyle = C.pin; ctx.fill();
      // while picking, a crosshair marks the middle of the map, where Enter picks
      if (this.picking) {
        ctx.beginPath(); ctx.moveTo(hw - 12, hh); ctx.lineTo(hw - 4, hh); ctx.moveTo(hw + 4, hh); ctx.lineTo(hw + 12, hh);
        ctx.moveTo(hw, hh - 12); ctx.lineTo(hw, hh - 4); ctx.moveTo(hw, hh + 4); ctx.lineTo(hw, hh + 12);
        ctx.lineWidth = 4; ctx.strokeStyle = C.halo; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
      }
      // Then the pins' names, landmarks and streets, in that order. A label
      // that would overlap a pin, a label already placed or a control floating
      // over the map is left out (see ../shared/labels.js).
      const F_PIN = '650 13px Geist, -apple-system, system-ui, sans-serif', F_PL = '650 12.5px Geist, -apple-system, system-ui, sans-serif', F_ST = '500 11px Geist, -apple-system, system-ui, sans-serif';
      const ATTR = 'Map data © OpenStreetMap contributors', START = 'Start', END = 'Destination';
      const tw = (txt, font) => { const key = font + txt; if (!this.widths.has(key)) { ctx.font = font; this.widths.set(key, ctx.measureText(txt).width); } return this.widths.get(key); };
      const box = (x, y, txt, font, h) => MapLabels.around(x, y, tw(txt, font), h);
      const blockers = [
        { x: sp[0] - 10, y: sp[1] - 10, w: 20, h: 20 },
        { x: ep[0] - 3, y: ep[1] - 36, w: 22, h: 38 },
        { x: W - 14 - tw(ATTR, F_ST), y: H - 22, w: tw(ATTR, F_ST) + 8, h: 18 },
        ...MapLabels.controlBoxes(view.canvas, document.querySelectorAll('.map-tl > *, .map-tr > *, .map-bottom > *, .pick-chip, .now-chip, .welcome')),
      ];
      const items = [
        { txt: START, font: F_PIN, color: C.ink, candidates: [box(sp[0] + 13 + tw(START, F_PIN) / 2, sp[1], START, F_PIN, 15), box(sp[0] - 13 - tw(START, F_PIN) / 2, sp[1], START, F_PIN, 15)] },
        { txt: END, font: F_PIN, color: C.ink, candidates: [box(ep[0] + 22 + tw(END, F_PIN) / 2, ep[1] - 26, END, F_PIN, 15), box(ep[0] - 6 - tw(END, F_PIN) / 2, ep[1] - 26, END, F_PIN, 15)] },
      ];
      const onScreen = (x, y) => x > -40 && x < W + 40 && y > -20 && y < H + 20;
      D.pl.forEach(([nm, x, y]) => {
        const X_ = PX(x / 2, y / 2), Y_ = PY(x / 2, y / 2, nm === 'Adelaide Oval' ? 40 : 6);
        if (onScreen(X_, Y_)) items.push({ txt: nm, font: F_PL, color: nm === 'River Torrens' ? C.river : C.ink, candidates: [box(X_, Y_, nm, F_PL, 15), box(X_, Y_ - 17, nm, F_PL, 15), box(X_, Y_ + 17, nm, F_PL, 15)] });
      });
      if (k > 0.33) D.st.forEach(([nm, x, y]) => {
        const X_ = PX(x / 2, y / 2), Y_ = PY(x / 2, y / 2, 0);
        if (onScreen(X_, Y_)) items.push({ txt: nm, font: F_ST, color: C.street, candidates: [box(X_, Y_, nm, F_ST, 13)] });
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 4;
      for (const { item, box: b } of MapLabels.place(items, blockers, { x: 0, y: 0, w: W, h: H })) {
        const X_ = b.x + b.w / 2, Y_ = b.y + b.h / 2;
        ctx.font = item.font; ctx.strokeStyle = item.font === F_ST ? C.streetHalo : C.halo; ctx.strokeText(item.txt, X_, Y_);
        ctx.fillStyle = item.color; ctx.fillText(item.txt, X_, Y_);
      }
      ctx.textAlign = 'right'; ctx.font = F_ST; ctx.lineWidth = 4; ctx.strokeStyle = C.streetHalo; ctx.strokeText(ATTR, W - 10, H - 12);
      ctx.fillStyle = C.attr;
      ctx.fillText(ATTR, W - 10, H - 12);
    }
  }

  fetch(DATA)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((raw) => { $('loading').remove(); window.app = new MapApp(raw); })
    .catch((err) => {
      console.error(err);
      $('loading').textContent = 'Could not load the map data. Serve the docs folder over HTTP (python -m http.server) rather than opening the file directly.';
    });
})();
