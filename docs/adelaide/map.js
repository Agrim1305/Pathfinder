/*
 * Adelaide CBD map: canvas renderer and the page controls. The camera and
 * map input (drag, zoom, keys, 2D/3D tweens) live in ../shared/view.js;
 * search logic lives in graph.js.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  class MapApp {
    constructor(raw) {
      const G = AdelaideGraph.load(raw);
      const D = G;
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
      // a readable name for each junction: its most important named street
      D.nodeName = new Array(D.N).fill('');
      const rank = new Array(D.N).fill(99);
      D.edges.forEach((e) => { if (!e.nm) return; [e.a, e.b].forEach((v) => { if (e.cls < rank[v]) { rank[v] = e.cls; D.nodeName[v] = raw.names[e.nm]; } }); });
      const named = []; for (let i = 0; i < D.N; i++) if (rank[i] <= 3) named.push(i);
      D.marks = raw.pl.map(([name, x, y]) => {
        let best = -1, bd = 1e18;
        for (const i of named) { const d = (D.nx[i] - x / 2) ** 2 + (D.ny[i] - y / 2) ** 2; if (d < bd) { bd = d; best = i; } }
        return { name, node: best };
      }).sort((a, b) => a.name.localeCompare(b.name));
      this.D = D;
      this.state = { aExp: true, dOnly: false, bfs: true, best: true, start: D.sp, end: D.ep, place: 'start', note: '' };
      this.t0 = 0;
      this.widths = new Map(); // label widths, measured once per font and text
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.res = AdelaideGraph.solve(D, D.sp, D.ep);
      this.bindControls();
      this.view = new MapView($('cv'), {
        cam: { th: -0.38, tilt: 0.92, k: 0.5, cx: 0, cy: 0 },
        mode3d: true,
        height: (w) => Math.round(Math.min(Math.max(w * 0.66, 420), 760)),
        // the search replay runs on its own clock from t0; reduced motion shows the end at once
        draw: (now) => { const el = this.reduce ? 1e9 : now - this.t0; this.draw(el); return el < this.timeline().end + 50; },
        pick: (X, Y) => this.pick(X, Y),
      });
      this.fit(true);
      this.restart();
      this.ui();
    }
    setState(patch, cb) { Object.assign(this.state, patch); this.ui(); if (cb) cb(); }
    solve(s, t) { return AdelaideGraph.solve(this.D, s, t); }
    movePin(v) {
      const s = this.state, start = s.place === 'start', other = start ? s.end : s.start;
      if (v === other) { this.setState({ note: start ? 'The flag is already there.' : 'The start is already there.' }); return; }
      const ns = start ? v : s.start, ne = start ? s.end : v;
      this.res = this.solve(ns, ne);
      this.setState({ start: ns, end: ne, place: start ? 'end' : 'start', note: '' }, () => this.restart());
    }
    bindControls() {
      document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.layer; this.setState({ [k]: !this.state[k] }, () => this.view.kick()); }));
      $('go2d').addEventListener('click', () => { this.view.set3d(false); this.ui(); });
      $('go3d').addEventListener('click', () => { this.view.set3d(true); this.ui(); });
      $('replay').addEventListener('click', () => this.restart());
      $('zin').addEventListener('click', () => this.view.zoomAt(this.view.W / 2, this.view.H / 2, 1.3));
      $('zout').addEventListener('click', () => this.view.zoomAt(this.view.W / 2, this.view.H / 2, 1 / 1.3));
      $('fit').addEventListener('click', () => this.fit(false));
      $('pStart').addEventListener('click', () => this.setState({ place: 'start', note: '' }));
      $('pEnd').addEventListener('click', () => this.setState({ place: 'end', note: '' }));
      $('resetPins').addEventListener('click', () => { const D = this.D; this.res = this.solve(D.sp, D.ep); this.setState({ start: D.sp, end: D.ep, place: 'start', note: '' }, () => { this.restart(); this.fit(false); }); });
      const sel = $('marks');
      this.D.marks.forEach((m) => { const o = document.createElement('option'); o.value = m.node; o.textContent = m.name; sel.appendChild(o); });
      sel.addEventListener('change', () => { const n = Number(sel.value); if (sel.value !== '' && n >= 0) this.movePin(n); sel.value = ''; });
    }
    ui() {
      const s = this.state, D = this.D, R = this.res;
      document.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(s[b.dataset.layer])));
      $('go3d').setAttribute('aria-pressed', String(this.view.mode3d)); $('go2d').setAttribute('aria-pressed', String(!this.view.mode3d));
      const ps = s.place === 'start';
      $('pStart').setAttribute('aria-pressed', String(ps)); $('pEnd').setAttribute('aria-pressed', String(!ps));
      const nm = (n) => D.nodeName[n] || 'a footpath';
      $('hint').textContent = s.note || ('Start on ' + nm(s.start) + '. Flag on ' + nm(s.end) + '. Click the map to move the ' + (ps ? 'start.' : 'flag.'));
      const dist = (r) => (r.path ? Math.round(r.dist).toLocaleString('en-AU') + ' m' : 'no route');
      const ex = (r) => r.order.length.toLocaleString('en-AU') + ' junctions';
      $('bfsDist').textContent = dist(R.B); $('ucsDist').textContent = dist(R.U); $('astarDist').textContent = dist(R.A);
      $('bfsN').textContent = ex(R.B); $('ucsN').textContent = ex(R.U); $('astarN').textContent = ex(R.A);
      const longer = Math.round(R.B.dist - R.A.dist);
      if (longer > 5) {
        $('headline').textContent = 'BFS counts segments, not metres. It walks ' + longer + ' m further.';
        $('summary').textContent = 'BFS finds the route with the fewest street segments (' + R.B.pe.length + '). Dijkstra and A* find the shortest walk, ' + Math.round(R.A.dist) + ' m. A* gets there after expanding ' + R.A.order.length + ' junctions; Dijkstra expands ' + R.U.order.length + '.';
      } else {
        $('headline').textContent = 'Same walk for all three. A* searched far less.';
        $('summary').textContent = 'Every algorithm finds a ' + Math.round(R.A.dist) + ' m walk here. A* expanded ' + R.A.order.length + ' junctions, Dijkstra ' + R.U.order.length + ' and BFS ' + R.B.order.length + '.';
      }
      const est = D.bld.filter((b) => b.est).length;
      $('about').textContent = 'Real OpenStreetMap data for the city centre: ' + D.bld.length.toLocaleString('en-AU') + ' buildings and a walking network of ' + D.N.toLocaleString('en-AU') + ' junctions and ' + D.edges.length.toLocaleString('en-AU') + ' street and path segments. Heights come from each building\'s mapped height or floor count. ' + est.toLocaleString('en-AU') + ' buildings have neither, so they use a typical height and their roofs are drawn a shade darker.';
    }
    // Frame both routes and the two pins.
    fit(instant) {
      const D = this.D, R = this.res, pts = [];
      [R.al, R.bl].forEach((ln) => { if (ln) for (let i = 0; i < ln.pts.length; i += 2) pts.push(ln.pts[i], ln.pts[i + 1]); });
      [this.state.start, this.state.end].forEach((v) => pts.push(D.nx[v], D.ny[v]));
      this.view.fit(pts, instant);
    }
    restart() { this.t0 = performance.now(); this.view.kick(); }
    timeline() {
      const n = this.res.A.order.length, step = Math.min(14, 1800 / Math.max(n, 1));
      const reveal = n * step;
      return { step, reveal, drawEnd: reveal + 1300, end: reveal + 1300 + 2800 };
    }
    draw(el) {
      const view = this.view, ctx = view.ctx, D = this.D, m = view.cam, W = view.W, H = view.H;
      ctx.fillStyle = '#E9EBE6'; ctx.fillRect(0, 0, W, H);
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
      ctx.fillStyle = '#F4F3EF'; ctx.fill();
      ctx.beginPath(); D.green.forEach((p) => poly(p, 0)); ctx.fillStyle = '#D3E8C4'; ctx.fill();
      ctx.beginPath(); D.water.forEach((p) => poly(p, 0)); ctx.fillStyle = '#AFD5EC'; ctx.fill();
      // roads, thinnest first
      const W_ = [15, 10, 5.5, 7, 2.2];
      const col = ['#FFFFFF', '#FFFFFF', '#FDFDFC', '#F7EFE2', '#FFFFFF'];
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
      strokeCls(4, W_[4], 'rgba(255,255,255,0.9)');
      [2, 3, 1, 0].forEach((cl) => strokeCls(cl, W_[cl] + 2.5, '#DCDDD8'));
      [2, 3, 1, 0].forEach((cl) => strokeCls(cl, W_[cl], col[cl]));
      ctx.beginPath();
      D.rail.forEach((p) => { ctx.moveTo(PX(p[0], p[1]), PY(p[0], p[1], 0)); for (let i = 2; i < p.length; i += 2) ctx.lineTo(PX(p[i], p[i + 1]), PY(p[i], p[i + 1], 0)); });
      ctx.lineWidth = Math.max(0.8, 2.2 * k); ctx.strokeStyle = '#B9BCC2'; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      // buildings
      const flat = m.tilt < 0.03;
      const vis = [];
      const pad = 80;
      for (const b of D.bld) {
        const X = PX(b.cx, b.cy), Y = PY(b.cx, b.cy, 0);
        if (X < -pad || X > W + pad || Y < -pad || Y > H + pad + b.h * st * k) continue;
        vis.push(b);
        b.depth = (b.cx - cx) * s + (b.cy - cy) * c;
      }
      if (flat) {
        ctx.beginPath(); vis.forEach((b) => poly(b.p, 0));
        ctx.fillStyle = '#E1E3E6'; ctx.fill(); ctx.lineWidth = 0.6; ctx.strokeStyle = '#CDD0D5'; ctx.stroke();
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
            const l = Math.round(214 - sx * 22);
            ctx.beginPath();
            ctx.moveTo(PX(p[2 * i], p[2 * i + 1]), PY(p[2 * i], p[2 * i + 1], 0));
            ctx.lineTo(PX(p[2 * j], p[2 * j + 1]), PY(p[2 * j], p[2 * j + 1], 0));
            ctx.lineTo(PX(p[2 * j], p[2 * j + 1]), PY(p[2 * j], p[2 * j + 1], z));
            ctx.lineTo(PX(p[2 * i], p[2 * i + 1]), PY(p[2 * i], p[2 * i + 1], z));
            ctx.closePath();
            ctx.fillStyle = `rgb(${l},${l + 2},${l + 6})`; ctx.fill();
          }
          ctx.beginPath(); poly(p, z);
          ctx.fillStyle = b.est ? '#F1F2F4' : '#F7F8FA'; ctx.fill();
          ctx.lineWidth = 0.5; ctx.strokeStyle = '#C9CCD2'; ctx.stroke();
        }
      }
      // ---------- search overlay ----------
      const R = this.res, st8 = this.state, tl = this.timeline();
      const dotR = Math.max(1.8, Math.min(4.5, 6 * k));
      const lift = 1.5;
      if (st8.dOnly) {
        ctx.beginPath();
        for (const v of R.skipped) { const X = PX(D.nx[v], D.ny[v]), Y = PY(D.nx[v], D.ny[v], lift); ctx.moveTo(X + dotR, Y); ctx.arc(X, Y, dotR, 0, 6.2832); }
        ctx.fillStyle = 'rgba(15,118,110,0.5)'; ctx.fill();
      }
      if (st8.aExp) {
        const shown = Math.min(R.A.order.length, Math.floor(el / tl.step) + 1);
        ctx.beginPath();
        for (let i = 0; i < shown; i++) { const v = R.A.order[i]; const X = PX(D.nx[v], D.ny[v]), Y = PY(D.nx[v], D.ny[v], lift); ctx.moveTo(X + dotR, Y); ctx.arc(X, Y, dotR, 0, 6.2832); }
        ctx.fillStyle = 'rgba(29,78,216,0.62)'; ctx.fill();
      }
      const drawLine = (ln, color, w, frac) => {
        if (!ln || frac <= 0) return;
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
        ctx.lineWidth = w + 4; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
        ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
      };
      const pr = Math.max(0, Math.min(1, (el - tl.reveal) / 1300)), ease = 1 - Math.pow(1 - pr, 3);
      if (st8.bfs) drawLine(R.bl, '#C2410C', 3.5, ease);
      if (st8.best) drawLine(R.al, '#1D4ED8', 5, ease);
      // marker travels the best route
      if (R.al && el > tl.drawEnd && st8.best) {
        const q = Math.min(1, (el - tl.drawEnd) / 2800), e2 = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
        const target = R.al.L * e2; let i = 1;
        while (i < R.al.cum.length - 1 && R.al.cum[i] < target) i++;
        const a = (target - R.al.cum[i - 1]) / (R.al.cum[i] - R.al.cum[i - 1] || 1);
        const x = R.al.pts[2 * i - 2] + (R.al.pts[2 * i] - R.al.pts[2 * i - 2]) * a, y = R.al.pts[2 * i - 1] + (R.al.pts[2 * i + 1] - R.al.pts[2 * i - 1]) * a;
        const X = PX(x, y), Y = PY(x, y, lift);
        ctx.beginPath(); ctx.ellipse(X, Y + 2, 8, 3.5, 0, 0, 6.2832); ctx.fillStyle = 'rgba(21,24,29,0.2)'; ctx.fill();
        ctx.beginPath(); ctx.arc(X, Y - 5, 6.5, 0, 6.2832); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1D4ED8'; ctx.stroke();
      }
      // pins first
      const sp = [PX(D.nx[st8.start], D.ny[st8.start]), PY(D.nx[st8.start], D.ny[st8.start], lift)];
      const ep = [PX(D.nx[st8.end], D.ny[st8.end]), PY(D.nx[st8.end], D.ny[st8.end], lift)];
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 8, 0, 6.2832); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#15181D'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ep[0], ep[1]); ctx.lineTo(ep[0], ep[1] - 34); ctx.lineWidth = 2.4; ctx.strokeStyle = '#15181D'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ep[0], ep[1] - 34); ctx.lineTo(ep[0] + 18, ep[1] - 27); ctx.lineTo(ep[0], ep[1] - 20); ctx.closePath(); ctx.fillStyle = '#15181D'; ctx.fill();
      // Then the pins' names, landmarks and streets, in that order. A label
      // that would overlap a pin, a label already placed or a control floating
      // over the map is left out (see ../shared/labels.js).
      const F_PIN = '650 13px Geist, -apple-system, system-ui, sans-serif', F_PL = '650 12.5px Geist, -apple-system, system-ui, sans-serif', F_ST = '500 11px Geist, -apple-system, system-ui, sans-serif';
      const ATTR = 'Map data © OpenStreetMap contributors';
      const tw = (txt, font) => { const key = font + txt; if (!this.widths.has(key)) { ctx.font = font; this.widths.set(key, ctx.measureText(txt).width); } return this.widths.get(key); };
      const box = (x, y, txt, font, h) => MapLabels.around(x, y, tw(txt, font), h);
      const blockers = [
        { x: sp[0] - 10, y: sp[1] - 10, w: 20, h: 20 },
        { x: ep[0] - 3, y: ep[1] - 36, w: 22, h: 38 },
        { x: W - 14 - tw(ATTR, F_ST), y: H - 22, w: tw(ATTR, F_ST) + 8, h: 18 },
        ...MapLabels.controlBoxes(this.view.canvas, document.querySelectorAll('.overlay-top button, .overlay-zoom button')),
      ];
      const items = [
        { txt: 'Start', font: F_PIN, color: '#15181D', candidates: [box(sp[0] + 13 + tw('Start', F_PIN) / 2, sp[1], 'Start', F_PIN, 15), box(sp[0] - 13 - tw('Start', F_PIN) / 2, sp[1], 'Start', F_PIN, 15)] },
        { txt: 'Flag', font: F_PIN, color: '#15181D', candidates: [box(ep[0] + 22 + tw('Flag', F_PIN) / 2, ep[1] - 26, 'Flag', F_PIN, 15), box(ep[0] - 6 - tw('Flag', F_PIN) / 2, ep[1] - 26, 'Flag', F_PIN, 15)] },
      ];
      const onScreen = (X, Y) => X > -40 && X < W + 40 && Y > -20 && Y < H + 20;
      D.pl.forEach(([nm, x, y]) => {
        const X = PX(x / 2, y / 2), Y = PY(x / 2, y / 2, nm === 'Adelaide Oval' ? 40 : 6);
        if (onScreen(X, Y)) items.push({ txt: nm, font: F_PL, color: nm === 'River Torrens' ? '#245E7E' : '#15181D', candidates: [box(X, Y, nm, F_PL, 15), box(X, Y - 17, nm, F_PL, 15), box(X, Y + 17, nm, F_PL, 15)] });
      });
      if (k > 0.33) D.st.forEach(([nm, x, y]) => {
        const X = PX(x / 2, y / 2), Y = PY(x / 2, y / 2, 0);
        if (onScreen(X, Y)) items.push({ txt: nm, font: F_ST, color: '#5B6470', candidates: [box(X, Y, nm, F_ST, 13)] });
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 4;
      for (const { item, box: b } of MapLabels.place(items, blockers, { x: 0, y: 0, w: W, h: H })) {
        const X = b.x + b.w / 2, Y = b.y + b.h / 2;
        ctx.font = item.font; ctx.strokeStyle = item.font === F_ST ? 'rgba(255,255,255,0.9)' : 'rgba(246,247,243,0.95)'; ctx.strokeText(item.txt, X, Y);
        ctx.fillStyle = item.color; ctx.fillText(item.txt, X, Y);
      }
      ctx.textAlign = 'right'; ctx.font = '500 11px Geist, -apple-system, system-ui, sans-serif'; ctx.fillStyle = 'rgba(21,24,29,0.6)';
      ctx.fillText(ATTR, W - 10, H - 12);
    }
    // A click on the map (X, Y in canvas pixels) moves a pin to the nearest junction.
    pick(X, Y) {
      const D = this.D;
      let best = -1, bd = 26 * 26;
      for (let i = 0; i < D.N; i++) {
        const p = this.view.P(D.nx[i], D.ny[i], 1.5);
        const d = (p[0] - X) ** 2 + (p[1] - Y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) { this.setState({ note: 'No street there. Click closer to a road or path.' }); return; }
      this.movePin(best);
    }
  }

  fetch('data/adelaide_cbd.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((raw) => { $('loading').remove(); window.app = new MapApp(raw); })
    .catch(() => { $('loading').textContent = 'Could not load the map data. Serve the docs folder over HTTP (python -m http.server) rather than opening the file directly.'; });
})();
