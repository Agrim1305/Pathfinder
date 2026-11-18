/*
 * Shared camera and input for the canvas maps (the Adelaide page and the
 * grid's 2D and 3D views), so they all move the same way, with the usual
 * map conventions:
 *
 *   drag (mouse or one finger)        moves the map; the ground point you
 *                                     grabbed stays under the pointer
 *   right-drag, or Ctrl or Cmd + drag turns (sideways) and tilts (up and
 *                                     down), in 3D
 *   two fingers                       pinch to zoom, twist to turn, move
 *                                     both up or down together to tilt
 *   wheel, trackpad pinch             zoom around the pointer (Safari's
 *                                     trackpad rotate turns the map)
 *   arrow keys                        move; Shift + left or right turns,
 *                                     Shift + up or down tilts; + and - zoom
 *
 * After a drag the map glides on: the release speed is projected forward as
 * if it slowed by 0.998 each millisecond, like a scrolled list, and the map
 * eases to that spot, starting at the release speed. Not under reduced
 * motion. A press that moves under 4 px is a click.
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
 * and optionally:
 *   grab(X, Y, e)  return { move(X, Y), up(X, Y) } to take over a press
 *                  (dragging a pin, painting cells) instead of moving the map
 *   keyStep        how far arrow keys slide the map, in world units
 *   cam, mode3d, pose3d, kRange, tiltRange and fit
 * and can hand bindButtons() an element holding buttons with data-act
 * "in", "out", "left", "right", "tilt" and "north" (a compass).
 */
