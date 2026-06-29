"""
Pathfinder: A collection of graph search algorithms for finding optimal paths in weighted grids.

This module implements three search algorithms:
- BFS (Breadth-First Search): Finds shortest path in unweighted graphs
- UCS (Uniform Cost Search): Finds lowest-cost path when edges have varying weights
- A* (A-star): Heuristic-guided search that combines cost and estimated distance

The algorithms work on 2D grids where cells have elevation costs, obstacles are blocked,
and movement is only horizontal/vertical (no diagonals).

Author: Agrim Sharma
"""

import sys
import math
from collections import deque
from typing import Tuple, List, Optional
import heapq

# Type aliases for readability
Position = Tuple[int, int]
Grid = List[List[int]]
Path = List[Position]


def parse_map(filepath: str) -> Tuple[int, int, Position, Position, Grid]:
    """
    Parse a map file into grid format.

    File format:
        Lines starting with '#' are comments and are skipped.
        Line 1: rows cols
        Line 2: start_row start_col (1-indexed)
        Line 3: end_row end_col (1-indexed)
        Lines 4+: Grid values (space-separated). Use 'X' for obstacles, integers for elevation.

    Args:
        filepath: Path to the map file.

    Returns:
        Tuple of (rows, cols, start_pos, end_pos, grid).
        Positions are 0-indexed tuples (row, col).
        Grid cells: -1 for obstacles, non-negative integers for elevation.
    """
    with open(filepath, 'r') as f:
        lines = f.read().strip().split('\n')

    # Skip comment lines (starting with '#') and empty lines
    lines = [line for line in lines if line.strip() and not line.strip().startswith('#')]

    rows, cols = map(int, lines[0].split())
    start_r, start_c = map(int, lines[1].split())
    end_r, end_c = map(int, lines[2].split())

    # Convert to 0-indexed
    start = (start_r - 1, start_c - 1)
    end = (end_r - 1, end_c - 1)
    
    grid = []
    for i in range(3, 3 + rows):
        row = []
        for val in lines[i].split():
            if val == 'X':
                row.append(-1)  # obstacle
            else:
                row.append(int(val))
        grid.append(row)

    return rows, cols, start, end, grid


def get_neighbours(r: int, c: int, rows: int, cols: int, grid: Grid) -> List[Position]:
    """
    Get valid neighbours of a cell (no diagonals, obstacles excluded).

    Args:
        r, c: Current cell coordinates (0-indexed).
        rows, cols: Grid dimensions.
        grid: Grid where -1 indicates an obstacle.

    Returns:
        List of valid neighbour positions in order: UP, DOWN, LEFT, RIGHT.
    """
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    neighbours = []
    for dr, dc in directions:
        nr, nc = r + dr, c + dc
        if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] != -1:
            neighbours.append((nr, nc))
    return neighbours


def step_cost(grid: Grid, r1: int, c1: int, r2: int, c2: int) -> int:
    """
    Calculate movement cost between two adjacent cells.

    Cost accounts for elevation: moving uphill is more expensive than moving downhill.
    Formula: 1 + max(0, elevation_difference)

    Args:
        grid: The elevation grid.
        r1, c1: Starting cell coordinates.
        r2, c2: Destination cell coordinates.

    Returns:
        Integer movement cost (minimum 1).
    """
    elev_from = grid[r1][c1]
    elev_to = grid[r2][c2]
    return 1 + max(0, elev_to - elev_from)


def heuristic(r: int, c: int, end_r: int, end_c: int, h_type: str) -> float:
    """
    Compute heuristic distance estimate from (r,c) to goal.

    Args:
        r, c: Current position.
        end_r, end_c: Goal position.
        h_type: Heuristic type ('euclidean' or 'manhattan'). Other values return 0 (no heuristic).

    Returns:
        Distance estimate (float).
    """
    if h_type == 'euclidean':
        return math.sqrt((r - end_r) ** 2 + (c - end_c) ** 2)
    elif h_type == 'manhattan':
        return abs(r - end_r) + abs(c - end_c)
    return 0


