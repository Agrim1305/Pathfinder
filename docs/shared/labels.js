/*
 * Label placement for the canvas maps. Items come in priority order (pins,
 * then landmarks, then streets), each with one or more candidate boxes in
 * canvas pixels. Each item takes its first candidate that overlaps no box
 * already placed and no blocker (pin markers, controls floating over the
 * map) and, when bounds are given, lies wholly inside them so no label is
 * cut off at the canvas edge. An item with no free candidate is skipped.
 *
 * Plain script: window.MapLabels in the browser, a CommonJS module in Node
 * for tests/test_labels.js. Boxes are { x, y, w, h }.
 */
(function (root) {
  "use strict";

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  const inside = (c, b) => !b || (c.x >= b.x && c.y >= b.y && c.x + c.w <= b.x + b.w && c.y + c.h <= b.y + b.h);

  // Returns [{ item, box }] for the items that fit, in priority order.
  function place(items, blockers = [], bounds = null) {
    const taken = [], out = [];
    for (const item of items) {
      const box = item.candidates.find((c) => inside(c, bounds) && !blockers.some((b) => overlaps(b, c)) && !taken.some((t) => overlaps(t, c)));
      if (!box) continue;
      taken.push(box);
      out.push({ item, box });
    }
    return out;
  }

  // A text box centred on (x, y), with a little room for the halo.
  const around = (x, y, w, h = 16, pad = 2) => ({ x: x - w / 2 - pad, y: y - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad });

  // Boxes of elements floating over a canvas, in that canvas's pixels.
  function controlBoxes(canvas, elements) {
    const c = canvas.getBoundingClientRect(), out = [];
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height });
    }
    return out;
  }

  const api = { place, overlaps, around, controlBoxes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MapLabels = api;
})(typeof window !== "undefined" ? window : globalThis);
