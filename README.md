# Pathfinder: Terrain Route Planner

![tests](https://github.com/Agrim1305/Pathfinder/actions/workflows/tests.yml/badge.svg)

Finds the lowest-effort route across terrain with hills and obstacles, and shows why the
choice of search algorithm matters. BFS, Dijkstra (Uniform Cost Search) and A\* are
implemented from scratch in Python with no external dependencies.

**[Try it in your browser](https://agrim1305.github.io/Pathfinder/)**: pick an algorithm, or race all three, and watch each one search the demo map. Once a route is found, a hiker walks it at a pace set by the real step cost, so climbs visibly slow it down. Every visit, and every press of "New walls", gives a fresh random wall layout on the same hilly terrain. The figures below use the fixed walls in `maps/detour.txt`, and `python benchmark.py` reproduces them. The browser version is a JavaScript copy of the same algorithms, and CI checks it gives identical results to the Python code on every map.

**The short version:** counting steps is not enough. On the demo map, BFS (which only
counts steps) walks straight over a hill and pays **35% more effort** than the best route of
the same length, and A\* finds that best route while expanding **59% fewer nodes** than Dijkstra.

![Both routes take 26 steps; the BFS route (orange) goes over the hill, the lowest-effort route (blue) goes around it](docs/routes.png)

## The problem

Each cell of the grid has an elevation, and some cells are blocked. Moving to a
neighbouring cell (up, down, left or right) costs:

```
cost = 1 + max(0, elevation_to - elevation_from)
```

So walking downhill or on the flat costs 1, and climbing costs extra. The goal is the
route from start to finish with the lowest total cost.

## Results

![Dijkstra examines cells on the hill; A* skips it and examines 45% fewer](docs/explored.png)

Reproduce these with `python benchmark.py`. "Nodes" counts every node taken off the
search queue. A\* uses the Manhattan heuristic.

| Map                      | BFS cost | Best cost (UCS and A\*) | BFS nodes | UCS nodes | A\* nodes | A\* saving vs UCS |
| ------------------------ | -------- | ----------------------- | --------- | --------- | --------- | ----------------- |
| small (5×5)              | 8        | 8                       | 27        | 26        | 16        | 38%               |
| choice (8×8)             | 14       | 14                      | 112       | 75        | 41        | 45%               |
| maze (11×11)             | 20       | 20                      | 96        | 96        | 90        | 6%                |
| open (10×10)             | 18       | 18                      | 180       | 180       | 180       | 0%                |
| large (20×20)            | 67       | 54                      | 618       | 618       | 553       | 11%               |
| detour (14×14), demo map | 35       | 26                      | 331       | 331       | 137       | 59%               |

What the numbers show:

- **BFS ignores cost.** It only counts steps, so on the large map it picks a 38-step route
  that costs 67, when another 38-step route costs 54.
- **A\* only helps when the heuristic has something to say.** It saves 45% on `choice`,
  where the goal direction is clear, and nothing on a flat open grid, where every route
  of the same length ties.
- **UCS and A\* always agree on the best cost**, which the tests check on every map.

## Quick start

Requires Python 3.9 or newer. No packages to install.

```bash
# Lowest-cost route with A*
python pathfinder.py release maps/choice.txt astar manhattan

# Same map with Dijkstra (UCS), and with BFS for comparison
python pathfinder.py release maps/choice.txt ucs
python pathfinder.py release maps/choice.txt bfs

# Debug mode: the route plus how often, and in what order, each cell was visited
python pathfinder.py debug maps/large.txt astar manhattan

# Compare all algorithms on all maps
python benchmark.py

# Redraw the README images (optional, needs matplotlib)
pip install matplotlib
python visualize.py
```

## Tests

```bash
python -m unittest discover -s tests -v
```

13 Python tests, plus a check (`node tests/compare_js.js`) that the browser demo matches the Python code, all run automatically on every push by GitHub Actions. The Python tests check that:

- every algorithm returns a legal path (adjacent steps, no obstacles, no repeated cells)
  on every map, with both A\* heuristics
- UCS and A\* find the same optimal cost, and BFS never takes more steps than either
- A\* never expands more nodes than UCS
- the figures in the results table stay correct
- edge cases behave: unreachable goal, start equal to goal, a single-cell grid, and
  uphill versus downhill costs

## Design decisions

- **Binary heap priority queue.** UCS and A\* use `heapq`, so each push and pop is
  O(log n). An insertion counter breaks ties, which keeps the order stable and avoids
  comparing positions.
- **Hash-set closed list.** Checking whether a node was already expanded is O(1).
- **Parent pointers, not path copies.** Each node stores the single node it came from,
  and the route is rebuilt once at the goal. An earlier version copied the whole partial
  path into every queue entry, which costs O(path length) memory per entry. Parent
  pointers keep it at O(V) overall, with identical output.
- **Admissible heuristics.** Every step costs at least 1, so Manhattan distance never
  overestimates the remaining cost, and A\* stays optimal. Euclidean is also provided.

## Map format

```
# lines starting with # are comments
rows cols
start_row start_col    (1-indexed)
end_row end_col        (1-indexed)
elevation grid, space-separated, X for an obstacle
```

`generate_maps.py` rebuilds the bundled maps, and its parameters can be changed to make
new ones.

## Project structure

```
pathfinder.py        search algorithms, cost model and command-line interface
benchmark.py         compares every algorithm on every map
visualize.py         draws the README images (needs matplotlib)
docs/                browser demo (index.html, pathfinder.js) and README images
example.py           using the module from Python
generate_maps.py     builds the test maps
maps/                six maps, from a 5×5 demo to a 20×20 random terrain, plus the browser demo map
tests/               unit tests
```

## Author

Agrim Sharma. Started as a university AI assignment, then extended with benchmarking,
tests and a more memory-efficient path reconstruction.