def bfs(rows: int, cols: int, start: Position, end: Position, grid: Grid) -> Tuple[Optional[Path], List[List[int]], List[List[int]], List[List[int]]]:
    """
    Breadth-First Search: Find the shortest path (minimum number of steps).

    Uses graph search (closed set) to avoid revisiting nodes. Guarantees optimality
    when all edges have equal weight (unweighted graph).

    Args:
        rows, cols: Grid dimensions.
        start, end: Start and goal positions.
        grid: Elevation grid.

    Returns:
        Tuple of (path, num_visits, first_visit, last_visit).
        - path: List of positions from start to end, or None if unreachable.
        - num_visits: Grid tracking how many times each cell was visited.
        - first_visit: Grid tracking first visit order (1-indexed).
        - last_visit: Grid tracking last visit order (1-indexed).
    """
    visit_counter = 0
    num_visits = [[0] * cols for _ in range(rows)]
    first_visit = [[0] * cols for _ in range(rows)]
    last_visit = [[0] * cols for _ in range(rows)]

    closed = set()
    fringe = deque()
    fringe.append((start, [start]))

    while fringe:
        node, path = fringe.popleft()
        r, c = node

        visit_counter += 1
        num_visits[r][c] += 1
        if first_visit[r][c] == 0:
            first_visit[r][c] = visit_counter
        last_visit[r][c] = visit_counter

        if node == end:
            return path, num_visits, first_visit, last_visit

        if node in closed:
            continue

        closed.add(node)

        for nr, nc in get_neighbours(r, c, rows, cols, grid):
            if (nr, nc) not in closed:
                fringe.append(((nr, nc), path + [(nr, nc)]))

    return None, num_visits, first_visit, last_visit


def ucs(rows: int, cols: int, start: Position, end: Position, grid: Grid) -> Tuple[Optional[Path], List[List[int]], List[List[int]], List[List[int]]]:
    """
    Uniform Cost Search: Find the lowest-cost path when edges have varying weights.

    Orders expansion by cumulative path cost (Dijkstra's algorithm). Guarantees optimality
    for non-negative edge weights. More efficient than A* when no good heuristic exists.

    Args:
        rows, cols: Grid dimensions.
        start, end: Start and goal positions.
        grid: Elevation grid (determines movement costs).

    Returns:
        Tuple of (path, num_visits, first_visit, last_visit).
    """
    visit_counter = 0
    num_visits = [[0] * cols for _ in range(rows)]
    first_visit = [[0] * cols for _ in range(rows)]
    last_visit = [[0] * cols for _ in range(rows)]

    closed = set()
    counter = 0
    fringe = []
    heapq.heappush(fringe, (0, counter, start, [start]))

    while fringe:
        cost, _, node, path = heapq.heappop(fringe)
        r, c = node

        visit_counter += 1
        num_visits[r][c] += 1
        if first_visit[r][c] == 0:
            first_visit[r][c] = visit_counter
        last_visit[r][c] = visit_counter

        if node == end:
            return path, num_visits, first_visit, last_visit

        if node in closed:
            continue

        closed.add(node)

        for nr, nc in get_neighbours(r, c, rows, cols, grid):
            if (nr, nc) not in closed:
                new_cost = cost + step_cost(grid, r, c, nr, nc)
                counter += 1
                heapq.heappush(fringe, (new_cost, counter, (nr, nc), path + [(nr, nc)]))

    return None, num_visits, first_visit, last_visit


