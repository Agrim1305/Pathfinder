// Checks the desktop layout in headless Chrome at 1440 x 900 and 1920 x 1080,
// light and dark, from a fresh browser profile, on a first visit (with the
// welcome card) and a return visit:
//   - the page itself never scrolls, down or sideways
//   - the panel fills the right of the window below the header, and the map
//     sits 16 px in from the header, the window edges and the panel, with
//     16 px corners that the canvas rounds itself (nothing clips popovers)
//   - nothing in the panel is wider than the panel
//   - step 1 and the first result card show without scrolling the panel
//   - the welcome card shows on the first visit only
// and saves a screenshot of each (reduced motion, so the replay shows its end).
//
// Serve docs/ first (python -m http.server 8000 --directory docs), then:
//   node tools/check_layout.js http://localhost:8000/ [screenshot folder]
// Needs Node 22 or later. Set CHROME if Chrome is not in the usual macOS place.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const [base = "http://localhost:8000/", outDir] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SIZES = [[1440, 900], [1920, 1080]];
const THEMES = ["light", "dark"];

// Runs in the page; returns a list of problems.
const CHECK = `(() => {
  const r = (el) => el.getBoundingClientRect(), bad = [];
  const doc = document.documentElement, panel = document.getElementById("panel"), map = document.getElementById("map"), top = document.querySelector(".top");
  if (doc.scrollHeight > innerHeight || doc.scrollWidth > innerWidth) bad.push("the page scrolls: " + doc.scrollWidth + " x " + doc.scrollHeight);
  const p = r(panel), m = r(map), h = r(top);
  const near = (a, b) => Math.abs(a - b) <= 1;
  if (!near(p.top, h.bottom) || !near(p.right, innerWidth) || !near(p.bottom, innerHeight)) bad.push("the panel does not fill the right of the window");
  const gaps = [m.top - h.bottom, m.left, innerHeight - m.bottom, p.left - m.right].map(Math.round);
  if (gaps.some((g) => Math.abs(g - 16) > 1)) bad.push("the map is not 16 px in all round (top, left, bottom, right: " + gaps.join(", ") + ")");
  const ms = getComputedStyle(map), cs = getComputedStyle(map.querySelector("canvas"));
  if (ms.borderTopLeftRadius !== "16px" || cs.borderTopLeftRadius !== "15px" || ms.overflow !== "visible") bad.push("the map corners are not rounded on the canvas, or the map clips");
  if (panel.scrollWidth > panel.clientWidth) bad.push("something in the panel is wider than it");
  for (const sel of ["#step1", ".rc"]) if (r(document.querySelector(sel)).bottom > p.bottom) bad.push(sel + " needs the panel scrolled to see it");
  return bad;
})()`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pathfinder-layout-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let fails = 0;
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
    }
    for (const [w, h] of SIZES) for (const theme of THEMES) {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r) => (ws.onopen = r));
      let id = 0;
      const pending = new Map();
      ws.onmessage = (msg) => { const d = JSON.parse(msg.data); if (pending.has(d.id)) pending.get(d.id)(d.result), pending.delete(d.id); };
      const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
      const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      // a first visit (with the welcome card), then a return visit
      for (const visit of ["first", "return"]) {
        await send("Page.navigate", { url: `${base}?${visit}#theme=${theme}` });
        await evaluate(`new Promise((r) => { const go = () => { try { ${visit === "first" ? "localStorage.removeItem" : "localStorage.setItem"}("pathfinder-welcome-seen", "1"); } catch (e) {} r(); }; document.readyState === "loading" ? addEventListener("DOMContentLoaded", go) : go(); })`);
        await send("Page.reload");
        await new Promise((r) => setTimeout(r, 300));
        const t0 = Date.now();
        while (Date.now() - t0 < 20000 && !(await evaluate("!!window.app && document.fonts.status === 'loaded'"))) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 500));
        const problems = await evaluate(CHECK);
        const welcome = await evaluate("!document.getElementById('welcome').hidden");
        if (welcome !== (visit === "first")) problems.push(`the welcome card ${welcome ? "shows" : "is missing"} on a ${visit} visit`);
        console.log(`${w} x ${h} ${theme}, ${visit} visit: ${problems.length ? problems.join("; ") : "fits"}`);
        fails += problems.length;
        if (outDir) {
          const shot = await send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(outDir, `adelaide-${w}-${theme}${visit === "first" ? "-welcome" : ""}.png`), Buffer.from(shot.data, "base64"));
        }
      }
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
      ws.close();
    }
  } finally {
    const gone = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await gone;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
  process.exit(fails ? 1 : 0);
})();
