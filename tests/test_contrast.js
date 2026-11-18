// Checks text and control colours against WCAG AA in both themes: 4.5:1 for
// text, 3:1 for control edges and focus rings. Reads the tokens straight from
// docs/shared/theme.css, plus the map label colours in docs/terrain.js.
// Run from the project root: node tests/test_contrast.js
const fs = require("fs");
const path = require("path");
const T = require("../docs/terrain.js");

const css = fs.readFileSync(path.join(__dirname, "../docs/shared/theme.css"), "utf8");
const block = (sel) => {
  const body = css.slice(css.indexOf(sel + " {")).split("}")[0];
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
};
const light = block(":root"), dark = Object.assign({}, light, block(':root[data-theme="dark"]'));

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum]
const TEXT = 4.5, EDGE = 3;
const PAIRS = [
  ["ink", "bg", TEXT], ["ink", "surface", TEXT], ["ink-2", "surface", TEXT],
  ["dim", "surface", TEXT], ["dim", "bg", TEXT], ["dim", "chip-off", TEXT],
  ["ink", "seg-bg", TEXT], ["ink", "seg-on", TEXT], ["ink", "chip-off", TEXT],
  ["astar", "surface", TEXT], ["bfs", "surface", TEXT], ["dijkstra", "surface", TEXT],
  ["primary-ink", "primary-bg", TEXT], ["tip-ink", "tip-bg", TEXT],
  ["callout-ink", "callout-bg", TEXT], ["callout-dim", "callout-bg", TEXT],
  ["edge", "surface", EDGE], ["edge", "bg", EDGE], ["edge", "chip-off", EDGE],
  ["focus", "surface", EDGE], ["focus", "bg", EDGE], ["primary-bg", "surface", EDGE],
];

let fails = 0, checks = 0;
for (const [name, tokens] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min] of PAIRS) {
    checks++;
    const r = ratio(tokens[fg], tokens[bg]);
    if (r < min) { fails++; console.log(`${name}: --${fg} on --${bg} is ${r.toFixed(2)}:1, needs ${min}:1`); }
  }
}
// Map labels are drawn in each style's ink over a halo of its stage colour.
for (const [name, s] of Object.entries(T.STYLES)) {
  checks++;
  const r = ratio(s.ink, s.stage);
  if (r < TEXT) { fails++; console.log(`${name} map: label ink on stage is ${r.toFixed(2)}:1`); }
}
console.log(`${checks - fails} of ${checks} colour pairs meet WCAG AA in both themes`);
process.exit(fails ? 1 : 0);
