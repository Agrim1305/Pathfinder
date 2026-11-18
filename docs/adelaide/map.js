/*
 * Adelaide CBD map: canvas renderer (2D and 3D share one camera), input, and
 * the page controls. Search logic lives in graph.js.
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
      this.state = { mode3d: true, aExp: true, dOnly: false, bfs: true, best: true, start: D.sp, end: D.ep, place: 'start', note: '' };
      this.cam = { th: -0.38, tilt: 0.92, k: 0.5, cx: 0, cy: 0 };
      this.tween = null; this.spin = 0; this.raf = 0; this.t0 = 0;
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.res = AdelaideGraph.solve(D, D.sp, D.ep);
      this.canvas = $('cv');
      this.bindControls();
      this.attach();
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
      document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.layer; this.setState({ [k]: !this.state[k] }, () => this.kick()); }));
      $('go2d').addEventListener('click', () => { if (this.state.mode3d) { this.setState({ mode3d: false }); this.spin = 0; this.tweenTo({ tilt: 0, th: 0 }); } });
      $('go3d').addEventListener('click', () => { if (!this.state.mode3d) { this.setState({ mode3d: true }); this.tweenTo({ tilt: 0.92, th: this.cam.th === 0 ? -0.38 : this.cam.th }); } });
      $('replay').addEventListener('click', () => this.restart());
      $('zin').addEventListener('click', () => this.zoomAt(this.W / 2, this.H / 2, 1.3));
      $('zout').addEventListener('click', () => this.zoomAt(this.W / 2, this.H / 2, 1 / 1.3));
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
      $('go3d').setAttribute('aria-pressed', String(s.mode3d)); $('go2d').setAttribute('aria-pressed', String(!s.mode3d));
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
    attach() {
      const c = this.canvas;
      this.ctx = c.getContext('2d');
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(c.parentElement);
      this.resize();
      this.fit(true);
      this.onDown = (e) => this.down(e);
      this.onMove = (e) => this.move(e);
      this.onUp = (e) => this.up(e);
      this.onWheel = (e) => this.wheel(e);
      this.onKey = (e) => this.key(e);
      c.addEventListener('pointerdown', this.onDown);
      c.addEventListener('pointermove', this.onMove);
      c.addEventListener('pointerup', this.onUp);
      c.addEventListener('pointercancel', this.onUp);
      c.addEventListener('wheel', this.onWheel, { passive: false });
      c.addEventListener('keydown', this.onKey);
      this.restart();
    }
    detach() {
      const c = this.canvas;
      if (!c) return;
      cancelAnimationFrame(this.raf); this.raf = 0;
      if (this.ro) this.ro.disconnect();
      c.removeEventListener('pointerdown', this.onDown);
      c.removeEventListener('pointermove', this.onMove);
      c.removeEventListener('pointerup', this.onUp);
      c.removeEventListener('pointercancel', this.onUp);
      c.removeEventListener('wheel', this.onWheel);
      c.removeEventListener('keydown', this.onKey);
    }
    resize() {
      const c = this.canvas; if (!c) return;
      const w = c.parentElement.clientWidth, h = Math.round(Math.min(Math.max(w * 0.66, 420), 760));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.height = h + 'px';
      this.W = w; this.H = h; this.dpr = dpr;
      this.kick();
    }
    fitView(th, tilt) {
      const D = this.D, R = this.res, pts = [];
      [R.al, R.bl].forEach((ln) => { if (ln) for (let i = 0; i < ln.pts.length; i += 2) pts.push(ln.pts[i], ln.pts[i + 1]); });
      [this.state.start, this.state.end].forEach((v) => pts.push(D.nx[v], D.ny[v]));
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, c = Math.cos(th), s = Math.sin(th), ct = Math.cos(tilt);
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (let i = 0; i < pts.length; i += 2) {
        const dx = pts[i] - cx, dy = pts[i + 1] - cy, a = dx * c - dy * s, b = (dx * s + dy * c) * ct;
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      }
      const k = Math.max(0.2, Math.min(2.2, Math.min((this.W * 0.78) / Math.max(a1 - a0, 50), (this.H * 0.7) / Math.max(b1 - b0, 50))));
      // shift so the projected box is centred, nudged down to leave room for flag labels
      const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2 - 18 / k;
      const yr = mb / Math.max(ct, 0.05);
      return { th, tilt, k, cx: cx + ma * c + yr * s, cy: cy - ma * s + yr * c };
    }
    fit(instant) {
      const to = this.fitView(this.state.mode3d ? -0.38 : 0, this.state.mode3d ? 0.92 : 0);
      if (instant) { Object.assign(this.cam, to); this.kick(); } else this.tweenTo(to);
    }
    restart() { this.t0 = performance.now(); this.kick(); }
    kick() { if (!this.raf && this.ctx) this.raf = requestAnimationFrame((t) => this.frame(t)); }
    frame(now) {
      this.raf = 0;
      let busy = false;
      if (this.tween) {
        const tw = this.tween, p = Math.min(1, (now - tw.t) / tw.d), e = 1 - Math.pow(1 - p, 3);
        for (const k in tw.to) this.cam[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        if (p >= 1) this.tween = null; else busy = true;
      }
      if (Math.abs(this.spin) > 0.0004 && !this.drag) { this.cam.th += this.spin; this.spin *= 0.92; busy = true; } else if (!this.drag) this.spin = 0;
      const el = this.reduce ? 1e9 : now - this.t0;
      this.draw(el);
      if (busy || el < this.timeline().end + 50) this.kick();
    }
    kick() { if (!this.raf && this.ctx) this.raf = requestAnimationFrame((t) => this.frame(t)); }
    frame(now) {
      this.raf = 0;
      let busy = false;
      if (this.tween) {
        const tw = this.tween, p = Math.min(1, (now - tw.t) / tw.d), e = 1 - Math.pow(1 - p, 3);
        for (const k in tw.to) this.cam[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        if (p >= 1) this.tween = null; else busy = true;
      }
      if (Math.abs(this.spin) > 0.0004 && !this.drag) { this.cam.th += this.spin; this.spin *= 0.92; busy = true; } else if (!this.drag) this.spin = 0;
      const el = this.reduce ? 1e9 : now - this.t0;
      this.draw(el);
      if (busy || el < this.timeline().end + 50) this.kick();
    }
    frame(now) {
      this.raf = 0;
      let busy = false;
      if (this.tween) {
        const tw = this.tween, p = Math.min(1, (now - tw.t) / tw.d), e = 1 - Math.pow(1 - p, 3);
        for (const k in tw.to) this.cam[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        if (p >= 1) this.tween = null; else busy = true;
      }
      if (Math.abs(this.spin) > 0.0004 && !this.drag) { this.cam.th += this.spin; this.spin *= 0.92; busy = true; } else if (!this.drag) this.spin = 0;
      const el = this.reduce ? 1e9 : now - this.t0;
      this.draw(el);
      if (busy || el < this.timeline().end + 50) this.kick();
    }
    timeline() {
      const n = this.res.A.order.length, step = Math.min(14, 1800 / Math.max(n, 1));
      const reveal = n * step;
      return { step, reveal, drawEnd: reveal + 1300, end: reveal + 1300 + 2800 };
    }
    P(x, y, z) {
      const m = this.cam, c = Math.cos(m.th), s = Math.sin(m.th);
      const dx = x - m.cx, dy = y - m.cy;
      return [this.W / 2 + (dx * c - dy * s) * m.k, this.H / 2 + ((dx * s + dy * c) * Math.cos(m.tilt) - z * Math.sin(m.tilt)) * m.k];
    }
    unP(X, Y) {
      const m = this.cam, c = Math.cos(m.th), s = Math.sin(m.th);
      const xr = (X - this.W / 2) / m.k, yr = (Y - this.H / 2) / (m.k * Math.max(Math.cos(m.tilt), 0.05));
      return [m.cx + xr * c + yr * s, m.cy - xr * s + yr * c];
    }
    draw(el) {
      const ctx = this.ctx, D = this.D, m = this.cam, W = this.W, H = this.H;
      if (!ctx) return;
      const night = false;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
      // labels
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = (txt, x, y, z, font, color, halo) => {
        const X = PX(x, y), Y = PY(x, y, z);
        if (X < -40 || X > W + 40 || Y < -20 || Y > H + 20) return;
        ctx.font = font; ctx.lineWidth = 4; ctx.strokeStyle = halo; ctx.lineJoin = 'round'; ctx.strokeText(txt, X, Y); ctx.fillStyle = color; ctx.fillText(txt, X, Y);
      };
      if (k > 0.33) D.st.forEach(([nm, x, y]) => label(nm, x / 2, y / 2, 0, '500 11px Geist, -apple-system, system-ui, sans-serif', '#5B6470', 'rgba(255,255,255,0.9)'));
      D.pl.forEach(([nm, x, y]) => label(nm, x / 2, y / 2, nm === 'Adelaide Oval' ? 40 : 6, '650 12.5px Geist, -apple-system, system-ui, sans-serif', nm === 'River Torrens' ? '#245E7E' : '#15181D', 'rgba(246,247,243,0.95)'));
      // pins
      const pin = (v, kind) => {
        const X = PX(D.nx[v], D.ny[v]), Y = PY(D.nx[v], D.ny[v], lift);
        ctx.textAlign = 'left'; ctx.font = '650 13px Geist, -apple-system, system-ui, sans-serif';
        if (kind === 'start') {
          ctx.beginPath(); ctx.arc(X, Y, 8, 0, 6.2832); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#15181D'; ctx.stroke();
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(246,247,243,0.95)'; ctx.strokeText('Start', X + 13, Y); ctx.fillStyle = '#15181D'; ctx.fillText('Start', X + 13, Y);
        } else {
          ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, Y - 34); ctx.lineWidth = 2.4; ctx.strokeStyle = '#15181D'; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X, Y - 34); ctx.lineTo(X + 18, Y - 27); ctx.lineTo(X, Y - 20); ctx.closePath(); ctx.fillStyle = '#15181D'; ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(246,247,243,0.95)'; ctx.strokeText('Flag', X + 22, Y - 26); ctx.fillStyle = '#15181D'; ctx.fillText('Flag', X + 22, Y - 26);
        }
      };
      pin(st8.start, 'start'); pin(st8.end, 'end');
      ctx.textAlign = 'right'; ctx.font = '500 11px Geist, -apple-system, system-ui, sans-serif'; ctx.fillStyle = 'rgba(21,24,29,0.6)';
      ctx.fillText('Map data © OpenStreetMap contributors', W - 10, H - 12);
    }
    down(e) {
      this.canvas.setPointerCapture(e.pointerId);
      this.tween = null; this.spin = 0;
      this.drag = { x: e.clientX, y: e.clientY, lx: e.clientX, moved: false, pan: !this.state.mode3d || e.shiftKey || e.button === 2 };
    }
    move(e) {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.lx, dy = e.clientY - (d.ly ?? d.y);
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
      if (!d.moved) return;
      const m = this.cam;
      if (d.pan) {
        const c = Math.cos(m.th), s = Math.sin(m.th), ct = Math.max(Math.cos(m.tilt), 0.05);
        const xr = dx / m.k, yr = dy / (m.k * ct);
        m.cx -= xr * c + yr * s; m.cy -= -xr * s + yr * c;
      } else {
        m.th += dx * 0.006; this.spin = dx * 0.006;
        m.tilt = Math.max(0.3, Math.min(1.15, m.tilt - dy * 0.005));
      }
      d.lx = e.clientX; d.ly = e.clientY;
      this.kick();
    }
    up(e) {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (!d.moved) { this.pick(e); return; }
      if (this.reduce) this.spin = 0;
      this.kick();
    }
    pick(e) {
      const r = this.canvas.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top, D = this.D;
      let best = -1, bd = 26 * 26;
      for (let i = 0; i < D.N; i++) {
        const p = this.P(D.nx[i], D.ny[i], 1.5);
        const d = (p[0] - X) ** 2 + (p[1] - Y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) { this.setState({ note: 'No street there. Click closer to a road or path.' }); return; }
      this.movePin(best);
    }
    wheel(e) {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
      this.zoomAt(X, Y, Math.exp(-e.deltaY * 0.0015));
    }
    zoomAt(X, Y, f) {
      const m = this.cam;
      const [wx, wy] = this.unP(X, Y);
      m.k = Math.max(0.18, Math.min(4, m.k * f));
      const [nx, ny] = this.unP(X, Y);
      m.cx += wx - nx; m.cy += wy - ny;
      this.kick();
    }
    key(e) {
      const m = this.cam, step = 60 / m.k;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        const c = Math.cos(m.th), s = Math.sin(m.th), [a, b] = map[e.key];
        m.cx += a * c + b * s; m.cy += -a * s + b * c; this.kick();
      } else if (e.key === '+' || e.key === '=') { this.zoomAt(this.W / 2, this.H / 2, 1.25); }
      else if (e.key === '-') { this.zoomAt(this.W / 2, this.H / 2, 0.8); }
    }
    tweenTo(to) {
      if (this.reduce) { Object.assign(this.cam, to); this.kick(); return; }
      const from = {}; for (const k in to) from[k] = this.cam[k];
      this.tween = { from, to, t: performance.now(), d: 650 }; this.kick();
    }
  }

  fetch('data/adelaide_cbd.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((raw) => { $('loading').remove(); window.app = new MapApp(raw); })
    .catch(() => { $('loading').textContent = 'Could not load the map data. Serve the docs folder over HTTP (python -m http.server) rather than opening the file directly.'; });
})();
