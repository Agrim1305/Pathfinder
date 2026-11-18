// Checks the shared camera in docs/shared/view.js without a browser:
// projection round trips, zoom and pinch keep the point under the fingers
// still, a click picks but a drag doesn't, and fit() keeps points on screen.
// Run from the project root: node tests/test_view.js
const assert = require("assert");

// Just enough of a browser for MapView to construct.
global.window = { devicePixelRatio: 2 };
global.matchMedia = () => ({ matches: true }); // reduced motion: tweens land at once
global.ResizeObserver = class { observe() {} };
global.requestAnimationFrame = () => 1;
const MapView = require("../docs/shared/view.js");

const picks = [];
const canvas = {
  parentElement: { clientWidth: 800 },
  style: {},
  getContext: () => null, // no drawing in this test
  addEventListener() {},
  setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 10, top: 20 }),
};
const view = new MapView(canvas, {
  height: () => 500,
  draw: () => false,
  pick: (X, Y) => picks.push([X, Y]),
  cam: { th: -0.38, tilt: 0.92, k: 0.5, cx: 100, cy: -40 },
  mode3d: true,
});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
let checks = 0;

// P and unP are inverses on the ground, at any turn, tilt and zoom.
for (const cam of [view.cam, { th: 0, tilt: 0, k: 1, cx: 0, cy: 0 }, { th: 2.1, tilt: 1.1, k: 3.7, cx: -500, cy: 260 }]) {
  Object.assign(view.cam, cam);
  for (const [x, y] of [[0, 0], [123.4, -56.7], [-900, 450]]) {
    const [X, Y] = view.P(x, y, 0), [bx, by] = view.unP(X, Y);
    near(bx, x, "unP(P(x)) x");
    near(by, y, "unP(P(y)) y");
    checks++;
  }
}

// Zooming keeps the ground point under the cursor where it is.
Object.assign(view.cam, { th: 0.7, tilt: 0.9, k: 0.8, cx: 30, cy: 60 });
const before = view.unP(200, 150);
view.zoomAt(200, 150, 1.6);
const after = view.unP(200, 150);
near(after[0], before[0], "zoomAt x");
near(after[1], before[1], "zoomAt y");
near(view.cam.k, 1.28, "zoomAt k");
checks++;

// A pinch that spreads two fingers to twice the distance doubles the zoom
// around their midpoint, and lifting the fingers doesn't count as a click.
const ev = (id, x, y, more = {}) => Object.assign({ pointerId: id, clientX: x, clientY: y, button: 0 }, more);
const key = (k, shiftKey = false) => ({ key: k, shiftKey, preventDefault() {} });
const mid = view.unP(310 - 10, 220 - 20); // canvas coordinates of the midpoint
const k0 = view.cam.k;
view.down(ev(1, 290, 220));
view.down(ev(2, 330, 220));
view.move(ev(1, 270, 220));
view.move(ev(2, 350, 220));
view.up(ev(1, 270, 220));
view.move(ev(2, 380, 220)); // the finger left after a pinch doesn't drag
view.up(ev(2, 380, 220));
near(view.cam.k, k0 * 2, "pinch zoom");
const midAfter = view.unP(300, 200);
near(midAfter[0], mid[0], "pinch keeps the midpoint x");
near(midAfter[1], mid[1], "pinch keeps the midpoint y");
assert.deepStrictEqual(picks, [], "a pinch is not a click");
checks++;

// A click picks, in canvas pixels; a press that moves more than 4 px is a drag, not a click.
view.down(ev(3, 110, 120));
view.up(ev(3, 112, 121));
assert.deepStrictEqual(picks, [[102, 101]], "click picks in canvas pixels");
view.down(ev(4, 110, 120));
view.move(ev(4, 140, 120));
view.up(ev(4, 140, 120));
assert.strictEqual(picks.length, 1, "a drag is not a click");
checks++;

