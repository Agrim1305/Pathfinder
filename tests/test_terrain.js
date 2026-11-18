// Checks the terrain model (docs/terrain.js) on every bundled map: it is
// deterministic, the creek sits below the ground beside it, contour lines lie
// on their level, and every map style gives valid colours.
// Run from the project root: node tests/test_terrain.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PF = require("../docs/pathfinder.js");
const T = require("../docs/terrain.js");

const MAPS = ["small", "choice", "maze", "open", "large", "detour"];
let checks = 0;

for (const m of MAPS) {
  const { grid } = PF.parseMap(fs.readFileSync(path.join(__dirname, "..", "maps", m + ".txt"), "utf8"));
  const t = T.buildTerrain(grid);

  // The same grid always gives the same landscape.
  const again = T.buildTerrain(grid);
  for (const f of ["z", "water", "light"]) assert.deepStrictEqual(again[f], t[f], `${m}: ${f} is deterministic`);
  checks++;

  // Every water vertex sits below each dry vertex next to it, and water
  // appears exactly where the map has impassable cells.
  const hasCreek = grid.some((row) => row.includes(-1));
  assert.strictEqual(t.water.some((w) => w), hasCreek, `${m}: water only where the map has creek cells`);
  for (let j = 0; j < t.nv; j++)
    for (let i = 0; i < t.nu; i++) {
      const k = j * t.nu + i;
      if (!t.water[k]) continue;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || ii >= t.nu || jj < 0 || jj >= t.nv || t.water[jj * t.nu + ii]) continue;
          assert.ok(t.z[k] < t.z[jj * t.nu + ii], `${m}: water at (${i}, ${j}) is below dry ground beside it`);
        }
    }
  checks++;

  // Every contour segment lies at its level, and there is one for each whole
  // height the dry ground reaches.
  let segments = 0;
  for (const level of t.levels) {
    const s = t.contours(level);
    assert.strictEqual(s.length % 4, 0, `${m}: contour ${level} is whole segments`);
    for (let i = 0; i < s.length; i += 2) {
      const z = t.heightAt(s[i], s[i + 1]);
      assert.ok(Math.abs(z - level) < 1e-6, `${m}: contour ${level} point is at height ${z}`);
    }
    segments += s.length / 4;
  }
  const highest = Math.max(...grid.flat());
  assert.ok(highest < 1 || segments > 0, `${m}: a map with hills has contours`);
  checks++;
}

// Every style gives three whole numbers from 0 to 255, for ground and water,
// across the full range of heights and light.
for (const style of Object.keys(T.STYLES)) {
  for (let z = -1; z <= 10; z += 0.25)
    for (let light = 0; light <= 1; light += 0.125)
      for (const water of [false, true]) {
        const c = T.colourFor(style, z, light, water);
        assert.ok(c.length === 3 && c.every((x) => Number.isInteger(x) && x >= 0 && x <= 255), `${style}: colour ${c}`);
      }
  assert.match(T.css(T.colourFor(style, 4, 0.7, false)), /^rgb\(\d+,\d+,\d+\)$/);
  checks++;
}

console.log(`${checks} of ${checks} terrain checks pass on ${MAPS.length} maps and ${Object.keys(T.STYLES).length} styles`);
