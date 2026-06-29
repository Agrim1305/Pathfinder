#!/usr/bin/env python
"""
Map generator for the Pathfinder project.

Produces elevation-grid maps in the format expected by pathfinder.py:
    Line 1: rows cols
    Line 2: start_row start_col  (1-indexed)
    Line 3: end_row end_col      (1-indexed)
    Lines 4+: grid cells (space-separated). Integers = elevation, 'X' = obstacle.
Lines starting with '#' are comments and are ignored by the parser.

Run this to regenerate the bundled maps, or tweak the parameters to make your own.

Author: Agrim Sharma
"""

import os
import random


def write_map(path, rows, cols, start, end, grid, description):
    """Write a grid to disk in the pathfinder map format.

    Args:
        path: Output file path.
        rows, cols: Grid dimensions.
        start, end: 1-indexed (row, col) tuples for start and goal.
        grid: 2D list of cells. Integers are elevations; the string 'X' is an obstacle.
        description: Short human-readable note written as a comment header.
    """
    with open(path, 'w') as f:
        f.write(f"# {description}\n")
        f.write("# Line 1: rows cols | Line 2: start | Line 3: end\n")
        f.write("# Cells: integers = elevation, X = obstacle\n")
        f.write(f"{rows} {cols}\n")
        f.write(f"{start[0]} {start[1]}\n")
        f.write(f"{end[0]} {end[1]}\n")
        for row in grid:
            f.write(' '.join(str(cell) for cell in row) + '\n')


def make_small_demo():
    """A 5x5 grid with one wall and mild elevation. Good for a quick visual demo."""
    grid = [
        [0, 0, 0, 1, 1],
        [0, 'X', 0, 1, 2],
        [0, 'X', 0, 0, 2],
        [0, 'X', 'X', 0, 1],
        [0, 0, 0, 0, 0],
    ]
    return 5, 5, (1, 1), (5, 5), grid, "Small demo: 5x5 with a wall and gentle elevation"


def make_elevation_choice():
    """An 8x8 grid where the short route climbs a hill and a longer route stays flat.

    This is the map that best illustrates the difference between BFS, UCS, and A*:
    BFS takes the fewest *steps* (over the hill), while UCS/A* prefer the longer but
    cheaper flat route around it.
    """
    grid = [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 5, 5, 5, 5, 5, 5, 0],
        [0, 5, 9, 9, 9, 9, 5, 0],
        [0, 5, 9, 9, 9, 9, 5, 0],
        [0, 5, 9, 9, 9, 9, 5, 0],
        [0, 5, 5, 5, 5, 5, 5, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
    ]
    return 8, 8, (1, 1), (8, 8), grid, "Elevation choice: cheap flat detour vs costly climb (BFS vs UCS/A*)"


def make_maze():
    """A 11x11 maze with corridors carved through walls. Tests obstacle navigation."""
    n = 11
    # Start with everything walkable (elevation 0)
    grid = [[0 for _ in range(n)] for _ in range(n)]
    # Lay down a set of internal walls leaving a guaranteed path
    walls = [
        (1, 1), (1, 2), (1, 3), (1, 5), (1, 7), (1, 8), (1, 9),
        (3, 1), (3, 3), (3, 4), (3, 5), (3, 6), (3, 7), (3, 9),
        (5, 1), (5, 2), (5, 3), (5, 5), (5, 7), (5, 9),
        (7, 1), (7, 3), (7, 4), (7, 5), (7, 6), (7, 7), (7, 9),
        (9, 1), (9, 3), (9, 5), (9, 6), (9, 7), (9, 9),
        (2, 5), (4, 9), (6, 5), (8, 3),
    ]
    for (r, c) in walls:
        grid[r][c] = 'X'
    # Keep start and goal clear
    grid[0][0] = 0
    grid[n - 1][n - 1] = 0
    return n, n, (1, 1), (n, n), grid, "Maze: 11x11 with walls; tests obstacle navigation"


def make_open_field():
    """A 10x10 open grid, no obstacles, flat. Baseline for comparing node expansion."""
    grid = [[0 for _ in range(10)] for _ in range(10)]
    return 10, 10, (1, 1), (10, 10), grid, "Open field: 10x10 flat, no obstacles (baseline)"


def make_large_terrain(seed=42):
    """A 20x20 grid with random elevation and scattered obstacles.

    Larger scale shows A* exploring noticeably fewer nodes than UCS.
    Uses a fixed seed so the map is reproducible.
    """
    random.seed(seed)
    n = 20
    grid = [[0 for _ in range(n)] for _ in range(n)]
    for r in range(n):
        for c in range(n):
            roll = random.random()
            if roll < 0.12:
                grid[r][c] = 'X'          # ~12% obstacles
            else:
                grid[r][c] = random.randint(0, 4)  # elevation 0-4
    # Guarantee start and goal are open
    grid[0][0] = 0
    grid[n - 1][n - 1] = 0
    return n, n, (1, 1), (n, n), grid, "Large terrain: 20x20 random elevation + obstacles (seed 42)"


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "maps")
    os.makedirs(out_dir, exist_ok=True)

    generators = {
        "small.txt": make_small_demo,
        "choice.txt": make_elevation_choice,
        "maze.txt": make_maze,
        "open.txt": make_open_field,
        "large.txt": make_large_terrain,
    }

    for filename, gen in generators.items():
        rows, cols, start, end, grid, desc = gen()
        path = os.path.join(out_dir, filename)
        write_map(path, rows, cols, start, end, grid, desc)
        print(f"Wrote {path}  ({rows}x{cols})  {desc}")

    print("\nDone. Try:")
    print("  python pathfinder.py release maps/choice.txt astar manhattan")


if __name__ == "__main__":
    main()