/*
 * Runs BFS, Dijkstra and A* on one board and derives everything the grid
 * views show: costs, steps, nodes taken off the queue, distinct cells, the
 * queue size after every step, the cells A* skipped, and the headline.
 *
 * Pure code, no DOM. In the browser it sets window.Runs; in Node it is a
 * CommonJS module, so tests/test_layers.js checks the exact code the page runs.
 */
(function (root) {
  "use strict";
  const PF = typeof module !== "undefined" && module.exports ? require("./pathfinder.js") : root.Pathfinder;
  const ALGOS = ["bfs", "ucs", "astar"];
  const NAMES = { bfs: "BFS", ucs: "Dijkstra", astar: "A*" };

  function one(algo, grid, start, end) {
    const rows = grid.length, cols = grid[0].length, trace = [];
    const res = PF.search(algo, rows, cols, start, end, grid, "manhattan", trace);
    // closeStep[cell] is the index of the step that first took it off the
    // queue (not stale), or -1. reached marks cells that ever entered the queue.
    const closeStep = new Int32Array(rows * cols).fill(-1);
    const reached = new Uint8Array(rows * cols);
    reached[start[0] * cols + start[1]] = 1;
    let cells = 0, peak = 0;
    trace.forEach((t, i) => {
      peak = Math.max(peak, t.frontier);
      if (t.stale) return;
      const [r, c] = t.node;
      closeStep[r * cols + c] = i;
      cells++;
      if (t.goal) return;
      for (const [nr, nc] of PF.getNeighbours(r, c, rows, cols, grid)) reached[nr * cols + nc] = 1;
    });
    return {
      algo,
      name: NAMES[algo],
      path: res.path,
      order: res.order,
      trace,
      closeStep,
      reached,
      cost: PF.pathCost(grid, res.path), // null when there is no route
      steps: res.path ? res.path.length - 1 : null,
      nodes: res.order.length, // every node taken off the queue, stale ones included
      cells, // distinct cells taken off the queue
      peak,
    };
  }

  function solve(grid, start, end) {
    const out = {};
    for (const a of ALGOS) out[a] = one(a, grid, start, end);
    // Cells Dijkstra took off the queue that A* never did, in Dijkstra's order.
    out.skipped = [];
    out.ucs.closeStep.forEach((s, k) => {
      if (s >= 0 && out.astar.closeStep[k] < 0) out.skipped.push(k);
    });
    out.skipped.sort((a, b) => out.ucs.closeStep[a] - out.ucs.closeStep[b]);
    out.longest = Math.max(...ALGOS.map((a) => out[a].nodes));
    return out;
  }

  // How many copies of each cell sit in the queue after k steps, by replaying
  // the trace: each step takes one copy of its cell out, and an expansion adds
  // one copy of every neighbour that isn't closed yet, just as the search does.
  function frontierAt(run, grid, start, k) {
    const rows = grid.length, cols = grid[0].length;
    const count = new Int32Array(rows * cols), closed = new Uint8Array(rows * cols);
    count[start[0] * cols + start[1]] = 1;
    for (let i = 0; i < k; i++) {
      const t = run.trace[i], [r, c] = t.node;
      count[r * cols + c]--;
      if (t.stale || t.goal) continue;
      closed[r * cols + c] = 1;
      for (const [nr, nc] of PF.getNeighbours(r, c, rows, cols, grid)) if (!closed[nr * cols + nc]) count[nr * cols + nc]++;
    }
    return count;
  }

  const pct = (a, b) => Math.round((1 - a / b) * 100);

  // The headline and its explanation, written from the numbers.
  function headline(R) {
    const { bfs: B, ucs: U, astar: A } = R;
    if (!A.path)
      return { title: "No route. The creek cuts the flag off.", text: "None of the three searches can reach the flag. Move a pin or remove some creek." };
    const fewer = U.nodes - A.nodes;
    const astar = fewer > 0
      ? `A* finds the same best route as Dijkstra and takes ${pct(A.nodes, U.nodes)}% fewer nodes off the queue (${A.nodes} against ${U.nodes}).`
      : `A* and Dijkstra take the same ${A.nodes} nodes off the queue here, so the heuristic has nothing to add.`;
    if (B.cost > A.cost)
      return {
        title: "BFS pays for the climb. A* goes around it.",
        text: `Every step costs 1 plus any climb. BFS counts steps only, so its ${B.steps}-step route costs ${B.cost}. The best route costs ${A.cost}. ${astar}`,
      };
    return {
      title: "No climb to dodge between these pins.",
      text: `Every step costs 1 plus any climb. All three routes cost ${A.cost}, so BFS loses nothing by counting steps. ${astar}`,
    };
  }

  const api = { solve, headline, frontierAt, ALGOS, NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Runs = api;
})(typeof window !== "undefined" ? window : globalThis);