(function (root) {
  "use strict";

  const TWEEN_MS = 650; // ease-out cubic, for 2D/3D switches and fits
  const BUTTON_MS = 300; // the turn, tilt and compass buttons
  const CLICK_PX = 4; // a press that moves less than this is a click
  const TURN_PER_PX = 0.006, TILT_PER_PX = 0.005; // turning and tilting drags
  const KEY_TURN = 0.1, BUTTON_TURN = Math.PI / 12; // radians
  // Glide: velocity in px/ms times DECAY / (1 - DECAY) is how far it carries.
  // An ease-out cubic over 3 * GLIDE ms starts at the release speed and lands
  // there. Speed is capped so a hard flick carries about a canvas width at
  // most, and a turn at most 60 degrees.
  const DECAY = 0.998, GLIDE = DECAY / (1 - DECAY), MIN_SPEED = 0.02, MAX_SPEED = 2, MAX_TURN = Math.PI / 3;
  // How fit() frames points: share of the canvas to fill, smallest span in
  // world units, zoom limits, and a downward nudge in pixels for flag labels.
  const FIT = { fill: [0.78, 0.7], minSpan: 50, kRange: [0.2, 2.2], nudge: 18 };

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)); // to -pi..pi

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
      this.raf = 0;
      this.drag = null;
      this.pinch = null;
      this.gesture = null; // Safari's trackpad gesture
      this.buttons = null;
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
      on("contextmenu", (e) => e.preventDefault()); // right-drag turns the map
      on("gesturestart", (e) => this.gestureStart(e));
      on("gesturechange", (e) => this.gestureChange(e));
      on("gestureend", (e) => (e.preventDefault(), (this.gesture = null)));
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
      let busy = this.step(now);
      this.syncButtons();
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.opts.draw(now) || busy) this.kick();
    }

    // Advance a tween or a glide; true while it is still running.
    step(now) {
      const tw = this.tween;
      if (!tw) return false;
      const p = Math.min(1, Math.max(0, now - tw.t) / tw.d), e = 1 - Math.pow(1 - p, 3), done = p >= 1;
      for (const k in tw.to) this.cam[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (done) this.tween = null;
      return !done;
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

    // The camera centre that puts ground point g under canvas pixel (X, Y),
    // keeping the current turn, tilt and zoom. The exact inverse of unP().
    centreFor(g, X, Y) {
      const m = this.cam, c = Math.cos(m.th), s = Math.sin(m.th);
      const xr = (X - this.W / 2) / m.k, yr = (Y - this.H / 2) / (m.k * Math.max(Math.cos(m.tilt), 0.05));
      return { cx: g[0] - (xr * c + yr * s), cy: g[1] + xr * s - yr * c };
    }
    hold(g, X, Y) {
      Object.assign(this.cam, this.centreFor(g, X, Y));
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
      else this.tweenTo({ tilt: 0, th: 0 });
    }

    tweenTo(to, ms = TWEEN_MS) {
      if (this.reduce) {
        Object.assign(this.cam, to);
        this.kick();
        return;
      }
      const from = {};
      for (const k in to) from[k] = this.cam[k];
      this.tween = { from, to, t: performance.now(), d: ms };
      this.kick();
    }

    // Tilt within the limits, without jumping if a button left it outside them.
    clampTilt(t) {
      const [lo, hi] = this.tiltRange;
      return Math.max(Math.min(lo, this.cam.tilt), Math.min(hi, t));
    }
    clampK(k) {
      return Math.max(this.kRange[0], Math.min(this.kRange[1], k));
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
      const g = this.unP(X, Y);
      this.cam.k = this.clampK(this.cam.k * f);
      this.hold(g, X, Y);
      this.kick();
    }

    local(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    // ---------- pointers: one moves or turns, two pinch, twist or tilt ----------
    twoFingers() {
      const [a, b] = [...this.ptrs.values()];
      return {
        x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2,
        d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
        a: Math.atan2(b[1] - a[1], b[0] - a[0]),
        p: [a.slice(), b.slice()],
      };
    }

    down(e) {
      if (this.grabbed) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.tween = null; // a press stops any glide
      const turn = e.button === 2 || e.ctrlKey || e.metaKey;
      if (!this.ptrs.size && this.opts.grab && !turn) {
        const g = this.opts.grab(...this.local(e), e);
        if (g) {
          this.grabbed = Object.assign(g, { id: e.pointerId });
          return;
        }
      }
      this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.ptrs.size === 2) {
        // a second finger turns the drag into a pinch, twist or tilt
        this.drag = null;
        const p = this.twoFingers();
        this.pinch = Object.assign(p, { start: p, mode: null });
        return;
      }
      if (this.ptrs.size > 2) return;
      const [X, Y] = this.local(e);
      this.drag = {
        x: e.clientX, y: e.clientY, lx: X, ly: Y, moved: false,
        turn: turn && this.mode3d, // in 2D the map stays north up, so every drag moves it
        ground: this.unP(X, Y), // the ground point to keep under the pointer
        trail: [[performance.now(), X, Y]],
      };
    }

    move(e) {
      if (this.grabbed) {
        if (e.pointerId === this.grabbed.id) this.grabbed.move(...this.local(e));
        return;
      }
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pinch) return this.pinchMove();
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) d.moved = true;
      if (!d.moved) return;
      const [X, Y] = this.local(e), m = this.cam;
      if (d.turn) {
        m.th += (X - d.lx) * TURN_PER_PX;
        m.tilt = this.clampTilt(m.tilt - (Y - d.ly) * TILT_PER_PX);
      } else this.hold(d.ground, X, Y);
      d.lx = X;
      d.ly = Y;
      const now = performance.now();
      d.trail.push([now, X, Y]);
      while (d.trail.length > 2 && now - d.trail[0][0] > 100) d.trail.shift();
      this.kick();
    }

    // Two fingers: if they first move up or down together (in 3D), tilt for
    // the rest of the gesture; otherwise pinch to zoom, twist to turn, and
    // move the map with them, around their midpoint.
    pinchMove() {
      const q = this.pinch, p = this.twoFingers(), m = this.cam, r = this.canvas.getBoundingClientRect();
      if (!q.mode) {
        const s = q.start, a = [p.p[0][0] - s.p[0][0], p.p[0][1] - s.p[0][1]], b = [p.p[1][0] - s.p[1][0], p.p[1][1] - s.p[1][1]];
        // Touch events arrive one finger at a time, so wait until both fingers
        // have moved a little (or one has clearly moved alone) before deciding.
        const ma = Math.hypot(...a), mb = Math.hypot(...b);
        if (Math.max(ma, mb) < 8 || (Math.min(ma, mb) < 4 && Math.max(ma, mb) < 24)) return;
        const upDown = (v) => Math.abs(v[1]) > 2 * Math.abs(v[0]);
        const together = Math.sign(a[1]) === Math.sign(b[1]) && Math.abs(p.d - s.d) < 0.5 * Math.min(Math.abs(a[1]), Math.abs(b[1])) + 4;
        q.mode = this.mode3d && upDown(a) && upDown(b) && together ? "tilt" : "pinch";
      }
      if (q.mode === "tilt") m.tilt = this.clampTilt(m.tilt - (p.y - q.y) * TILT_PER_PX);
      else {
        const g = this.unP(q.x - r.left, q.y - r.top);
        m.k = this.clampK((m.k * p.d) / q.d);
        if (this.mode3d) m.th += wrap(p.a - q.a);
        this.hold(g, p.x - r.left, p.y - r.top);
      }
      Object.assign(q, { x: p.x, y: p.y, d: p.d, a: p.a, p: p.p });
      this.kick();
    }

    up(e) {
      const g = this.grabbed;
      if (g) {
        if (e.pointerId !== g.id) return;
        this.grabbed = null;
        g.up(...this.local(e));
        return;
      }
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
        this.opts.pick(...this.local(e));
        return;
      }
      this.glide(d);
      this.kick();
    }

    // Carry on after a release: project the release speed forward and ease there.
    glide(d) {
      if (this.reduce) return;
      const now = performance.now(), last = d.trail[d.trail.length - 1], first = d.trail[0];
      const dt = last[0] - first[0];
      if (dt < 8 || now - last[0] > 60) return; // too few samples, or the pointer had stopped
      let vx = (last[1] - first[1]) / dt, vy = (last[2] - first[2]) / dt;
      const speed = Math.hypot(vx, vy);
      if (speed < MIN_SPEED) return;
      if (speed > MAX_SPEED) (vx *= MAX_SPEED / speed), (vy *= MAX_SPEED / speed);
      const turnBy = Math.max(-MAX_TURN, Math.min(MAX_TURN, vx * GLIDE * TURN_PER_PX));
      const from = {}, to = d.turn ? { th: this.cam.th + turnBy } : this.centreFor(d.ground, last[1] + vx * GLIDE, last[2] + vy * GLIDE);
      for (const k in to) from[k] = this.cam[k];
      this.tween = { from, to, t: now, d: 3 * GLIDE };
    }

    wheel(e) {
      e.preventDefault();
      if (this.gesture) return; // Safari's gesture events handle the trackpad pinch
      this.tween = null;
      this.zoomAt(...this.local(e), Math.exp(-e.deltaY * 0.0015));
    }

    // Safari's trackpad pinch and rotate. iOS sends these for two-finger
    // touches too, but there the pointer events already handle it.
    gestureStart(e) {
      e.preventDefault();
      this.gesture = this.ptrs.size ? null : { scale: 1, rotation: 0 };
    }
    gestureChange(e) {
      e.preventDefault();
      const g = this.gesture;
      if (!g) return;
      const [X, Y] = this.local(e), ground = this.unP(X, Y);
      this.cam.k = this.clampK((this.cam.k * e.scale) / g.scale);
      if (this.mode3d) this.cam.th += ((e.rotation - g.rotation) * Math.PI) / 180;
      this.hold(ground, X, Y);
      g.scale = e.scale;
      g.rotation = e.rotation;
      this.kick();
    }

    // Arrow keys move the map; with Shift, left and right turn it and up and down tilt it.
    key(e) {
      const m = this.cam, step = this.opts.keyStep || 60 / m.k;
      if (e.shiftKey && this.mode3d && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        this.tween = null;
        if (e.key === "ArrowLeft") m.th -= KEY_TURN;
        else if (e.key === "ArrowRight") m.th += KEY_TURN;
        else m.tilt = this.clampTilt(m.tilt + (e.key === "ArrowUp" ? KEY_TURN : -KEY_TURN));
        this.kick();
        return;
      }
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

    // ---------- on-screen buttons ----------
    turn(by) {
      this.tweenTo({ th: this.cam.th + by }, BUTTON_MS);
    }
    toggleTilt() {
      this.tweenTo({ tilt: this.cam.tilt > 0.05 ? 0 : this.pose3d.tilt }, BUTTON_MS);
    }
    northUp() {
      this.tweenTo({ th: this.cam.th - wrap(this.cam.th) }, BUTTON_MS);
    }
    bindButtons(box) {
      this.buttons = box;
      const acts = {
        in: () => this.zoomAt(this.W / 2, this.H / 2, 1.3),
        out: () => this.zoomAt(this.W / 2, this.H / 2, 1 / 1.3),
        left: () => this.turn(-BUTTON_TURN),
        right: () => this.turn(BUTTON_TURN),
        tilt: () => this.toggleTilt(),
        north: () => this.northUp(),
      };
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]");
        if (b && acts[b.dataset.act]) acts[b.dataset.act]();
      });
      this.syncButtons();
    }
    // Turning and tilting are 3D only; the compass needle shows the heading.
    syncButtons() {
      const box = this.buttons;
      if (!box) return;
      const heading = Math.round((((wrap(this.cam.th) * 180) / Math.PI) + 360) % 360);
      if (heading === this.shownHeading && this.mode3d === this.shownMode && (this.cam.tilt > 0.05) === this.shownTilt) return;
      this.shownHeading = heading;
      this.shownMode = this.mode3d;
      this.shownTilt = this.cam.tilt > 0.05;
      for (const b of box.querySelectorAll('[data-act="left"], [data-act="right"], [data-act="tilt"]')) b.hidden = !this.mode3d;
      const tilt = box.querySelector('[data-act="tilt"]');
      if (tilt) tilt.setAttribute("aria-pressed", String(this.shownTilt));
      const north = box.querySelector('[data-act="north"]');
      if (north) {
        north.style.setProperty("--heading", `${this.cam.th}rad`);
        north.title = heading ? `Heading ${heading} degrees. Press for north up.` : "North is up";
      }
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = MapView;
  else root.MapView = MapView;
})(typeof window !== "undefined" ? window : globalThis);
