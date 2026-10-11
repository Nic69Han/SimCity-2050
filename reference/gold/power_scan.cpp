// Golden-value harness for power.cpp (doPowerScan / pushPowerStack / pullPowerStack / testForConductive).
//
// Scenarios (argv[1]):
//   haight   : assets/cities/haight.cty. Sequence as at the start of one simulate pass
//              (simulate.cpp): loadFile -> setValves -> clearCensus -> mapScan(0, WORLD_W)
//              (mapScan seeds the power stack from POWERPLANT/NUCLEAR tiles) -> doPowerScan.
//   no_power : haight, then coal = nuclear = 0 so doPowerScan exits early (sendMessage path).
//   custom   : hand-built grid on top of the loaded city (see custom_grid()). Disconnected
//              islands, a cycle, a branch and a non-conductive neighbour, with two seeds.
//
// Build & run (from repo root):
//   bash reference/build-harness.sh reference/gold/power_scan.cpp reference/build/power_scan
//   MICROPOLIS_SEED=1 reference/build/power_scan haight
//   MICROPOLIS_SEED=1 reference/build/power_scan custom
//
// Output is "key value" lines. The Rust test crates/micropolis-core/tests/power_golden.rs
// embeds these values.

#define private public
#include "micropolis.h"
#undef private
#include "text.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>

static uint64_t fnv_bytes(const unsigned char *p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) {
        h ^= p[i];
        h *= 1099511628211ULL;
    }
    return h;
}

static uint64_t fnv_tiles(const unsigned short *p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) {
        h ^= p[i] & 0xff;
        h *= 1099511628211ULL;
        h ^= p[i] >> 8;
        h *= 1099511628211ULL;
    }
    return h;
}

// Hash of the CONDBIT plane, column-major, one byte per tile.
static uint64_t condbit_hash(Micropolis &m) {
    unsigned char plane[WORLD_W * WORLD_H];
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++)
            plane[x * WORLD_H + y] = (m.map[x][y] & CONDBIT) ? 1 : 0;
    return fnv_bytes(plane, WORLD_W * WORLD_H);
}

static void dump_stack(Micropolis &m) {
    printf("stack_pointer %d\n", m.powerStackPointer);
    for (int i = 1; i <= m.powerStackPointer; i++) {
        printf("stack %d %d %d\n", i, m.powerStackXY[i].posX, m.powerStackXY[i].posY);
    }
}

static void run_power_scan(Micropolis &m, bool list_powered) {
    m.doPowerScan();

    int powered = 0;
    unsigned char bytes[WORLD_W * WORLD_H];
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) {
            int v = m.powerGridMap.worldGet(x, y);
            powered += v ? 1 : 0;
            bytes[x * WORLD_H + y] = (unsigned char)v;
        }
    printf("power_count %d\n", powered);
    printf("power_hash %016llx\n", (unsigned long long)fnv_bytes(bytes, WORLD_W * WORLD_H));
    printf("stack_pointer_after %d\n", m.powerStackPointer);
    if (list_powered) {
        for (int x = 0; x < WORLD_W; x++)
            for (int y = 0; y < WORLD_H; y++)
                if (m.powerGridMap.worldGet(x, y)) printf("powered %d %d\n", x, y);
    }
}

static void custom_grid(Micropolis &m) {
    // Start from dirt everywhere.
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++)
            m.map[x][y] = DIRT;

    const unsigned short WIRE = CONDBIT | BURNBIT | BULLBIT;
    // Horizontal wire row y=10, x=10..40, with a vertical branch at x=25 down to y=30.
    for (int x = 10; x <= 40; x++) m.map[x][10] = LHPOWER | WIRE;
    for (int y = 11; y <= 30; y++) m.map[25][y] = LVPOWER | WIRE;
    // Unseeded island y=50, x=5..9.
    for (int x = 5; x <= 9; x++) m.map[x][50] = LHPOWER | WIRE;
    // Cycle: 2x2 block of conductive road-on-power tiles at (60..61, 60..61).
    m.map[60][60] = HROADPOWER | WIRE;
    m.map[61][60] = HROADPOWER | WIRE;
    m.map[60][61] = VROADPOWER | WIRE;
    m.map[61][61] = VROADPOWER | WIRE;
    // Diagonal-only conductive tile at (70,70): not reachable by cardinal steps.
    m.map[70][70] = HPOWER | WIRE;
    // Non-conductive road next to the row end at (41,10): must stay unpowered.
    m.map[41][10] = ROADS;

    m.coalPowerPop = 1;
    m.nuclearPowerPop = 0;
    m.powerStackPointer = 0;
    m.pushPowerStack(Position(10, 10));
    m.pushPowerStack(Position(60, 60));
}

int main(int argc, char **argv) {
    const char *scenario = argc > 1 ? argv[1] : "haight";

    Micropolis m;
    if (!m.loadFile("assets/cities/haight.cty")) {
        printf("load_fail 1\n");
        return 1;
    }
    m.setEnableDisasters(false);

    if (strcmp(scenario, "custom") == 0) {
        custom_grid(m);
        printf("map_hash %016llx\n", (unsigned long long)fnv_tiles(&m.map[0][0], WORLD_W * WORLD_H));
        printf("condbit_hash %016llx\n", (unsigned long long)condbit_hash(m));
        printf("coal %d\n", (int)m.coalPowerPop);
        printf("nuclear %d\n", (int)m.nuclearPowerPop);
        dump_stack(m);
        run_power_scan(m, true);
        return 0;
    }

    printf("loaded_map_hash %016llx\n", (unsigned long long)fnv_tiles(&m.map[0][0], WORLD_W * WORLD_H));
    if (getenv("DUMP_TILES")) {
        // Debug aid: raw little-endian u16 tiles, column-major, right after loadFile.
        FILE *f = fopen(getenv("DUMP_TILES"), "wb");
        fwrite(&m.map[0][0], sizeof(unsigned short), WORLD_W * WORLD_H, f);
        fclose(f);
    }
    printf("loaded_condbit_hash %016llx\n", (unsigned long long)condbit_hash(m));
    printf("loaded_coal %d\n", (int)m.coalPowerPop);
    printf("loaded_nuclear %d\n", (int)m.nuclearPowerPop);

    m.setValves();
    m.clearCensus();
    m.mapScan(0, WORLD_W);

    printf("scan_map_hash %016llx\n", (unsigned long long)fnv_tiles(&m.map[0][0], WORLD_W * WORLD_H));
    printf("scan_condbit_hash %016llx\n", (unsigned long long)condbit_hash(m));
    printf("scan_coal %d\n", (int)m.coalPowerPop);
    printf("scan_nuclear %d\n", (int)m.nuclearPowerPop);
    dump_stack(m);

    if (strcmp(scenario, "no_power") == 0) {
        m.coalPowerPop = 0;
        m.nuclearPowerPop = 0;
    }

    run_power_scan(m, false);
    printf("message_not_enough_power %d\n", (int)MESSAGE_NOT_ENOUGH_POWER);
    return 0;
}
