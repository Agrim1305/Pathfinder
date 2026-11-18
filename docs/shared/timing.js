/*
 * How long a search takes, timed from outside the search code: run it 5
 * times with performance.now() and keep the median, which smooths out timer
 * noise and the first, slower run. Also the "found in X ms" wording.
 *
 * Plain script: window.Timing in the browser, a CommonJS module in Node.
 */
(function (root) {
  "use strict";

  function medianMs(fn, runs = 5) {
    const times = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      fn();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(runs / 2)];
  }

  // Browsers round performance.now() to about 0.1 ms, so below that just say so.
  function formatMs(ms) {
    if (ms < 0.1) return "under 0.1\u00a0ms"; // a no-break space keeps the number and unit together
    return (ms < 10 ? ms.toFixed(1) : String(Math.round(ms))) + "\u00a0ms";
  }

  const api = { medianMs, formatMs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Timing = api;
})(typeof window !== "undefined" ? window : globalThis);