// Dragging moves the map: the ground point grabbed on pointerdown stays under
// the pointer to within 0.5 px all the way, flat or tilted, turned or not.
const within = (a, b, msg) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.5, `${msg}: ${a} vs ${b}`);
for (const tilt of [0, 0.5, 1.1]) {
  view.mode3d = tilt > 0;
  Object.assign(view.cam, { th: 0.7, tilt, k: 1.3, cx: 40, cy: -25 });
  const start = [250, 180], grabbed = view.unP(...start);
  view.down(ev(7, start[0] + 10, start[1] + 20)); // client = canvas + (10, 20)
  for (const [x, y] of [[262, 190], [300, 240], [410, 150], [180, 320], [60, 40]]) {
    view.move(ev(7, x + 10, y + 20));
    within(view.P(grabbed[0], grabbed[1], 0), [x, y], `tilt ${tilt}: grabbed point under the pointer at (${x}, ${y})`);
  }
  view.up(ev(7, 70, 60));
  near(view.cam.th, 0.7, `tilt ${tilt}: moving does not turn the map`);
  near(view.cam.tilt, tilt, `tilt ${tilt}: moving does not tilt the map`);
  checks++;
}

// Right-drag, or Ctrl or Cmd and drag, turns (sideways) and tilts (up and down) in 3D.
for (const more of [{ button: 2 }, { ctrlKey: true }, { metaKey: true }]) {
  view.mode3d = true;
  Object.assign(view.cam, { th: 0.2, tilt: 0.8, k: 1, cx: 0, cy: 0 });
  view.down(ev(8, 200, 200, more));
  view.move(ev(8, 260, 180, more));
  view.up(ev(8, 260, 180, more));
  near(view.cam.th, 0.2 + 60 * 0.006, `${Object.keys(more)[0]}: sideways turns`);
  near(view.cam.tilt, 0.8 + 20 * 0.005, `${Object.keys(more)[0]}: up tilts back`);
  near(view.cam.cx, 0, `${Object.keys(more)[0]}: turning does not move the centre`);
  checks++;
}
// In 2D the map stays north up, so a right-drag just moves it.
view.mode3d = false;
Object.assign(view.cam, { th: 0, tilt: 0, k: 1, cx: 0, cy: 0 });
{
  const grabbed = view.unP(190, 180);
  view.down(ev(9, 200, 200, { button: 2 }));
  view.move(ev(9, 260, 230, { button: 2 }));
  within(view.P(grabbed[0], grabbed[1], 0), [250, 210], "2D right-drag moves the map");
  view.up(ev(9, 260, 230, { button: 2 }));
  near(view.cam.th, 0, "2D stays north up");
}
checks++;

// Two fingers twisted 30 degrees about their midpoint turn the map by 30 degrees in 3D,
// and the ground under the midpoint stays put.
view.mode3d = true;
Object.assign(view.cam, { th: 0.1, tilt: 0.7, k: 1, cx: 5, cy: 5 });
{
  const mid = view.unP(250, 180), a = Math.PI / 6, r = 50;
  view.down(ev(11, 200 + 10, 180 + 20));
  view.down(ev(12, 300 + 10, 180 + 20));
  view.move(ev(11, 250 - r * Math.cos(a) + 10, 180 - r * Math.sin(a) + 20));
  view.move(ev(12, 250 + r * Math.cos(a) + 10, 180 + r * Math.sin(a) + 20));
  near(view.cam.th, 0.1 + a, "twist turns the map");
  near(view.cam.k, 1, "a twist at the same spread does not zoom");
  within(view.P(mid[0], mid[1], 0), [250, 180], "twist keeps the ground under the midpoint");
  view.up(ev(11, 0, 0));
  view.up(ev(12, 0, 0));
}
checks++;

// Two fingers moved down together tilt (in small steps, as touch events arrive).
Object.assign(view.cam, { th: 0.1, tilt: 0.7, k: 1, cx: 5, cy: 5 });
{
  view.down(ev(13, 200, 200));
  view.down(ev(14, 300, 200));
  for (const y of [205, 210, 220, 230, 240]) {
    view.move(ev(13, 200, y));
    view.move(ev(14, 300, y));
  }
  view.up(ev(13, 0, 0));
  view.up(ev(14, 0, 0));
  near(view.cam.tilt, 0.7 - 40 * 0.005, "two fingers down tilt the map");
  near(view.cam.k, 1, "tilting does not zoom");
  near(view.cam.th, 0.1, "tilting does not turn");
}
checks++;

