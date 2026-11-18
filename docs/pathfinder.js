/*
 * Pathfinder in the browser: the same BFS, UCS (Dijkstra) and A* as pathfinder.py,
 * written in JavaScript so the demo runs without installing anything.
 *
 * It follows the Python version line for line: same cost rule, same neighbour order
 * (up, down, left, right), same closed set and the same counter tie-breaker. The test
 * in tests/compare_js.js checks both give identical results on every map.
 *
 * Grid cells: -1 is an obstacle, any other number is the elevation.
 * Positions are [row, col] pairs, 0-indexed.
 */

const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]; // up, down, left, right

function getNeighbours(r, c, rows, cols, grid) {
  const out = [];
  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr,
      nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] !== -1)
      out.push([nr, nc]);
  }
  return out;
}

// Moving uphill costs extra: 1 + max(0, elevation difference)
function stepCost(grid, r1, c1, r2, c2) {
  return 1 + Math.max(0, grid[r2][c2] - grid[r1][c1]);
}

function heuristic(r, c, er, ec, type) {
  if (type === "euclidean") return Math.sqrt((r - er) ** 2 + (c - ec) ** 2);
  if (type === "manhattan") return Math.abs(r - er) + Math.abs(c - ec);
  return 0;
}

function pathCost(grid, path) {
  if (!path) return null;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++)
    total += stepCost(grid, ...path[i], ...path[i + 1]);
  return total;
}

// A small binary min-heap, ordered like Python's heapq on (priority, counter) tuples.
class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  less(a, b) {
    return a.key[0] !== b.key[0] ? a.key[0] < b.key[0] : a.key[1] < b.key[1];
  }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.items,
      top = a[0],
      last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

const key = (r, c) => r * 10000 + c;

// Walk back from the goal using the parent of each node
function reconstructPath(cameFrom, end) {
  const path = [end];
  let k = key(...end);
  while (cameFrom.get(k)) {
    const p = cameFrom.get(k);
    path.push(p);
    k = key(...p);
  }
  return path.reverse();
}

// How many queue entries each trace step keeps, front first.
const TRACE_QUEUE = 7;

/*
 * Runs one search. algorithm is "bfs", "ucs" or "astar"; hType is used by A*.
 * Returns { path, numVisits, order } where order lists every node taken off
 * the queue, in sequence (used to animate the search).
 *
 * Pass an array as trace to also get one entry per node taken off the queue:
 * { node, g, f, stale, goal, pushed, skipped, frontier, queue }. pushed and
 * skipped count the neighbours added and the ones left out as already closed,
 * frontier is the queue size afterwards, and queue holds the next entries to
 * come out, each { node, g, f, stale }. The trace only reads the search
 * state, so results are identical with or without it (tests/test_trace.js).
 */
function search(algorithm, rows, cols, start, end, grid, hType = "manhattan", trace = null) {
  const numVisits = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const order = [];
  const closed = new Set();
  const cameFrom = new Map();
  const [er, ec] = end;

  let counter = 0;
  let push, pop, empty, size, front;
  if (algorithm === "bfs") {
    const queue = [];
    let head = 0;
    push = (item) => queue.push(item);
    pop = () => queue[head++];
    empty = () => head >= queue.length;
    size = () => queue.length - head;
    front = (n) => queue.slice(head, head + n);
  } else {
    const heap = new MinHeap();
    push = (item) => heap.push(item);
    pop = () => heap.pop();
    empty = () => heap.size === 0;
    size = () => heap.size;
    front = (n) =>
      heap.items
        .slice()
        .sort((a, b) => (heap.less(a, b) ? -1 : 1))
        .slice(0, n);
  }
  const note = (item, stale, goal, pushed, skipped) =>
    trace.push({
      node: item.node,
      g: item.g,
      f: item.key[0],
      stale,
      goal,
      pushed,
      skipped,
      frontier: size(),
      queue: front(TRACE_QUEUE).map((q) => ({
        node: q.node,
        g: q.g,
        f: q.key[0],
        stale: closed.has(key(...q.node)),
      })),
    });

  const h0 =
    algorithm === "astar" ? heuristic(start[0], start[1], er, ec, hType) : 0;
  push({ key: [h0, counter], g: 0, node: start, parent: null });

  while (!empty()) {
    const item = pop();
    const { g, node, parent } = item;
    const [r, c] = node;
    numVisits[r][c] += 1;
    order.push(node);

    if (r === er && c === ec) {
      cameFrom.set(key(r, c), parent);
      if (trace) note(item, false, true, 0, 0);
      return { path: reconstructPath(cameFrom, end), numVisits, order };
    }
    if (closed.has(key(r, c))) {
      if (trace) note(item, true, false, 0, 0);
      continue;
    }
    closed.add(key(r, c));
    cameFrom.set(key(r, c), parent);

    let pushed = 0,
      skipped = 0;
    for (const [nr, nc] of getNeighbours(r, c, rows, cols, grid)) {
      if (closed.has(key(nr, nc))) {
        skipped++;
        continue;
      }
      counter += 1;
      pushed++;
      if (algorithm === "bfs") {
        push({ key: [0, counter], g: 0, node: [nr, nc], parent: node });
      } else {
        const ng = g + stepCost(grid, r, c, nr, nc);
        const f =
          algorithm === "astar" ? ng + heuristic(nr, nc, er, ec, hType) : ng;
        push({ key: [f, counter], g: ng, node: [nr, nc], parent: node });
      }
    }
    if (trace) note(item, false, false, pushed, skipped);
  }
  return { path: null, numVisits, order };
}

// Same file format as the Python parse_map
function parseMap(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const [rows, cols] = lines[0].split(/\s+/).map(Number);
  const [sr, sc] = lines[1].split(/\s+/).map(Number);
  const [er, ec] = lines[2].split(/\s+/).map(Number);
  const grid = [];
  for (let i = 3; i < 3 + rows; i++)
    grid.push(lines[i].split(/\s+/).map((v) => (v === "X" ? -1 : Number(v))));
  return { rows, cols, start: [sr - 1, sc - 1], end: [er - 1, ec - 1], grid };
}

const Pathfinder = { search, parseMap, pathCost, stepCost, getNeighbours };
if (typeof module !== "undefined") module.exports = Pathfinder;
if (typeof window !== "undefined") window.Pathfinder = Pathfinder;
