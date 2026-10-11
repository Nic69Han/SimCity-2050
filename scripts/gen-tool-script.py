#!/usr/bin/env python3
"""Deterministic generator of player-action scripts for the tool differential tests.

Two modes, both writing a `.tools` script to stdout:

1. Random mode (scripts/compare-tools.sh, assets/scripts/seed*.tools):
       gen-tool-script.py <seed> <ticks> <n_actions>
   Covers every EditingTool except Query (5): every tool gets at least one `down` and
   one `drag`; line drags use horizontal, vertical, diagonal (both diagonals, both
   signs) and general directions; positions span the whole 120x100 map, borders
   included, plus a few off-map coordinates.

2. Starter mode (scripts/compare-newcity-tools.sh, assets/scripts/starter_<seed>.tools):
       gen-tool-script.py --starter <seed> --map <dump> [--ticks 3000]
   A player builds a city on the terrain of a NEW random city. <dump> is the tile map
   written by the oracle right after generation:
       ORACLE_DUMP_MAP=<dump> reference/build/oracle_gen <seed> 0
   (W*H values, column-major: index = x * H + y; W x H is given by --size WxH, default
   120x100). The generator finds the largest
   site of dirt/trees (no water, two tiles from the map edge) that holds a grid of city
   blocks, then plans, in game ticks:
     * tick 1-2   probes: a zone on a tree (needs clearing) and a zone on water;
                  bulldoze the plant site;
     * tick 3     coal power plant at the corner of the site; a wire from it along the
                  east side of the site, down to the road grid; tick 400 a residential
                  zone is clicked on the plant by mistake;
     * per block  (blocks in row-major order, the first three at ticks 10, 120, 260, then
                  one every 200 ticks from 300): bulldoze the interior, lay roads on the
                  four edges, run power lines along the same edges, zone the four corners
                  (residential, commercial, industrial by a seeded draw; police/fire
                  stations replace a corner in blocks 1 and 2);
     * ticks 1500 stadium next to the plant, parks in gaps of blocks 4, 7, 10, 13 (and
                  one park per 200 ticks once the blocks run out), a bulldozer click on a
                  zone at tick 1700 (a player demolishing a building).
   All coordinates and the draw use only <seed> and the map, so the same arguments always
   give the same file. The checked-in starter scripts were made from the dumps of the
   oracle for seeds 1, 2, 3, 7, 42 (see scripts/compare-newcity-tools.sh).
   Other sizes: --size WxH with the oracle built for that size (scripts/build-oracle-size.sh):
       ORACLE_DUMP_MAP=<dump> reference/build/oracle_gen_WxH <seed> 0
       gen-tool-script.py --starter <seed> --map <dump> --size WxH [--ticks 3000]
   The generator's coordinates (block grid, bulldozer clicks, off-map probes) follow the size.

Uses its own LCG (no `random` module), so the same arguments always give the same file.
"""
import argparse
import sys

MASK64 = (1 << 64) - 1
WORLD_W, WORLD_H = 120, 100
TOOL_QUERY = 5
# EditingTool indices (crates/micropolis-core/src/tool.rs, reference/micropolis-cpp/micropolis.h)
TOOLS = [t for t in range(20) if t != TOOL_QUERY]
TOOL_RES, TOOL_COM, TOOL_IND, TOOL_FIRE, TOOL_POLICE = 0, 1, 2, 3, 4
TOOL_WIRE, TOOL_BULLDOZER, TOOL_ROAD, TOOL_STADIUM, TOOL_PARK, TOOL_COAL = 6, 7, 9, 10, 11, 13
# Tools that place a multi-tile building; a drag only places the end point.
BIG_TOOLS = {0, 1, 2, 3, 4, 10, 12, 13, 14, 15}
# Line tools that a drag is meant for (roads, rail, wire, bulldozer).
LINE_TOOLS = {6, 7, 8, 9}

