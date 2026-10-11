// Golden-value harness for connect.cpp (connectTile, layDoze, layRoad, layRail, layWire,
// fixZone, fixSingle), driven through the ORIGINAL ToolEffects (tool.cpp).
//
// Scenarios (argv[1]):
//   named        : a fixed list of hand-written operations on a hand-built map. Prints every
//                  tile that differs from the initial map, each op's result, and the total cost.
//   random       : 3000 operations from a deterministic LCG (see lcg below) on a random map
//                  in the 40x40 corner, auto-bulldoze on. Prints a running hash of
//                  (result, cost delta) per op and the final map hash.
//   random_noauto: as random, with autoBulldoze off.
//
// The Rust test crates/micropolis-core/tests/connect_golden.rs replays exactly the same
// initial maps and operation lists (same LCG, same order) and compares the outputs.
//
// Build & run (from repo root):
//   bash reference/build-harness.sh reference/gold/connect_golden.cpp reference/build/connect_golden
//   reference/build/connect_golden named
//   reference/build/connect_golden random
//   reference/build/connect_golden random_noauto

#define private public
#include "micropolis.h"
#undef private
#include "tool.h"
#include "text.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>

static uint64_t fnv_step(uint64_t h, uint64_t v) {
    // Hash one 64-bit value, byte by byte.
    for (int i = 0; i < 8; i++) {
        h ^= (v >> (8 * i)) & 0xff;
        h *= 1099511628211ULL;
    }
    return h;
}

static uint64_t fnv_tiles(Micropolis &m, ToolEffects &fx) {
    uint64_t h = 1469598103934665603ULL;
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++)
            h = fnv_step(h, fx.getMapValue(x, y));
    return h;
}

static uint64_t lcg_state = 0;
static uint64_t lcg_next() {
    lcg_state = lcg_state * 6364136223846793005ULL + 1442695040888963407ULL;
    return lcg_state >> 33;
}

static const int BASE_TABLE_N = 16;
static const unsigned short BASE_TABLE[BASE_TABLE_N] = {
    DIRT, DIRT, DIRT, RIVER, REDGE, CHANNEL, ROADS, ROADS2, LHRAIL, LVRAIL,
    LHPOWER, LVPOWER, HBRIDGE, VBRIDGE, TINYEXP, VPOWER,
};

static void random_map(Micropolis &m) {
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) m.map[x][y] = DIRT;
    for (int x = 0; x < 40; x++) {
        for (int y = 0; y < 40; y++) {
            unsigned short base = BASE_TABLE[lcg_next() % BASE_TABLE_N];
            unsigned short v = base;
            if (base == LHPOWER || base == LVPOWER || base == VPOWER) v |= CONDBIT;
            if (lcg_next() % 2) v |= BULLBIT | BURNBIT;
            m.map[x][y] = v;
        }
    }
}

static void apply_op(Micropolis &m, ToolEffects &fx, int x, int y, int cmd, uint64_t &hash,
                     bool print_each, int idx) {
    int before = fx.getCost();
    ToolResult r = m.connectTile(x, y, (ConnectTileCommand)cmd, &fx);
    int delta = fx.getCost() - before;
    hash = fnv_step(hash, (uint64_t)(int64_t)(int)r);
    hash = fnv_step(hash, (uint64_t)(int64_t)delta);
    if (print_each) printf("op %d x=%d y=%d cmd=%d result=%d delta=%d\n", idx, x, y, cmd, (int)r, delta);
}

static void print_changed(Micropolis &m, ToolEffects &fx, const std::vector<unsigned short> &init) {
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) {
            unsigned short now = fx.getMapValue(x, y);
            unsigned short was = init[x * WORLD_H + y];
            if (now != was) printf("changed %d %d %u\n", x, y, (unsigned)now);
        }
}

