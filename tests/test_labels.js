// Checks label placement (docs/shared/labels.js): no two placed boxes
// overlap, no placed box overlaps a blocker, earlier items win, and an item
// falls back to its next candidate before it is skipped.
// Run from the project root: node tests/test_labels.js
const assert = require("assert");
const { place, overlaps, around } = require("../docs/shared/labels.js");

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const box = () => ({ x: rnd() * 600, y: rnd() * 400, w: 20 + rnd() * 120, h: 12 + rnd() * 10 });
let checks = 0;

// Many random layouts: whatever is placed never overlaps anything.
for (let trial = 0; trial < 300; trial++) {
  const blockers = Array.from({ length: Math.floor(rnd() * 6) }, box);
  const items = Array.from({ length: 5 + Math.floor(rnd() * 40) }, (_, i) => ({ id: i, candidates: Array.from({ length: 1 + Math.floor(rnd() * 3) }, box) }));
  const out = place(items, blockers);
  for (let i = 0; i < out.length; i++) {
    assert.ok(out[i].item.candidates.includes(out[i].box), "a placed box is one of its candidates");
    for (const b of blockers) assert.ok(!overlaps(out[i].box, b), `trial ${trial}: label ${out[i].item.id} overlaps a blocker`);
    for (let j = i + 1; j < out.length; j++) assert.ok(!overlaps(out[i].box, out[j].box), `trial ${trial}: labels ${out[i].item.id} and ${out[j].item.id} overlap`);
    if (i) assert.ok(out[i - 1].item.id < out[i].item.id, "placed in priority order");
  }
  // every skipped item really had no free candidate
  const taken = out.map((o) => o.box);
  for (const it of items) {
    if (out.some((o) => o.item === it)) continue;
    const before = out.filter((o) => o.item.id < it.id).map((o) => o.box);
    for (const c of it.candidates) assert.ok(blockers.some((b) => overlaps(b, c)) || before.some((t) => overlaps(t, c)), `item ${it.id} was skipped although a candidate was free`);
  }
  assert.ok(taken.length <= items.length);
}
checks++;

// A pin placed first keeps its spot; a landmark on top of it moves to its
// second candidate; a street that fits nowhere is skipped.
const pin = { id: "pin", candidates: [around(100, 100, 40)] };
const landmark = { id: "landmark", candidates: [around(100, 100, 80), around(100, 140, 80)] };
const street = { id: "street", candidates: [around(110, 140, 60)] };
const out = place([pin, landmark, street], [{ x: 300, y: 0, w: 100, h: 50 }]);
assert.deepStrictEqual(out.map((o) => o.item.id), ["pin", "landmark"]);
assert.deepStrictEqual(out[1].box, landmark.candidates[1]);
// with bounds, a label that would be cut off at the edge takes its next spot
const edge = place([{ id: "edge", candidates: [around(5, 50, 40), around(40, 50, 40)] }], [], { x: 0, y: 0, w: 200, h: 100 });
assert.deepStrictEqual(edge[0].box, around(40, 50, 40));
// boxes that only touch at an edge do not overlap
assert.ok(!overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }));
checks++;

console.log(`${checks} of ${checks} label placement checks pass (300 random layouts)`);