# Tile values (crates/micropolis-core/src/tile_chars.rs); the low 10 bits are the tile.
LOMASK = 0x3FF
WATER_LOW, WATER_HIGH = 2, 20
WOODS_LOW, WOODS_HIGH = 21, 39
DIRT = 0

# Starter city layout (tiles, relative to the site origin (x0, y0)).
ROAD_PITCH = 8      # roads every 8 tiles: a block is 7x7 between its roads
ROAD_OFFSET = 6     # first road column/row at site + 6
MAX_BLOCKS = 16
BLOCK_TICKS = [10, 120, 260]  # the first three blocks; then one block every 200 ticks from 300
BLOCK_PERIOD = 200
BLOCK_FIRST_PERIODIC = 300
STADIUM_TICK = 1500
DEMOLISH_TICK = 1700
PARK_BLOCKS = (4, 7, 10, 13)
POLICE_BLOCK, FIRE_BLOCK = 1, 2


class Lcg:
    """64-bit LCG (Knuth MMIX constants); returns the high bits."""

    def __init__(self, seed):
        self.state = (seed * 0x9E3779B97F4A7C15 + 0x2545F4914F6CDD1D) & MASK64

    def next(self):
        self.state = (self.state * 6364136223846793005 + 1442695040888963407) & MASK64
        return self.state >> 33

    def below(self, n):
        return self.next() % n

    def chance(self, pct):
        return self.below(100) < pct

    def between(self, lo, hi):
        return lo + self.below(hi - lo + 1)

    def choice(self, seq):
        return seq[self.below(len(seq))]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def position(rng):
    """A tile: mostly on the map, often on a border, rarely off the map."""
    roll = rng.below(100)
    if roll < 3:  # a few off-map coordinates
        return (rng.choice([-2, -1, WORLD_W, WORLD_W + 1]), rng.choice([-2, -1, WORLD_H, WORLD_H + 1]))
    if roll < 25:  # border tiles
        if rng.chance(50):
            return (rng.choice([0, 1, WORLD_W - 2, WORLD_W - 1]), rng.between(0, WORLD_H - 1))
        return (rng.between(0, WORLD_W - 1), rng.choice([0, 1, WORLD_H - 2, WORLD_H - 1]))
    return (rng.between(0, WORLD_W - 1), rng.between(0, WORLD_H - 1))


def drag_end(rng, x0, y0, shape):
    """End point of a drag from (x0, y0) for the given shape."""
    if shape == "h":
        dx, dy = rng.between(1, 45) * rng.choice([1, -1]), 0
    elif shape == "v":
        dx, dy = 0, rng.between(1, 45) * rng.choice([1, -1])
    elif shape == "d":  # diagonal, |dx| == |dy|; sign pattern covers both diagonals
        k = rng.between(1, 30)
        dx, dy = k * rng.choice([1, -1]), k * rng.choice([1, -1])
    elif shape == "z":  # zero-length drag: start equals end
        dx, dy = 0, 0
    else:  # general direction, both coordinates change unevenly
        dx, dy = rng.between(-40, 40), rng.between(-40, 40)
    x1 = clamp(x0 + dx, -2, WORLD_W + 1)
    y1 = clamp(y0 + dy, -2, WORLD_H + 1)
    return x1, y1


SHAPES = ["h", "v", "d", "g", "z"]


def drag_shape_for(rng, tool):
    if tool in LINE_TOOLS:
        # Line tools: mostly straight or diagonal lines, a few general and zero-length ones.
        return rng.choice(["h", "h", "v", "v", "d", "d", "g", "z"])
    return rng.choice(SHAPES)


def make_action(rng, tool, kind):
    if kind == "down":
        x, y = position(rng)
        return ("down", tool, x, y)
    x0, y0 = position(rng)
    x1, y1 = drag_end(rng, x0, y0, drag_shape_for(rng, tool))
    return ("drag", tool, x0, y0, x1, y1)