// Keys: arrows move; Shift and left or right turns; Shift and up or down tilts.
Object.assign(view.cam, { th: 0.3, tilt: 0.7, k: 2, cx: 0, cy: 0 });
view.key(key("ArrowRight"));
assert.ok(view.cam.cx !== 0 && view.cam.th === 0.3, "an arrow key moves the map");
view.key(key("ArrowRight", true));
near(view.cam.th, 0.4, "Shift and right turns the map");
view.key(key("ArrowUp", true));
near(view.cam.tilt, 0.8, "Shift and up tilts it back");
checks++;

// The compass and the turn and tilt buttons (reduced motion: they land at once).
view.turn(Math.PI / 12);
near(view.cam.th, 0.4 + Math.PI / 12, "Rotate right turns by 15 degrees");
view.cam.th = 2 * Math.PI + 0.3;
view.northUp();
near(Math.cos(view.cam.th), 1, "the compass turns back to north up");
near(view.cam.th, 2 * Math.PI, "the shortest way round");
view.toggleTilt();
near(view.cam.tilt, 0, "Tilt lays the map flat");
view.toggleTilt();
near(view.cam.tilt, view.pose3d.tilt, "and tilts it back");
checks++;

// fit() frames every point inside the canvas, in 3D and in 2D.
const pts = [-300, -200, 400, 50, 120, 380, -50, -10];
for (const on of [true, false]) {
  view.set3d(on);
  view.fit(pts, true);
  for (let i = 0; i < pts.length; i += 2) {
    const [X, Y] = view.P(pts[i], pts[i + 1], 0);
    assert.ok(X >= 0 && X <= view.W && Y >= 0 && Y <= view.H, `fit keeps (${pts[i]}, ${pts[i + 1]}) on screen`);
  }
  if (!on) assert.deepStrictEqual([view.cam.th, view.cam.tilt], [0, 0], "2D is flat and north up");
  checks++;
}

// A page can take over a press (to drag a pin, say): the map stays still and
// the page gets the moves in canvas pixels. Other presses still move the map.
const grabbed = [];
view.opts.grab = (X, Y) => (X < 50 ? { move: (x, y) => grabbed.push(["move", x, y]), up: (x, y) => grabbed.push(["up", x, y]) } : null);
const camBefore = JSON.stringify(view.cam);
view.down(ev(5, 30, 40));
view.move(ev(5, 90, 60));
view.up(ev(5, 95, 60));
assert.deepStrictEqual(grabbed, [["move", 80, 40], ["up", 85, 40]], "grab gets moves in canvas pixels");
assert.strictEqual(JSON.stringify(view.cam), camBefore, "a grabbed press leaves the map alone");
view.down(ev(6, 300, 40));
view.move(ev(6, 340, 40));
view.up(ev(6, 340, 40));
assert.notStrictEqual(JSON.stringify(view.cam), camBefore, "other presses still move the map");
checks++;

// Glide: with motion allowed, a release at 1 px/ms carries on 499 px
// (0.998 / 0.002), easing to that spot; a faster flick is capped at 2 px/ms.
// Reduced motion (the view above) never glides.
{
  let now = 1000;
  const realNow = performance.now;
  performance.now = () => now;
  global.matchMedia = () => ({ matches: false });
  const g2 = new MapView(canvas, { height: () => 500, draw: () => false, pick: () => {}, cam: { th: 0.4, tilt: 0.6, k: 1, cx: 0, cy: 0 }, mode3d: true });
  for (const [speed, carried] of [[1, 499], [5, 998]]) {
    Object.assign(g2.cam, { th: 0.4, tilt: 0.6, k: 1, cx: 0, cy: 0 });
    const grabbed = g2.unP(100, 200);
    g2.down(ev(20, 110, 220));
    for (let i = 1; i <= 8; i++) {
      now += 10;
      g2.move(ev(20, 110 + i * 10 * speed, 220));
    }
    const release = [100 + 80 * speed, 200];
    g2.up(ev(20, release[0] + 10, 220));
    assert.ok(g2.tween, `speed ${speed}: a moving release glides`);
    g2.step(now + 1e6); // jump to the end of the glide
    within(g2.P(grabbed[0], grabbed[1], 0), [release[0] + carried, 200], `speed ${speed}: lands ${carried} px on`);
  }
  performance.now = realNow;
  checks++;
}

console.log(`${checks} of ${checks} camera checks pass`);
