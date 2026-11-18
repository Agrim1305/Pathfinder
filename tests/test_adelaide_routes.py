"""Check the Adelaide demo's searches against NetworkX, an independent library.

The browser code in docs/adelaide/graph.js runs under Node on 300 seeded random
pairs of junctions; this test compares every answer with NetworkX on the same
graph. Skipped if Node or NetworkX is not installed.

    python -m unittest tests.test_adelaide_routes -v
"""
import json
import math
import pathlib
import shutil
import subprocess
import unittest

try:
    import networkx as nx
except ImportError:  # pragma: no cover
    nx = None

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAIRS = 300
TOL = 1e-6  # metres


@unittest.skipIf(nx is None or shutil.which("node") is None, "needs networkx and node")
class AdelaideRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(ROOT / "tests" / "adelaide_routes.js"), str(PAIRS), "7"],
                             check=True, capture_output=True, text=True).stdout
        data = json.loads(out)
        cls.runs, cls.coords = data["runs"], data["coords"]
        cls.edges = data["edges"]
        G = nx.Graph()
        for a, b, w in cls.edges:  # keep the shorter of any parallel segments
            if not G.has_edge(a, b) or G[a][b]["w"] > w:
                G.add_edge(a, b, w=w)
        cls.G = G
        cls.pairs = [r for r in cls.runs if r["s"] != r["t"]]

    def test_graph_is_one_connected_network(self):
        self.assertEqual(nx.number_connected_components(self.G), 1)

    def test_dijkstra_matches_networkx(self):
        for r in self.pairs:
            ref = nx.dijkstra_path_length(self.G, r["s"], r["t"], weight="w")
            self.assertAlmostEqual(r["ucs"]["dist"], ref, delta=TOL, msg=r)

    def test_astar_is_exact(self):
        # A* must return the same distance as Dijkstra on every pair.
        for r in self.pairs:
            self.assertAlmostEqual(r["astar"]["dist"], r["ucs"]["dist"], delta=TOL, msg=(r["s"], r["t"]))

    def test_bfs_finds_fewest_segments(self):
        for r in self.pairs:
            self.assertEqual(r["bfs"]["segments"], nx.shortest_path_length(self.G, r["s"], r["t"]), msg=(r["s"], r["t"]))

    def test_paths_are_real_walks(self):
        # Every returned path starts and ends at the pins and only uses existing segments.
        for r in self.pairs:
            for alg in ("bfs", "ucs", "astar"):
                p = r[alg]["path"]
                self.assertEqual((p[0], p[-1]), (r["s"], r["t"]))
                for a, b in zip(p, p[1:]):
                    self.assertTrue(self.G.has_edge(a, b), msg=(alg, a, b))

    def test_astar_never_expands_more_than_dijkstra(self):
        for r in self.pairs:
            self.assertLessEqual(r["astar"]["expanded"], r["ucs"]["expanded"], msg=(r["s"], r["t"]))

    def test_heuristic_is_consistent(self):
        # Regression test: the straight line between a segment's ends must not
        # exceed the segment's length. When lengths were measured on unrounded
        # points this failed by up to 0.7 m and A* returned slightly longer routes.
        worst = 0.0
        for a, b, w in self.edges:
            (ax, ay), (bx, by) = self.coords[a], self.coords[b]
            worst = max(worst, math.hypot(ax - bx, ay - by) - w)
        self.assertLessEqual(worst, TOL)


if __name__ == "__main__":
    unittest.main()
