/*
 * Colours for the Adelaide map canvas, in light and dark. The light values
 * are the original map; the dark ones keep the same roles: dark land, darker
 * roads, slate buildings whose faces towards the light are lighter, deep
 * water and brighter routes. tests/test_contrast.js checks the label colours.
 *
 * Colours are hex, with an optional alpha byte (#RRGGBBAA). Walls are worked
 * out from wall: [base, spread, tint]: grey level = base + spread * facing,
 * where facing runs from -1 (towards the light) to 1, plus the tint.
 */
(function (root) {
  "use strict";
  const PALETTES = {
    light: {
      bg: "#E9EBE6", land: "#F4F3EF", green: "#D3E8C4", water: "#AFD5EC",
      casing: "#DCDDD8", road0: "#FFFFFF", road1: "#FFFFFF", road2: "#FDFDFC", road3: "#F7EFE2", path: "#FFFFFFE6",
      rail: "#B9BCC2", flat: "#E1E3E6", flatEdge: "#CDD0D5",
      roof: "#F7F8FA", roofEst: "#F1F2F4", roofEdge: "#C9CCD2", wall: [214, -22, [0, 2, 6]],
      explored: "#1D4ED89E", skipped: "#0F766E80", bfs: "#C2410C", best: "#1D4ED8", routeHalo: "#FFFFFF",
      marker: "#FFFFFF", markerShadow: "#15181D33", pin: "#15181D", pinFill: "#FFFFFF",
      ink: "#15181D", halo: "#F6F7F3F2", street: "#5B6470", streetHalo: "#FFFFFFE6", river: "#245E7E", attr: "#15181DB8",
    },
    dark: {
      bg: "#0C1117", land: "#121820", green: "#16261E", water: "#0E2A3D",
      casing: "#0A0E13", road0: "#2A3441", road1: "#252E3A", road2: "#212934", road3: "#2A2925", path: "#56637266",
      rail: "#3D4856", flat: "#26303C", flatEdge: "#35414F",
      roof: "#3A4757", roofEst: "#333F4D", roofEdge: "#4A5868", wall: [62, -20, [2, 10, 22]],
      explored: "#3B82F6C0", skipped: "#2DD4BF99", bfs: "#FB923C", best: "#60A5FA", routeHalo: "#0C1117",
      marker: "#E8EEF4", markerShadow: "#00000066", pin: "#E8EEF4", pinFill: "#0C1117",
      ink: "#E8EEF4", halo: "#0C1117E6", street: "#A3AFBD", streetHalo: "#0C1117D9", river: "#7DB7DD", attr: "#E8EEF4A6",
    },
  };

  const parse = (h) => [1, 3, 5, 7].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
  const css = (c) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${(c[3] / 255).toFixed(3)})`;

  // A palette with every colour as a CSS string, part way (t from 0 to 1) from a to b.
  function mix(a, b, t) {
    const out = {};
    for (const k in b) {
      if (k === "wall") {
        const [ba, sa, ta] = a.wall, [bb, sb, tb] = b.wall;
        out.wall = [ba + (bb - ba) * t, sa + (sb - sa) * t, ta.map((x, i) => x + (tb[i] - x) * t)];
      } else {
        const x = parse(a[k]), y = parse(b[k]);
        out[k] = css(x.map((v, i) => v + (y[i] - v) * t));
      }
    }
    return out;
  }

  const api = { PALETTES, mix, parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AdelaidePalette = api;
})(typeof window !== "undefined" ? window : globalThis);
