#!/usr/bin/env python
"""
Benchmark every algorithm on every bundled map.

Prints the path cost and the number of nodes each search expanded, so the
figures in the README can be reproduced with one command:

    python benchmark.py

Author: Agrim Sharma
"""

import os

from pathfinder import astar, bfs, parse_map, path_cost, ucs

MAPS = ["small", "choice", "maze", "open", "large", "detour"]
MAPS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "maps")


def expansions(visits):
    """Total nodes taken off the queue during a search."""
    return sum(map(sum, visits))


def main():
    header = f"{'Map':<15}{'BFS cost':>9}{'Best cost':>10}{'BFS nodes':>11}{'UCS nodes':>11}{'A* nodes':>10}{'A* saving':>11}"
    print(header)
    print("-" * len(header))
    for name in MAPS:
        rows, cols, start, end, grid = parse_map(os.path.join(MAPS_DIR, f"{name}.txt"))
        b_path, b_visits, _, _ = bfs(rows, cols, start, end, grid)
        u_path, u_visits, _, _ = ucs(rows, cols, start, end, grid)
        a_path, a_visits, _, _ = astar(rows, cols, start, end, grid, "manhattan")

        u_nodes, a_nodes = expansions(u_visits), expansions(a_visits)
        saving = 1 - a_nodes / u_nodes if u_nodes else 0
        label = f"{name} ({rows}x{cols})"
        print(f"{label:<15}{path_cost(grid, b_path):>9}{path_cost(grid, u_path):>10}"
              f"{expansions(b_visits):>11}{u_nodes:>11}{a_nodes:>10}{saving:>10.0%}")

    print()
    print("Best cost is the same for UCS and A* on every map (A* uses the Manhattan heuristic).")


if __name__ == "__main__":
    main()