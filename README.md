# Pathfinder: Graph Search Algorithms

A clean, well-documented implementation of three classic pathfinding algorithms for finding optimal routes through weighted 2D grids.

**Source code:** [github.com/Agrim1305/Pathfinder](https://github.com/Agrim1305/Pathfinder)

## Algorithms Implemented

### **BFS (Breadth-First Search)**
- Finds the **shortest path** (minimum number of steps)
- Best for: Unweighted graphs
- Guarantees: Optimal solution
- Efficiency: O(V + E) time

### **UCS (Uniform Cost Search)**
- Finds the **lowest-cost path** when edges have varying weights
- Based on Dijkstra's algorithm
- Best for: Weighted graphs without a good heuristic
- Guarantees: Optimal solution for non-negative weights
- Efficiency: Better than BFS for weighted graphs, but explores more nodes than A*

### **A* (A-star)**
- **Heuristic-guided search** combining actual cost and estimated distance
- Balances optimality and efficiency
- Best for: When a good admissible heuristic exists
- Supports: Euclidean and Manhattan distance heuristics
- Guarantees: Optimal solution (with admissible heuristic)
- Efficiency: Typically explores fewer nodes than UCS

## Problem Domain

The algorithms solve pathfinding on **elevation-aware grids**:
- **Cells** have integer elevation values
- **Movement cost** = 1 + max(0, elevation_difference) — moving uphill is expensive
- **Obstacles** block movement (marked as 'X')
- **Movement**: 4-directional (no diagonals)

## Quick Start

### Installation
```bash
# No external dependencies required (uses only Python stdlib)
python pathfinder.py
```

### Basic Usage
```bash
# Find shortest path (BFS)
python pathfinder.py release maps/choice.txt bfs

# Find lowest-cost path (UCS)
python pathfinder.py release maps/choice.txt ucs

# Find path with heuristic guidance (A*)
python pathfinder.py release maps/choice.txt astar manhattan

# Debug mode: see path + visit statistics
python pathfinder.py debug maps/large.txt astar manhattan
```

### Run the Example
```bash
python example.py
```

## Map File Format

```
rows cols
start_row start_col    (1-indexed)
end_row end_col        (1-indexed)
elevation grid (space-separated, 'X' for obstacle)
```

Lines starting with `#` are treated as comments and ignored.

### Example
```
# elevation grid example
4 5
1 1
4 5
0 0 0 X 0
0 0 0 X 0
0 0 0 X 0
0 0 0 0 0
```

## Generating Maps

Regenerate or customize the bundled maps with the included generator:

```bash
python generate_maps.py
```

Edit the parameters in `generate_maps.py` to create your own grids.

## API Overview

```python
from pathfinder import parse_map, bfs, ucs, astar

# Load map
rows, cols, start, end, grid = parse_map("maps/choice.txt")

# Run algorithm
path, num_visits, first_visit, last_visit = bfs(rows, cols, start, end, grid)

# Check result
if path:
    print(f"Found path of length {len(path)}")
else:
    print("No path exists")
```

## Heuristics

For A*, two heuristics are provided:

### Manhattan Distance
```
h = |x1 - x2| + |y1 - y2|
```
Good for grid-based movement. Admissible (never overestimates).

### Euclidean Distance
```
h = sqrt((x1 - x2)^2 + (y1 - y2)^2)
```
Good when diagonal movement is theoretically possible. Also admissible.

## Test Maps

Included maps in the `maps/` directory:
- `small.txt` — 5×5 grid with a wall and gentle elevation (quick demo)
- `choice.txt` — 8×8 grid where a cheap flat detour beats a costly climb (best for comparing algorithms)
- `maze.txt` — 11×11 maze; tests obstacle navigation
- `open.txt` — 10×10 flat grid, no obstacles (baseline comparison)
- `large.txt` — 20×20 random elevation and obstacles (shows A* exploring far fewer nodes than UCS)

### Example: comparing algorithms on `choice.txt`

All three find the same optimal path, but explore very different numbers of nodes:

| Algorithm | Path length | Nodes explored |
|-----------|-------------|----------------|
| BFS       | 15          | 112            |
| UCS       | 15          | 75             |
| A*        | 15          | 41             |

This illustrates how A*'s heuristic guides the search toward the goal, while BFS and UCS expand outward more broadly.

## Author

Agrim Sharma

## License

Educational use. Part of a university AI assignment, with the pathfinding algorithms implemented from scratch.