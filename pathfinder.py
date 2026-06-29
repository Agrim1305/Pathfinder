import sys
import math
from collections import deque
import heapq


def parse_map(filepath):
    with open(filepath, 'r') as f:
        lines = f.read().strip().split('\n')

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


def get_neighbours(r, c, rows, cols, grid):
    """Return neighbours in order: UP, DOWN, LEFT, RIGHT."""
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    neighbours = []
    for dr, dc in directions:
        nr, nc = r + dr, c + dc
        if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] != -1:
            neighbours.append((nr, nc))
    return neighbours


def step_cost(grid, r1, c1, r2, c2):
    """Cost of moving from (r1,c1) to (r2,c2)."""
    elev_from = grid[r1][c1]
    elev_to = grid[r2][c2]
    return 1 + max(0, elev_to - elev_from)


def heuristic(r, c, end_r, end_c, h_type):
    if h_type == 'euclidean':
        return math.sqrt((r - end_r) ** 2 + (c - end_c) ** 2)
    elif h_type == 'manhattan':
        return abs(r - end_r) + abs(c - end_c)
    return 0


def bfs(rows, cols, start, end, grid):
    """BFS using FIFO queue. Graph search with closed set."""
    visit_counter = 0
    num_visits = [[0] * cols for _ in range(rows)]
    first_visit = [[0] * cols for _ in range(rows)]
    last_visit = [[0] * cols for _ in range(rows)]

    closed = set()
    # Each entry in fringe: (position, path)
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


def ucs(rows, cols, start, end, grid):
    """UCS using priority queue ordered by path cost g."""
    visit_counter = 0
    num_visits = [[0] * cols for _ in range(rows)]
    first_visit = [[0] * cols for _ in range(rows)]
    last_visit = [[0] * cols for _ in range(rows)]

    closed = set()
    # Priority queue entries: (cost, tie_breaker, position, path)
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


def astar(rows, cols, start, end, grid, h_type):
    """A* using priority queue ordered by f = g + h."""
    visit_counter = 0
    num_visits = [[0] * cols for _ in range(rows)]
    first_visit = [[0] * cols for _ in range(rows)]
    last_visit = [[0] * cols for _ in range(rows)]

    closed = set()
    end_r, end_c = end
    h = heuristic(start[0], start[1], end_r, end_c, h_type)
    counter = 0
    # (f, tie_breaker, g, position, path)
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


def format_path(grid, rows, cols, path):
    """Format the path output."""
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


def format_visits(grid, rows, cols, matrix):
    """Format #visits, first visit, or last visit matrix."""
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


def format_visits_padded(grid, rows, cols, matrix):
    """Format first visit or last visit with right-aligned padding."""
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
    if len(sys.argv) < 4:
        print("Usage: python pathfinder.py [mode] [map] [algorithm] [heuristic]")
        sys.exit(1)

    mode = sys.argv[1]
    map_file = sys.argv[2]
    algorithm = sys.argv[3]
    h_type = sys.argv[4] if len(sys.argv) > 4 else None

    rows, cols, start, end, grid = parse_map(map_file)

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

    if algorithm == 'bfs':
        path, num_visits, first_visit, last_visit = bfs(rows, cols, start, end, grid)
    elif algorithm == 'ucs':
        path, num_visits, first_visit, last_visit = ucs(rows, cols, start, end, grid)
    elif algorithm == 'astar':
        path, num_visits, first_visit, last_visit = astar(rows, cols, start, end, grid, h_type)
    else:
        print(f"Unknown algorithm: {algorithm}")
        sys.exit(1)

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