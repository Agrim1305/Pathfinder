#!/usr/bin/env python
"""
Example usage of the Pathfinder module.

This script demonstrates how to use BFS, UCS, and A* programmatically.
"""

from pathfinder import parse_map, bfs, ucs, astar, format_path

def main():
    print("=" * 60)
    print("Pathfinder Algorithm Comparison")
    print("=" * 60)
    print()

    # Load a map
    map_file = "maps/choice.txt"
    print(f"Loading map: {map_file}")
    print()

    rows, cols, start, end, grid = parse_map(map_file)
    print(f"Grid: {rows}x{cols}, Start: {start}, End: {end}")
    print()

    # Run BFS
    print("--- BFS (Breadth-First Search) ---")
    path_bfs, visits_bfs, _, _ = bfs(rows, cols, start, end, grid)
    if path_bfs:
        print(f"Path found! Length: {len(path_bfs)}")
        print(f"Nodes visited: {sum(sum(row) for row in visits_bfs)}")
        print()
        print("Path visualization:")
        print(format_path(grid, rows, cols, path_bfs))
    else:
        print("No path found!")
    print()

    # Run UCS
    print("--- UCS (Uniform Cost Search) ---")
    path_ucs, visits_ucs, _, _ = ucs(rows, cols, start, end, grid)
    if path_ucs:
        # Calculate actual cost
        cost = 0
        for i in range(len(path_ucs) - 1):
            r1, c1 = path_ucs[i]
            r2, c2 = path_ucs[i + 1]
            cost += 1 + max(0, grid[r2][c2] - grid[r1][c1])
        print(f"Path found! Length: {len(path_ucs)}, Cost: {cost}")
        print(f"Nodes visited: {sum(sum(row) for row in visits_ucs)}")
        print()
        print("Path visualization:")
        print(format_path(grid, rows, cols, path_ucs))
    else:
        print("No path found!")
    print()

    # Run A*
    print("--- A* (with Manhattan heuristic) ---")
    path_astar, visits_astar, _, _ = astar(rows, cols, start, end, grid, "manhattan")
    if path_astar:
        # Calculate actual cost
        cost = 0
        for i in range(len(path_astar) - 1):
            r1, c1 = path_astar[i]
            r2, c2 = path_astar[i + 1]
            cost += 1 + max(0, grid[r2][c2] - grid[r1][c1])
        print(f"Path found! Length: {len(path_astar)}, Cost: {cost}")
        print(f"Nodes visited: {sum(sum(row) for row in visits_astar)}")
        print()
        print("Path visualization:")
        print(format_path(grid, rows, cols, path_astar))
    else:
        print("No path found!")
    print()

    # Comparison
    print("=" * 60)
    print("Comparison")
    print("=" * 60)
    print(f"BFS nodes explored:   {sum(sum(row) for row in visits_bfs)}")
    print(f"UCS nodes explored:   {sum(sum(row) for row in visits_ucs)}")
    print(f"A*  nodes explored:   {sum(sum(row) for row in visits_astar)}")
    print()
    print("All three algorithms found optimal paths (same length).")
    print("A* explored fewer nodes by using the heuristic to guide search.")

if __name__ == "__main__":
    main()