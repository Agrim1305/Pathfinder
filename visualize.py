#!/usr/bin/env python
"""
Draw the pictures used in the README.

Needs matplotlib (the search code itself has no dependencies):

    pip install matplotlib
    python visualize.py

Writes docs/routes.png and docs/explored.png.

Author: Agrim Sharma
"""

import os

import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import FancyBboxPatch

from pathfinder import astar, bfs, parse_map, path_cost, ucs

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "docs")

TERRAIN = LinearSegmentedColormap.from_list("terrain", ["#f1f4e8", "#c4d1a8", "#8fa36f"])
OBSTACLE = "#2b2b2b"
BFS_COLOUR = "#d9622b"   # orange
BEST_COLOUR = "#1f5fa8"  # blue


def draw_terrain(ax, grid, rows, cols):
    """Elevation as shading, obstacles as dark squares."""
    top = max(4, max(v for row in grid for v in row))
    shaded = [[v if v >= 0 else 0 for v in row] for row in grid]
    # Smooth shading between cell centres, to match the browser demo
    ax.imshow(shaded, cmap=TERRAIN, vmin=0, vmax=top, origin="upper", interpolation="bicubic")
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == -1:
                ax.add_patch(FancyBboxPatch((c - 0.43, r - 0.43), 0.86, 0.86,
                                            boxstyle="round,pad=0,rounding_size=0.22", color=OBSTACLE))
    ax.set_xlim(-0.5, cols - 0.5)
    ax.set_ylim(rows - 0.5, -0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)


def draw_route(ax, path, colour, offset, label):
    xs = [c + offset for _, c in path]
    ys = [r + offset for r, _ in path]
    ax.plot(xs, ys, color=colour, linewidth=2.6, solid_capstyle="round", label=label)


def mark_ends(ax, start, end):
    ax.plot(start[1], start[0], "o", color="white", markeredgecolor="black", markersize=10)
    ax.plot(end[1], end[0], "*", color="white", markeredgecolor="black", markersize=15)


def routes_figure():
    rows, cols, start, end, grid = parse_map(os.path.join(ROOT, "maps", "detour.txt"))
    bfs_path = bfs(rows, cols, start, end, grid)[0]
    best_path = astar(rows, cols, start, end, grid, "manhattan")[0]
    bfs_cost, best_cost = path_cost(grid, bfs_path), path_cost(grid, best_path)

    fig, ax = plt.subplots(figsize=(7, 7.6))
    draw_terrain(ax, grid, rows, cols)
    draw_route(ax, bfs_path, BFS_COLOUR, -0.12, f"Counts steps only (BFS): effort {bfs_cost}")
    draw_route(ax, best_path, BEST_COLOUR, 0.12, f"Lowest effort (A*): effort {best_cost}")
    mark_ends(ax, start, end)

    extra = bfs_cost / best_cost - 1
    ax.set_title(f"Ignoring the hills costs {extra:.0%} more effort",
                 fontsize=14, fontweight="bold", loc="left", pad=28)
    ax.text(0, 1.015, "Both routes take 26 steps; the orange one goes over the hill. "
                      "Darker green is higher ground.",
            transform=ax.transAxes, fontsize=9, color="#555555")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.01), ncol=1, frameon=False, fontsize=10)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "routes.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)


def explored_figure():
    rows, cols, start, end, grid = parse_map(os.path.join(ROOT, "maps", "choice.txt"))
    searches = [
        ("Dijkstra (UCS)", ucs(rows, cols, start, end, grid)),
        ("A* (Manhattan)", astar(rows, cols, start, end, grid, "manhattan")),
    ]

    fig, axes = plt.subplots(1, 2, figsize=(9, 5))
    for ax, (name, (path, visits, _, _)) in zip(axes, searches):
        draw_terrain(ax, grid, rows, cols)
        for r in range(rows):
            for c in range(cols):
                if visits[r][c]:
                    ax.plot(c, r, "o", color="#d9622b", markersize=7, alpha=0.9)
        draw_route(ax, path, BEST_COLOUR, 0.22, "Route")
        mark_ends(ax, start, end)
        ax.set_title(f"{name}\n{sum(map(sum, visits))} nodes expanded", fontsize=11)

    fig.suptitle("Same best route, 45% less searching", fontsize=14, fontweight="bold", x=0.02, ha="left")
    fig.text(0.02, 0.88, "Orange dots mark every cell each search examined. A* uses the distance to the goal to skip the hill.",
             fontsize=9, color="#555555")
    fig.tight_layout(rect=(0, 0, 1, 0.88))
    fig.savefig(os.path.join(OUT, "explored.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    routes_figure()
    explored_figure()
    print("Wrote docs/routes.png and docs/explored.png")