"""
Tests for the Pathfinder search algorithms.

Run from the project root:
    python -m unittest discover -s tests -v
"""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from pathfinder import astar, bfs, get_neighbours, parse_map, path_cost, ucs  # noqa: E402

MAPS_DIR = os.path.join(ROOT, "maps")
MAP_NAMES = ["small", "choice", "maze", "open", "large", "detour"]


def load(name):
    return parse_map(os.path.join(MAPS_DIR, f"{name}.txt"))


def grid_from_rows(rows_text):
    """Build a grid from strings like '0 0 X'. Returns (rows, cols, grid)."""
    grid = [[-1 if v == "X" else int(v) for v in line.split()] for line in rows_text]
    return len(grid), len(grid[0]), grid


def all_searches(rows, cols, start, end, grid):
    """Run every algorithm (and both A* heuristics) and return {name: result}."""
    return {
        "bfs": bfs(rows, cols, start, end, grid),
        "ucs": ucs(rows, cols, start, end, grid),
        "astar_manhattan": astar(rows, cols, start, end, grid, "manhattan"),
        "astar_euclidean": astar(rows, cols, start, end, grid, "euclidean"),
    }


class PathValidity(unittest.TestCase):
    """Every returned path must be a legal walk from start to goal."""

    def assert_valid_path(self, path, start, end, rows, cols, grid):
        self.assertIsNotNone(path)
        self.assertEqual(path[0], start)
        self.assertEqual(path[-1], end)
        for (r1, c1), (r2, c2) in zip(path, path[1:]):
            self.assertIn((r2, c2), get_neighbours(r1, c1, rows, cols, grid),
                          f"illegal step {(r1, c1)} -> {(r2, c2)}")
        self.assertEqual(len(path), len(set(path)), "path revisits a cell")

    def test_every_algorithm_returns_a_legal_path_on_every_map(self):
        for name in MAP_NAMES:
            rows, cols, start, end, grid = load(name)
            for algo, (path, *_rest) in all_searches(rows, cols, start, end, grid).items():
                with self.subTest(map=name, algorithm=algo):
                    self.assert_valid_path(path, start, end, rows, cols, grid)


class Optimality(unittest.TestCase):
    """BFS minimises steps; UCS and A* minimise elevation-aware cost."""

    def test_weighted_searches_agree_on_the_optimal_cost(self):
        for name in MAP_NAMES:
            rows, cols, start, end, grid = load(name)
            results = all_searches(rows, cols, start, end, grid)
            ucs_cost = path_cost(grid, results["ucs"][0])
            for algo in ("astar_manhattan", "astar_euclidean"):
                with self.subTest(map=name, algorithm=algo):
                    self.assertEqual(path_cost(grid, results[algo][0]), ucs_cost)

    def test_bfs_never_takes_more_steps_than_the_weighted_searches(self):
        for name in MAP_NAMES:
            rows, cols, start, end, grid = load(name)
            results = all_searches(rows, cols, start, end, grid)
            bfs_steps = len(results["bfs"][0])
            for algo in ("ucs", "astar_manhattan"):
                with self.subTest(map=name, algorithm=algo):
                    self.assertLessEqual(bfs_steps, len(results[algo][0]))

    def test_known_optimal_costs(self):
        # Locks in the figures quoted in the README results table.
        expected = {"small": 8, "choice": 14, "maze": 20, "open": 18, "large": 54, "detour": 26}
        for name, cost in expected.items():
            rows, cols, start, end, grid = load(name)
            with self.subTest(map=name):
                self.assertEqual(path_cost(grid, ucs(rows, cols, start, end, grid)[0]), cost)

    def test_demo_map_figures(self):
        # The browser demo's headline numbers: same length, 35% more effort, 59% fewer nodes.
        rows, cols, start, end, grid = load("detour")
        b, u = bfs(rows, cols, start, end, grid), ucs(rows, cols, start, end, grid)
        a = astar(rows, cols, start, end, grid, "manhattan")
        self.assertEqual(len(b[0]), len(u[0]))
        self.assertEqual((path_cost(grid, b[0]), path_cost(grid, u[0])), (35, 26))
        self.assertEqual((sum(map(sum, u[1])), sum(map(sum, a[1]))), (331, 137))

    def test_bfs_pays_more_than_optimal_on_the_large_map(self):
        rows, cols, start, end, grid = load("large")
        self.assertEqual(path_cost(grid, bfs(rows, cols, start, end, grid)[0]), 67)

    def test_weighted_search_takes_the_cheap_detour(self):
        # Going straight through the hill costs more than walking around it.
        rows, cols, grid = grid_from_rows([
            "0 9 0",
            "0 9 0",
            "0 0 0",
        ])
        path = ucs(rows, cols, (0, 0), (0, 2), grid)[0]
        self.assertNotIn((0, 1), path)
        self.assertEqual(path_cost(grid, path), 6)


class Efficiency(unittest.TestCase):
    """A* should never expand more nodes than UCS with an admissible heuristic."""

    def expansions(self, result):
        return sum(map(sum, result[1]))

    def test_astar_explores_no_more_than_ucs(self):
        for name in MAP_NAMES:
            rows, cols, start, end, grid = load(name)
            results = all_searches(rows, cols, start, end, grid)
            with self.subTest(map=name):
                self.assertLessEqual(self.expansions(results["astar_manhattan"]),
                                     self.expansions(results["ucs"]))

    def test_astar_saves_45_percent_on_the_choice_map(self):
        rows, cols, start, end, grid = load("choice")
        ucs_nodes = self.expansions(ucs(rows, cols, start, end, grid))
        astar_nodes = self.expansions(astar(rows, cols, start, end, grid, "manhattan"))
        self.assertEqual((ucs_nodes, astar_nodes), (75, 41))


class EdgeCases(unittest.TestCase):

    def test_unreachable_goal_returns_none(self):
        rows, cols, grid = grid_from_rows([
            "0 X 0",
            "0 X 0",
            "0 X 0",
        ])
        for algo, (path, *_rest) in all_searches(rows, cols, (0, 0), (0, 2), grid).items():
            with self.subTest(algorithm=algo):
                self.assertIsNone(path)

    def test_start_equals_goal(self):
        rows, cols, grid = grid_from_rows(["0 0", "0 0"])
        for algo, (path, *_rest) in all_searches(rows, cols, (1, 1), (1, 1), grid).items():
            with self.subTest(algorithm=algo):
                self.assertEqual(path, [(1, 1)])

    def test_single_cell_grid(self):
        rows, cols, grid = grid_from_rows(["4"])
        self.assertEqual(bfs(rows, cols, (0, 0), (0, 0), grid)[0], [(0, 0)])

    def test_downhill_is_cheaper_than_uphill(self):
        rows, cols, grid = grid_from_rows(["0 5"])
        self.assertEqual(path_cost(grid, [(0, 0), (0, 1)]), 6)
        self.assertEqual(path_cost(grid, [(0, 1), (0, 0)]), 1)


if __name__ == "__main__":
    unittest.main()