static int run_named(Micropolis &m) {
    // Hand-built map: a river row at y=30 (x=20..24), a road at (19,30), a rail at (25,30),
    // a wire at (5,5) on dirt, and a tiny-explosion tile at (50,50) with BULLBIT set.
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) m.map[x][y] = DIRT;
    for (int x = 20; x <= 24; x++) m.map[x][30] = RIVER;
    m.map[19][30] = ROADS | BULLBIT | BURNBIT;
    m.map[25][30] = LHRAIL | BULLBIT | BURNBIT;
    m.map[5][5] = LHPOWER | CONDBIT | BULLBIT | BURNBIT;
    m.map[50][50] = TINYEXP | BULLBIT;
    m.map[60][60] = ROADS2 | BULLBIT | BURNBIT;

    std::vector<unsigned short> init(WORLD_W * WORLD_H);
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) init[x * WORLD_H + y] = m.map[x][y];

    struct Op { int x, y, cmd; };
    // cmd: 0 FIX, 1 BULLDOZE, 2 ROAD, 3 RAILROAD, 4 WIRE
    const Op ops[] = {
        {10, 10, 2}, {11, 10, 2}, {12, 10, 2}, {12, 11, 2}, {12, 12, 2}, {12, 9, 2},
        {10, 11, 4}, {11, 11, 4}, {13, 10, 4}, {10, 13, 3}, {11, 13, 3}, {12, 13, 3},
        {12, 10, 3}, {11, 12, 1}, {12, 11, 1}, {10, 10, 0}, {14, 14, 1}, {9, 9, 2},
        {20, 30, 2}, {21, 30, 2}, {22, 30, 3}, {23, 30, 4}, {24, 30, 4}, {25, 30, 2},
        {19, 31, 2}, {19, 29, 3}, {20, 29, 4}, {5, 5, 2}, {5, 4, 4}, {5, 6, 3},
        {50, 50, 2}, {50, 51, 1}, {51, 50, 4}, {60, 60, 3}, {60, 61, 3}, {61, 60, 4},
        {-1, 0, 2}, {0, 100, 4}, {120, 5, 0}, {0, 0, 0}, {119, 99, 2}, {118, 99, 3},
    };
    ToolEffects fx(&m);
    uint64_t hash = 0;
    int n = sizeof(ops) / sizeof(ops[0]);
    for (int i = 0; i < n; i++) apply_op(m, fx, ops[i].x, ops[i].y, ops[i].cmd, hash, true, i);
    printf("cost %d\n", fx.getCost());
    printf("result_hash %016llx\n", (unsigned long long)hash);
    printf("map_hash %016llx\n", (unsigned long long)fnv_tiles(m, fx));
    print_changed(m, fx, init);
    return 0;
}

static void commit(Micropolis &m, ToolEffects &fx) {
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) m.map[x][y] = fx.getMapValue(x, y);
}

static int run_random(Micropolis &m, bool auto_bulldoze) {
    lcg_state = 12345;
    random_map(m);
    m.autoBulldoze = auto_bulldoze;
    std::vector<unsigned short> init(WORLD_W * WORLD_H);
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) init[x * WORLD_H + y] = m.map[x][y];

    ToolEffects fx(&m);
    uint64_t hash = 0;
    int counts[5][4] = {{0}};
    for (int i = 0; i < 3000; i++) {
        int x = (int)(lcg_next() % 44) - 2;
        int y = (int)(lcg_next() % 44) - 2;
        int cmd = (int)(lcg_next() % 5);
        int before = fx.getCost();
        ToolResult r = m.connectTile(x, y, (ConnectTileCommand)cmd, &fx);
        int delta = fx.getCost() - before;
        hash = fnv_step(hash, (uint64_t)(int64_t)(int)r);
        hash = fnv_step(hash, (uint64_t)(int64_t)delta);
        counts[cmd][(int)r + 2]++;
        // Every 50 ops, write the accumulated effects back into the world (the cost is not
        // spent: only the map evolution matters here), then start a new batch.
        if (i % 50 == 49) {
            commit(m, fx);
            fx.clear();
        }
    }
    commit(m, fx);
    fx.clear();
    printf("result_hash %016llx\n", (unsigned long long)hash);
    printf("map_hash %016llx\n", (unsigned long long)fnv_tiles(m, fx));
    for (int c = 0; c < 5; c++)
        printf("counts %d %d %d %d %d\n", c, counts[c][0], counts[c][1], counts[c][2], counts[c][3]);
    (void)init;
    return 0;
}

int main(int argc, char **argv) {
    const char *scenario = argc > 1 ? argv[1] : "named";
    Micropolis m;
    if (!m.loadFile("assets/cities/haight.cty")) {
        printf("load_fail 1\n");
        return 1;
    }
    m.setEnableDisasters(false);
    if (strcmp(scenario, "named") == 0) return run_named(m);
    if (strcmp(scenario, "random") == 0) return run_random(m, true);
    if (strcmp(scenario, "random_noauto") == 0) return run_random(m, false);
    fprintf(stderr, "unknown scenario\n");
    return 2;
}