def random_script(seed, ticks, n_actions):
    rng = Lcg(seed)
    actions = []  # (tick, action)

    # Phase 1: every tool gets one click and one drag, so coverage never depends on luck.
    for tool in TOOLS:
        for kind in ("down", "drag"):
            if len(actions) >= n_actions:
                break
            actions.append((rng.below(ticks), make_action(rng, tool, kind)))

    # Phase 2: random actions over all tools, clicks about 40% of the time.
    while len(actions) < n_actions:
        tool = rng.choice(TOOLS)
        kind = "down" if rng.chance(40) else "drag"
        actions.append((rng.below(ticks), make_action(rng, tool, kind)))

    # Actions are applied in file order; sort by tick, keeping generation order within a tick.
    actions.sort(key=lambda ta: ta[0])

    lines = [
        f"# generated by scripts/gen-tool-script.py seed={seed} ticks={ticks} actions={n_actions}",
        "# <tick> down <tool> <x> <y> | <tick> drag <tool> <x0> <y0> <x1> <y1>",
    ]
    for tick, act in actions:
        if act[0] == "down":
            _, tool, x, y = act
            lines.append(f"{tick} down {tool} {x} {y}")
        else:
            _, tool, x0, y0, x1, y1 = act
            lines.append(f"{tick} drag {tool} {x0} {y0} {x1} {y1}")
    return lines


# ---------------------------------------------------------------------------
# Starter city
# ---------------------------------------------------------------------------


def read_map(path):
    """The oracle's tile dump: WORLD_W * WORLD_H values, column-major (x * WORLD_H + y)."""
    with open(path) as f:
        tiles = [int(v) & LOMASK for v in f.read().split()]
    if len(tiles) != WORLD_W * WORLD_H:
        sys.exit(f"{path}: expected {WORLD_W * WORLD_H} tile values, got {len(tiles)}")
    return tiles


def tile_at(tiles, x, y):
    return tiles[x * WORLD_H + y]


def is_water(t):
    return WATER_LOW <= t <= WATER_HIGH


def is_land(t):
    """Dirt, or woods that the game clears when the player builds on it."""
    return t == DIRT or WOODS_LOW <= t <= WOODS_HIGH


def find_site(tiles):
    """The site (x0, y0, blocks_across, blocks_down) that holds the most blocks.

    The site needs (7 + 8 * across) x (7 + 8 * down) land tiles, two tiles from the edge.
    Ties keep the first site in scan order (x, then y), so the choice is deterministic.
    """
    # 2D prefix sums of "not usable land", so any rectangle is checked in O(1).
    pre = [[0] * (WORLD_H + 1) for _ in range(WORLD_W + 1)]
    for x in range(WORLD_W):
        for y in range(WORLD_H):
            bad = 0 if is_land(tile_at(tiles, x, y)) else 1
            pre[x + 1][y + 1] = pre[x][y + 1] + pre[x + 1][y] - pre[x][y] + bad

    def all_land(x0, y0, w, h):
        x1, y1 = x0 + w, y0 + h
        return pre[x1][y1] - pre[x0][y1] - pre[x1][y0] + pre[x0][y0] == 0

    best = None
    for x0 in range(2, WORLD_W - 2):
        for y0 in range(2, WORLD_H - 2):
            for across in range(1, 9):
                w = 7 + ROAD_PITCH * across
                if x0 + w > WORLD_W - 2:
                    break
                for down in range(1, 9):
                    h = 7 + ROAD_PITCH * down
                    if y0 + h > WORLD_H - 2:
                        break
                    if not all_land(x0, y0, w, h):
                        break  # a taller site is not all land either
                    score = min(across * down, MAX_BLOCKS)
                    if best is None or score > best[0]:
                        best = (score, x0, y0, across, down)
    if best is None:
        sys.exit("no land site for a city: the map has no 7x7 dirt/tree area")
    _, x0, y0, across, down = best
    return x0, y0, across, down