def astar(rows: int, cols: int, start: Position, end: Position, grid: Grid, h_type: str) -> Tuple[Optional[Path], List[List[int]], List[List[int]], List[List[int]]]:
    """
    A* Search: Heuristic-guided search combining actual cost and estimated distance.

    Balances optimality and efficiency by guiding search toward the goal using a heuristic.
    Typically explores fewer nodes than UCS while still finding optimal paths (with admissible heuristic).

    Args:
        rows, cols: Grid dimensions.
        start, end: Start and goal positions.
        grid: Elevation grid.
        h_type: Heuristic type ('euclidean' or 'manhattan').

    Returns:
        Tuple of (path, num_visits, first_visit, last_visit).
    """
    visit_counter = 0
    num_visits = [[0] * cols for _ in range(rows)]
    first_visit = [[0] * cols for _ in range(rows)]
    last_visit = [[0] * cols for _ in range(rows)]

    closed = set()
    end_r, end_c = end
    h = heuristic(start[0], start[1], end_r, end_c, h_type)
    counter = 0
    fringe = []
    heapq.heappush(fringe, (h, counter, 0, start, [start]))

    while fringe:
        f, _, g, node, path = heapq.heappop(fringe)
        r, c = node

        visit_counter += 1
        num_visits[r][c] += 1
        if first_visit[r][c] == 0:
            first_visit[r][c] = visit_counter
        last_visit[r][c] = visit_counter

        if node == end:
            return path, num_visits, first_visit, last_visit

        if node in closed:
            continue

        closed.add(node)

        for nr, nc in get_neighbours(r, c, rows, cols, grid):
            if (nr, nc) not in closed:
                new_g = g + step_cost(grid, r, c, nr, nc)
                new_h = heuristic(nr, nc, end_r, end_c, h_type)
                new_f = new_g + new_h
                counter += 1
                heapq.heappush(fringe, (new_f, counter, new_g, (nr, nc), path + [(nr, nc)]))

    return None, num_visits, first_visit, last_visit


def format_path(grid: Grid, rows: int, cols: int, path: Optional[Path]) -> str:
    """
    Format the found path as a visual grid for output.

    Args:
        grid: Original elevation grid.
        rows, cols: Grid dimensions.
        path: List of positions on the path, or None if no path exists.

    Returns:
        String representation where '*' marks the path, 'X' marks obstacles.
    """
    if path is None:
        return "null"

    path_set = set(path)
    lines = []
    for i in range(rows):
        row_parts = []
        for j in range(cols):
            if (i, j) in path_set:
                row_parts.append('*')
            elif grid[i][j] == -1:
                row_parts.append('X')
            else:
                row_parts.append(str(grid[i][j]))
        lines.append(' '.join(row_parts))
    return '\n'.join(lines)


def format_visits(grid: Grid, rows: int, cols: int, matrix: List[List[int]]) -> str:
    """
    Format a visit-count matrix for output.

    Args:
        grid: Original grid (to mark obstacles).
        rows, cols: Grid dimensions.
        matrix: Matrix of visit counts, first visits, or last visits.

    Returns:
        String representation where 'X' marks obstacles, '.' marks unvisited cells.
    """
    lines = []
    for i in range(rows):
        row_parts = []
        for j in range(cols):
            if grid[i][j] == -1:
                row_parts.append('X')
            elif matrix[i][j] == 0:
                row_parts.append('.')
            else:
                row_parts.append(str(matrix[i][j]))
        lines.append(' '.join(row_parts))
    return '\n'.join(lines)


def format_visits_padded(grid: Grid, rows: int, cols: int, matrix: List[List[int]]) -> str:
    """
    Format a visit-count matrix with right-aligned padding for cleaner output.

    Useful for first-visit and last-visit matrices where numbers may vary in width.

    Args:
        grid: Original grid (to mark obstacles).
        rows, cols: Grid dimensions.
        matrix: Matrix of visit counts.

    Returns:
        String representation with aligned columns.
    """
    # Find the max width needed
    max_width = 1
    for i in range(rows):
        for j in range(cols):
            if grid[i][j] == -1:
                max_width = max(max_width, 1)
            elif matrix[i][j] == 0:
                max_width = max(max_width, 1)
            else:
                max_width = max(max_width, len(str(matrix[i][j])))

    lines = []
    for i in range(rows):
        row_parts = []
        for j in range(cols):
            if grid[i][j] == -1:
                row_parts.append('X'.rjust(max_width))
            elif matrix[i][j] == 0:
                row_parts.append('.'.rjust(max_width))
            else:
                row_parts.append(str(matrix[i][j]).rjust(max_width))
        lines.append(' '.join(row_parts))
    return '\n'.join(lines)


