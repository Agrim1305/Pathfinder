/*
 * Shared camera and input for the canvas maps: the Adelaide page now, and the
 * grid's 2D and 3D views later, so they all move the same way.
 *
 * Plain script, no build step. In the browser it sets window.MapView; in Node
 * it is a CommonJS module, so tests/test_view.js can check the maths.
 *
 * The camera is { th, tilt, k, cx, cy }. th turns the map, tilt leans it back
 * (0 is flat with north up), k is pixels per world unit, and (cx, cy) is the
 * world point at the centre of the canvas. P() projects a world point to
 * canvas pixels; unP() takes a canvas pixel back to the ground (z = 0).
 *
 * The page passes:
 *   height(w)   canvas height in CSS pixels for a given width
 *   draw(now)   draws one frame (the HiDPI transform is already set) and
 *               returns true if it needs another frame
 *   pick(X, Y)  a click that wasn't a drag, in canvas pixels
 * and optionally cam, mode3d, pose3d, kRange, tiltRange and fit.
 */
(function (root) {
  "use strict";

  const TWEEN_MS = 650; // ease-out cubic, for 2D/3D switches and fits
  // How fit() frames points: share of the canvas to fill, smallest span in
  // world units, zoom limits, and a downward nudge in pixels for flag labels.
  const FIT = { fill: [0.78, 0.7], minSpan: 50, kRange: [0.2, 2.2], nudge: 18 };

  class MapView {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.opts = opts;
      this.cam = Object.assign({ th: 0, tilt: 0, k: 1, cx: 0, cy: 0 }, opts.cam);
      this.mode3d = !!opts.mode3d;
      this.pose3d = opts.pose3d || { th: -0.38, tilt: 0.92 };
      this.kRange = opts.kRange || [0.18, 4];
      this.tiltRange = opts.tiltRange || [0.3, 1.15];
      this.fitOpts = Object.assign({}, FIT, opts.fit);
      this.reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.tween = null;
      this.spin = 0; // rotation momentum after a drag, radians per frame
      this.raf = 0;
      this.drag = null;
      this.pinch = null;
      this.ptrs = new Map(); // pointerId -> [clientX, clientY] while it is down
      this.ctx = canvas.getContext("2d");
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.resize();
      const on = (type, fn, o) => canvas.addEventListener(type, fn, o);
      on("pointerdown", (e) => this.down(e));
      on("pointermove", (e) => this.move(e));
      on("pointerup", (e) => this.up(e));
      on("pointercancel", (e) => this.up(e));
      on("wheel", (e) => this.wheel(e), { passive: false });
      on("keydown", (e) => this.key(e));
    }

    // Fill the container's width at up to 2x pixel density.
    resize() {
      const c = this.canvas, w = c.parentElement.clientWidth, h = this.opts.height(w);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = h + "px";
      this.W = w;
      this.H = h;
      this.dpr = dpr;
      this.kick();
    }

    // The animation loop only runs while something is moving.
    kick() {
      if (!this.raf && this.ctx) this.raf = requestAnimationFrame((t) => this.frame(t));
    }

    frame(now) {
      this.raf = 0;
      let busy = false;
      const tw = this.tween;
      if (tw) {
        const p = Math.min(1, (now - tw.t) / tw.d), e = 1 - Math.pow(1 - p, 3);
        for (const k in tw.to) this.cam[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        if (p >= 1) this.tween = null;
        else busy = true;
      }
      if (Math.abs(this.spin) > 0.0004 && !this.drag) {
        this.cam.th += this.spin;
        this.spin *= 0.92;
        busy = true;
      } else if (!this.drag) this.spin = 0;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.opts.draw(now) || busy) this.kick();
    }

    P(x, y, z) {
      const m = this.cam, c = Math.cos(m.th), s = Math.sin(m.th);
      const dx = x - m.cx, dy = y - m.cy;
      return [
        this.W / 2 + (dx * c - dy * s) * m.k,
        this.H / 2 + ((dx * s + dy * c) * Math.cos(m.tilt) - z * Math.sin(m.tilt)) * m.k,
      ];
    }

    unP(X, Y) {
      const m = this.cam, c = Math.cos(m.th), s = Math.sin(m.th);
      const xr = (X - this.W / 2) / m.k, yr = (Y - this.H / 2) / (m.k * Math.max(Math.cos(m.tilt), 0.05));
      return [m.cx + xr * c + yr * s, m.cy - xr * s + yr * c];
    }

    // The camera that frames these points ([x0, y0, x1, y1, ...]) at a given turn and tilt.
    framing(pts, th, tilt) {
      const f = this.fitOpts;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < pts.length; i += 2) {
        x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
        y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, c = Math.cos(th), s = Math.sin(th), ct = Math.cos(tilt);
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (let i = 0; i < pts.length; i += 2) {
        const dx = pts[i] - cx, dy = pts[i + 1] - cy, a = dx * c - dy * s, b = (dx * s + dy * c) * ct;
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      }
      const fit = Math.min((this.W * f.fill[0]) / Math.max(a1 - a0, f.minSpan), (this.H * f.fill[1]) / Math.max(b1 - b0, f.minSpan));
      const k = Math.max(f.kRange[0], Math.min(f.kRange[1], fit));
      // shift so the projected box is centred, nudged down to leave room for labels
      const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2 - f.nudge / k;
      const yr = mb / Math.max(ct, 0.05);
      return { th, tilt, k, cx: cx + ma * c + yr * s, cy: cy - ma * s + yr * c };
    }

    // Frame the points in the current mode's pose, at once or with a tween.
    fit(pts, instant) {
      const pose = this.mode3d ? this.pose3d : { th: 0, tilt: 0 };
      const to = this.framing(pts, pose.th, pose.tilt);
      if (instant) {
        Object.assign(this.cam, to);
        this.kick();
      } else this.tweenTo(to);
    }

    // 2D is the same camera with no tilt and north up.
    set3d(on) {
      if (on === this.mode3d) return;
      this.mode3d = on;
      if (on) this.tweenTo({ tilt: this.pose3d.tilt, th: this.cam.th === 0 ? this.pose3d.th : this.cam.th });
      else {
        this.spin = 0;
        this.tweenTo({ tilt: 0, th: 0 });
      }
    }

    tweenTo(to) {
      if (this.reduce) {
        Object.assign(this.cam, to);
        this.kick();
        return;
      }
      const from = {};
      for (const k in to) from[k] = this.cam[k];
      this.tween = { from, to, t: performance.now(), d: TWEEN_MS };
      this.kick();
    }

    // Slide the map by a distance in CSS pixels.
    pan(dx, dy) {
      const m = this.cam, c = Math.cos(m.th), s = Math.sin(m.th), ct = Math.max(Math.cos(m.tilt), 0.05);
      const xr = dx / m.k, yr = dy / (m.k * ct);
      m.cx -= xr * c + yr * s;
      m.cy -= -xr * s + yr * c;
    }

    // Zoom by f, keeping the ground point under (X, Y) where it is.
    zoomAt(X, Y, f) {
      const m = this.cam;
      const [wx, wy] = this.unP(X, Y);
      m.k = Math.max(this.kRange[0], Math.min(this.kRange[1], m.k * f));
      const [nx, ny] = this.unP(X, Y);
      m.cx += wx - nx;
      m.cy += wy - ny;
      this.kick();
    }

    twoFingers() {
      const [a, b] = [...this.ptrs.values()];
      return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 };
    }

    down(e) {
      this.canvas.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      this.tween = null;
      this.spin = 0;
      if (this.ptrs.size === 2) {
        // a second finger turns the drag into a pinch
        this.drag = null;
        this.pinch = this.twoFingers();
        return;
      }
      if (this.ptrs.size > 2) return;
      this.drag = {
        x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false,
        pan: !this.mode3d || e.shiftKey || e.button === 2,
      };
    }

    move(e) {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pinch) {
        if (this.ptrs.size !== 2) return;
        const p = this.twoFingers(), r = this.canvas.getBoundingClientRect();
        this.pan(p.x - this.pinch.x, p.y - this.pinch.y);
        this.zoomAt(p.x - r.left, p.y - r.top, p.d / this.pinch.d);
        this.pinch = p;
        return;
      }
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.lx, dy = e.clientY - d.ly;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
      if (!d.moved) return;
      const m = this.cam;
      if (d.pan) this.pan(dx, dy);
      else {
        m.th += dx * 0.006;
        this.spin = dx * 0.006;
        m.tilt = Math.max(this.tiltRange[0], Math.min(this.tiltRange[1], m.tilt - dy * 0.005));
      }
      d.lx = e.clientX;
      d.ly = e.clientY;
      this.kick();
    }

    up(e) {
      this.ptrs.delete(e.pointerId);
      if (this.pinch) {
        // the fingers left after a pinch neither drag nor click
        if (this.ptrs.size < 2) this.pinch = null;
        return;
      }
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (!d.moved) {
        const r = this.canvas.getBoundingClientRect();
        this.opts.pick(e.clientX - r.left, e.clientY - r.top);
        return;
      }
      if (this.reduce) this.spin = 0;
      this.kick();
    }

    wheel(e) {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }

    // Arrow keys slide the map, + and - zoom around the centre.
    key(e) {
      const m = this.cam, step = 60 / m.k;
      const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (dir) {
        e.preventDefault();
        const c = Math.cos(m.th), s = Math.sin(m.th), [a, b] = dir;
        m.cx += a * c + b * s;
        m.cy += -a * s + b * c;
        this.kick();
      } else if (e.key === "+" || e.key === "=") this.zoomAt(this.W / 2, this.H / 2, 1.25);
      else if (e.key === "-") this.zoomAt(this.W / 2, this.H / 2, 0.8);
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = MapView;
  else root.MapView = MapView;
})(typeof window !== "undefined" ? window : globalThis);
