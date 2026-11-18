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
const ev = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, button: 0 });
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

// A click picks, in canvas pixels; a drag of more than 4 px turns the map instead.
view.down(ev(3, 110, 120));
view.up(ev(3, 112, 121));
assert.deepStrictEqual(picks, [[102, 101]], "click picks in canvas pixels");
const th0 = view.cam.th;
view.down(ev(4, 110, 120));
view.move(ev(4, 140, 120));
view.up(ev(4, 140, 120));
assert.strictEqual(picks.length, 1, "a drag is not a click");
near(view.cam.th, th0 + 30 * 0.006, "dragging in 3D turns the map");
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

console.log(`${checks} of ${checks} camera checks pass`);