def main():
    """
    Main entry point. Parse arguments and run the selected search algorithm.

    Usage:
        python pathfinder.py <mode> <map_file> <algorithm> [heuristic]

    Arguments:
        mode: 'release' (path only) or 'debug' (path + visit statistics)
        map_file: Path to the map file
        algorithm: 'bfs', 'ucs', or 'astar'
        heuristic: (for A* only) 'euclidean' or 'manhattan'

    Examples:
        python pathfinder.py release maps/fig1.txt bfs
        python pathfinder.py debug maps/fig1.txt astar manhattan
    """
    if len(sys.argv) < 4:
        print("Usage: python pathfinder.py <mode> <map_file> <algorithm> [heuristic]")
        print()
        print("Arguments:")
        print("  mode:       'release' or 'debug'")
        print("  map_file:   Path to the map file")
        print("  algorithm:  'bfs', 'ucs', or 'astar'")
        print("  heuristic:  (for A* only) 'euclidean' or 'manhattan'")
        print()
        print("Examples:")
        print("  python pathfinder.py release maps/fig1.txt bfs")
        print("  python pathfinder.py debug maps/fig1.txt astar manhattan")
        sys.exit(1)

    mode = sys.argv[1]
    map_file = sys.argv[2]
    algorithm = sys.argv[3]
    h_type = sys.argv[4] if len(sys.argv) > 4 else None

    # Validate mode
    if mode not in ['release', 'debug']:
        print(f"Error: mode must be 'release' or 'debug', got '{mode}'")
        sys.exit(1)

    # Validate algorithm
    if algorithm not in ['bfs', 'ucs', 'astar']:
        print(f"Error: algorithm must be 'bfs', 'ucs', or 'astar', got '{algorithm}'")
        sys.exit(1)

    # A* requires heuristic
    if algorithm == 'astar' and h_type is None:
        print("Error: A* requires a heuristic (euclidean or manhattan)")
        sys.exit(1)

    try:
        rows, cols, start, end, grid = parse_map(map_file)
    except FileNotFoundError:
        print(f"Error: Map file '{map_file}' not found")
        sys.exit(1)

    # Check if start or end is an obstacle
    if grid[start[0]][start[1]] == -1 or grid[end[0]][end[1]] == -1:
        if mode == 'debug':
            print("path:")
            print("null")
            print("#visits:")
            print(format_visits(grid, rows, cols, [[0]*cols for _ in range(rows)]))
            print("first visit:")
            print(format_visits_padded(grid, rows, cols, [[0]*cols for _ in range(rows)]))
            print("last visit:")
            print(format_visits_padded(grid, rows, cols, [[0]*cols for _ in range(rows)]))
        else:
            print("null")
        return

    # Run the selected algorithm
    if algorithm == 'bfs':
        path, num_visits, first_visit, last_visit = bfs(rows, cols, start, end, grid)
    elif algorithm == 'ucs':
        path, num_visits, first_visit, last_visit = ucs(rows, cols, start, end, grid)
    elif algorithm == 'astar':
        path, num_visits, first_visit, last_visit = astar(rows, cols, start, end, grid, h_type)

    # Output results
    if mode == 'release':
        print(format_path(grid, rows, cols, path))
    elif mode == 'debug':
        print("path:")
        print(format_path(grid, rows, cols, path))
        print("#visits:")
        print(format_visits(grid, rows, cols, num_visits))
        print("first visit:")
        print(format_visits_padded(grid, rows, cols, first_visit))
        print("last visit:")
        print(format_visits_padded(grid, rows, cols, last_visit))


if __name__ == '__main__':
    main()