// Golden values for disasters.cpp, produced by the ORIGINAL engine.
// Build and run from the repository root:
//
//   reference/build-harness.sh reference/gold/disasters_gold.cpp <scratch>/disasters_gold
//   <scratch>/disasters_gold > disasters_gold.out
//
// Each scenario loads the tile section of assets/cities/haight.cty into a fresh
// engine (no doSimInit, see load()), seeds the RNG and runs one function step
// by step. Each step prints a tuple
// (FNV-1a-style hash of the whole tile map, aux1, aux2, aux3) where aux values
// are floodCount, disasterWait and disasterEvent, as stated per scenario. The
// output is a Rust source fragment for tests/disasters_gold.rs.
//
// Scenarios that would reach not-yet-ported code are avoided on purpose:
// - doDisasters is run with enableDisasters off, so only the scenario part runs
//   (its random disasters reach makeTornado / makeMonster).
// - doFlood runs on a copy with every ZONEBIT cleared, so fireZone is never called.
// - makeFireBombs (makeExplosion) is not run; makeMeltdown is run only if the
//   city has no nuclear plant (reported in a comment).
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstdint>

static uint64_t fnv(const unsigned short *p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) {
        h ^= p[i] & 0xff;
        h *= 1099511628211ULL;
        h ^= p[i] >> 8;
        h *= 1099511628211ULL;
    }
    return h;
}

static uint64_t map_hash(Micropolis &m) {
    return fnv(&m.map[0][0], WORLD_W * WORLD_H);
}

// Loads the tile section of haight.cty into m.map, exactly as loadFile reads
// it, but without doSimInit (which changes power/status bits after the read).
// The disaster functions only use the tile bits from the file.
static void load(Micropolis &m, unsigned seed) {
    FILE *f = fopen("assets/cities/haight.cty", "rb");
    if (!f) {
        printf("// load fail\n");
        exit(1);
    }
    unsigned char buf[27120];
    size_t n = fread(buf, 1, sizeof buf, f);
    fclose(f);
    if (n != sizeof buf) {
        printf("// load fail\n");
        exit(1);
    }
    const unsigned char *t = buf + 3120; // 6 histories of 240 shorts + 120 misc shorts
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) {
            int i = x * WORLD_H + y;
            m.map[x][y] = (unsigned short)((t[2 * i] << 8) | t[2 * i + 1]);
        }
    m.setEnableDisasters(false); // set per scenario below where needed
    m.seedRandom(seed);
}

static void print_steps(const char *name, Micropolis &m, int steps, void (*step)(Micropolis &, int)) {
    printf("pub const %s: &[(u64, i32, i32, i32)] = &[\n", name);
    for (int i = 0; i < steps; i++) {
        step(m, i);
        printf("    (0x%016llxu64, %d, %d, %d),\n", (unsigned long long)map_hash(m),
               (int)m.floodCount, (int)m.disasterWait, (int)m.disasterEvent);
    }
    printf("];\n");
}

static void step_set_fire(Micropolis &m, int) { m.setFire(); }
static void step_make_fire(Micropolis &m, int) { m.makeFire(); }
static void step_make_flood(Micropolis &m, int) { m.makeFlood(); }
static void step_make_earthquake(Micropolis &m, int) { m.makeEarthquake(); }
static void step_do_flood(Micropolis &m, int i) {
    if (i % 70 == 0) m.floodCount = 30;
    Position p;
    p.posX = (i * 37) % WORLD_W;
    p.posY = (i * 53) % WORLD_H;
    m.doFlood(p);
}
static void step_do_disasters(Micropolis &m, int) { m.doDisasters(); }

int main() {
    setenv("MICROPOLIS_SEED", "1", 1);

    {
        Micropolis m;
        load(m, 777);
        printf("// map hash after load = 0x%016llxULL\n", (unsigned long long)map_hash(m));
        print_steps("SET_FIRE", m, 80, step_set_fire);
    }
    {
        Micropolis m;
        load(m, 778);
        print_steps("MAKE_FIRE", m, 60, step_make_fire);
    }
    {
        Micropolis m;
        load(m, 779);
        print_steps("MAKE_FLOOD", m, 40, step_make_flood);
    }
    {
        // haight has no river edge (tiles 5..20), so makeFlood would never act.
        // Add a row of river-edge tiles across y = 50 to give it targets.
        Micropolis m;
        load(m, 785);
        for (int x = 0; x < WORLD_W; x++)
            m.map[x][50] = 10;
        print_steps("MAKE_FLOOD_RIVER", m, 40, step_make_flood);
    }
    {
        Micropolis m;
        load(m, 780);
        print_steps("MAKE_EARTHQUAKE", m, 6, step_make_earthquake);
    }
    {
        Micropolis m;
        load(m, 781);
        int nuclear = 0;
        for (int x = 0; x < WORLD_W; x++)
            for (int y = 0; y < WORLD_H; y++)
                if ((m.map[x][y] & LOMASK) == NUCLEAR) nuclear++;
        printf("// nuclear tiles in haight = %d (makeMeltdown is a no-op only if 0)\n", nuclear);
        m.makeMeltdown();
        printf("pub const MAKE_MELTDOWN: &[(u64, i32, i32, i32)] = &[\n");
        printf("    (0x%016llxu64, %d, %d, %d),\n", (unsigned long long)map_hash(m),
               (int)m.floodCount, (int)m.disasterWait, (int)m.disasterEvent);
        printf("];\n");
    }
    {
        // doFlood on a copy with no zone centres (so fireZone is not reached).
        Micropolis m;
        load(m, 782);
        for (int x = 0; x < WORLD_W; x++)
            for (int y = 0; y < WORLD_H; y++)
                m.map[x][y] &= ~ZONEBIT;
        m.floodCount = 0;
        print_steps("DO_FLOOD", m, 300, step_do_flood);
    }
    {
        // Rio: makeFlood on every 24th wait (no random disasters, see header).
        Micropolis m;
        load(m, 783);
        m.setEnableDisasters(false);
        m.disasterEvent = SC_RIO;
        m.disasterWait = 50;
        m.floodCount = 3;
        print_steps("DO_DISASTERS_RIO", m, 60, step_do_disasters);
    }
    {
        // San Francisco: earthquake when disasterWait == 1, then the event ends.
        Micropolis m;
        load(m, 784);
        m.setEnableDisasters(false);
        m.disasterEvent = SC_SAN_FRANCISCO;
        m.disasterWait = 1;
        print_steps("DO_DISASTERS_SF", m, 4, step_do_disasters);
    }
    {
        // Pure tables over every tile value.
        Micropolis m;
        load(m, 1);
        uint64_t hv = 1469598103934665603ULL, hr = 1469598103934665603ULL;
        int nv = 0, nr = 0;
        for (int v = 0; v < 65536; v++) {
            bool a = m.vulnerable(v);
            bool b = m.roadTest((MapValue)v);
            nv += a;
            nr += b;
            hv ^= a; hv *= 1099511628211ULL;
            hr ^= b; hr *= 1099511628211ULL;
        }
        printf("pub const VULNERABLE_HASH: (u64, i32) = (0x%016llxu64, %d);\n",
               (unsigned long long)hv, nv);
        printf("pub const ROAD_TEST_HASH: (u64, i32) = (0x%016llxu64, %d);\n",
               (unsigned long long)hr, nr);
    }
    return 0;
}