def find_water_probe(tiles):
    """A tile whose 3x3 neighbourhood is all water: a zone there cannot be built."""
    for x in range(2, WORLD_W - 2):
        for y in range(2, WORLD_H - 2):
            if all(is_water(tile_at(tiles, x + dx, y + dy)) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                return x, y
    return None


def block_tick(k):
    """Tick at which block k (row-major order) is built."""
    if k < len(BLOCK_TICKS):
        return BLOCK_TICKS[k]
    return BLOCK_FIRST_PERIODIC + BLOCK_PERIOD * (k - len(BLOCK_TICKS))


def zone_tool_for(rng):
    """Residential 5, commercial 3, industrial 2 out of 10."""
    roll = rng.below(10)
    if roll < 5:
        return TOOL_RES
    if roll < 8:
        return TOOL_COM
    return TOOL_IND


def starter_script(seed, tiles, ticks):
    rng = Lcg(seed)
    x0, y0, across, down = find_site(tiles)
    n_blocks = min(across * down, MAX_BLOCKS)
    # Blocks in row-major order; block k sits at column k % across, row k // across.
    cols = [x0 + ROAD_OFFSET + ROAD_PITCH * j for j in range(across)]
    rows = [y0 + ROAD_OFFSET + ROAD_PITCH * i for i in range(down)]

    acts = []  # (tick, line); stable sort by tick keeps the order of creation

    def down_(t, tool, x, y):
        acts.append((t, f"{t} down {tool} {x} {y}"))

    def drag_(t, tool, ax, ay, bx, by):
        acts.append((t, f"{t} drag {tool} {ax} {ay} {bx} {by}"))

    # Probes at tick 1: a zone on the first corner of block 0 if its site has trees (the
    # game asks for clearing or clears it), and a zone on water (cannot be built).
    if any(WOODS_LOW <= tile_at(tiles, cols[0] + 2 + dx, rows[0] + 2 + dy) <= WOODS_HIGH
           for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
        down_(1, TOOL_RES, cols[0] + 2, rows[0] + 2)
    water = find_water_probe(tiles)
    if water:
        down_(1, TOOL_COM, *water)

    # Plant site: bulldoze the 4x4 plant, its wire column and the stadium site (x0+1..x0+5).
    for y in range(y0 + 1, y0 + 13):
        drag_(2, TOOL_BULLDOZER, x0 + 1, y, x0 + 5, y)
    # Coal power plant (4x4 covers click-1 .. click+2); its east side is column x0+5.
    down_(3, TOOL_COAL, x0 + 2, y0 + 2)
    drag_(4, TOOL_WIRE, x0 + 5, y0 + 2, x0 + 5, y0 + 12)
    # A mis-click: a residential zone on the finished plant (the site is occupied).
    if 400 <= ticks:
        down_(400, TOOL_RES, x0 + 2, y0 + 2)

    last_block_tick = 0
    for k in range(n_blocks):
        t = block_tick(k)
        if t > ticks:
            break
        last_block_tick = t
        bx, by = cols[k % across], rows[k // across]
        # Interior 7x7 (the edges are roads from neighbouring blocks, never bulldozed).
        for y in range(by + 1, by + 8):
            drag_(t, TOOL_BULLDOZER, bx + 1, y, bx + 7, y)
        # Roads on the four edges of the block, then power lines along the same edges.
        edges = [
            (bx, by, bx + 8, by),          # top
            (bx, by + 8, bx + 8, by + 8),  # bottom
            (bx, by, bx, by + 8),          # left
            (bx + 8, by, bx + 8, by + 8),  # right
        ]
        for ax, ay, bxx, byy in edges:
            drag_(t + 1, TOOL_ROAD, ax, ay, bxx, byy)
        for ax, ay, bxx, byy in edges:
            drag_(t + 2, TOOL_WIRE, ax, ay, bxx, byy)
        # Zones on the four corners (3x3 each, centred at +2 / +6 from the block origin).
        corners = [(bx + 2, by + 2), (bx + 6, by + 2), (bx + 2, by + 6), (bx + 6, by + 6)]
        for c, (cx, cy) in enumerate(corners):
            if k == POLICE_BLOCK and c == 3:
                tool = TOOL_POLICE
            elif k == FIRE_BLOCK and c == 3:
                tool = TOOL_FIRE
            else:
                tool = zone_tool_for(rng)
            down_(t + 3, tool, cx, cy)
        if k in PARK_BLOCKS:
            down_(t + 3, TOOL_PARK, bx + 4, by + 4)  # the gap in the middle of the block

    # Stadium next to the plant (4x4 at click-1 .. click+2), powered by the wire column.
    if STADIUM_TICK <= ticks:
        down_(STADIUM_TICK, TOOL_STADIUM, x0 + 2, y0 + 10)
    # Demolition: a player bulldozes one zone (the top-right corner of block 1).
    if n_blocks >= 2 and DEMOLISH_TICK <= ticks:
        down_(DEMOLISH_TICK, TOOL_BULLDOZER, cols[1] + 6, rows[0] + 2)
    # Once the blocks run out, one park per 200 ticks in the gaps of built blocks.
    t = last_block_tick + BLOCK_PERIOD
    spare = 0
    while t <= ticks:
        if n_blocks > 0:
            k = spare % n_blocks
            down_(t, TOOL_PARK, cols[k % across] + 4, rows[k // across] + 4)
        spare += 1
        t += BLOCK_PERIOD

    acts.sort(key=lambda ta: ta[0])
    header = [
        f"# starter city for seed={seed}, generated by scripts/gen-tool-script.py --starter",
        f"# site x0={x0} y0={y0} blocks={across}x{down} built={n_blocks} (plant at {x0 + 2},{y0 + 2})",
        "# <tick> down <tool> <x> <y> | <tick> drag <tool> <x0> <y0> <x1> <y1>",
    ]
    return header + [line for _, line in sorted(acts, key=lambda ta: ta[0])]


def parse_size(text):
    """`WxH` -> (W, H); the oracle's own limits (80x67 minimum, 512x512 maximum)."""
    try:
        w, h = (int(v) for v in text.lower().split("x"))
    except ValueError:
        raise argparse.ArgumentTypeError(f"size must be WxH, got {text!r}")
    if not (80 <= w <= 512 and 67 <= h <= 512):
        raise argparse.ArgumentTypeError(f"size {w}x{h} outside 80x67 .. 512x512")
    return w, h


def main(argv):
    global WORLD_W, WORLD_H
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("args", nargs="*", type=int, help="random mode: <seed> <ticks> <n_actions>")
    parser.add_argument("--starter", type=int, metavar="SEED", help="starter city mode")
    parser.add_argument("--map", metavar="DUMP", help="starter mode: the oracle_gen map dump")
    parser.add_argument("--ticks", type=int, default=3000, help="starter mode: last tick of the script")
    parser.add_argument("--size", type=parse_size, default=(120, 100), metavar="WxH",
                        help="world size of the map and of the oracle (default 120x100)")
    opts = parser.parse_args(argv)
    WORLD_W, WORLD_H = opts.size

    if opts.starter is not None:
        if opts.args or not opts.map:
            parser.error("starter mode takes --starter SEED --map DUMP [--ticks N]")
        if opts.ticks < 1:
            parser.error("--ticks must be positive")
        lines = starter_script(opts.starter, read_map(opts.map), opts.ticks)
    else:
        if len(opts.args) != 3 or opts.map or opts.ticks != 3000:
            parser.error("random mode takes <seed> <ticks> <n_actions>")
        seed, ticks, n_actions = opts.args
        if ticks < 1 or n_actions < 1:
            parser.error("ticks and n_actions must be positive")
        lines = random_script(seed, ticks, n_actions)
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1:])
