// Golden trace for sprite.cpp (module `sprite`).
//
// Runs the ORIGINAL engine on assets/cities/haight.cty, creates sprites in a
// fixed scenario, calls moveObjects() N times and prints, after every step,
// the tile-map hash and every active sprite in list order.
// The Rust test crates/micropolis-core/tests/sprite_golden.rs reproduces the
// same trace and compares it with reference/gold-out files (see the test).
//
// Build:  reference/build-harness.sh reference/gold/sprite_trace.cpp reference/build/sprite_trace
// Run:    reference/build/sprite_trace <scenario> <steps> > out.txt
//
// Scenarios: train copter airplane tornado monster explosion bus ship ship_sf lists
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>

static const int SEED = 1234;

static uint64_t fnv(const unsigned short* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) { h ^= p[i] & 0xff; h *= 1099511628211ULL; h ^= p[i] >> 8; h *= 1099511628211ULL; }
    return h;
}

static void dump(Micropolis& m, int step) {
    printf("step %d cycle %d map %016llx\n", step, (int)m.spriteCycle,
           (unsigned long long)fnv(&m.map[0][0], WORLD_W * WORLD_H));
    for (SimSprite* s = m.spriteList; s != NULL; s = s->next) {
        printf("  t%d f%d x%d y%d dx%d dy%d ox%d oy%d c%d s%d d%d nd%d st%d fl%d ct%d tu%d ac%d sp%d xh%d yh%d\n",
               s->type, s->frame, s->x, s->y, s->destX, s->destY, s->origX, s->origY,
               s->count, s->soundCount, s->dir, s->newDir, s->step, s->flag,
               s->control, s->turn, s->accel, s->speed, s->xHot, s->yHot);
    }
}

// First tile (x-major, then y) whose low bits lie in [lo, hi].
static bool findTile(Micropolis& m, int lo, int hi, int* fx, int* fy) {
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) {
            int t = m.map[x][y] & LOMASK;
            if (t >= lo && t <= hi) { *fx = x; *fy = y; return true; }
        }
    return false;
}

// Pure helpers on a grid of inputs (scenario "pure").
static void pure(Micropolis& m) {
    for (int p = 0; p <= 9; p++)
        for (int d = 0; d <= 9; d++)
            printf("turn %d %d -> %d\n", p, d, (int)m.turnTo(p, d));
    const int c[5] = { -50, 0, 40, 700, 1900 };
    for (int a = 0; a < 5; a++)
        for (int b = 0; b < 5; b++)
            for (int e = 0; e < 5; e++)
                for (int f = 0; f < 5; f++) {
                    int z = m.getDir(c[a], c[b], c[e], c[f]);
                    printf("dir %d %d %d %d -> %d abs %d\n", c[a], c[b], c[e], c[f], z, m.absDist);
                    printf("dist %d %d %d %d -> %d\n", c[a], c[b], c[e], c[f],
                           m.getDistance(c[a], c[b], c[e], c[f]));
                }
    const int tp[6] = { 0, 5, POWERBASE, POWERBASE + 1, RAILBASE, RAILBASE + 1 };
    for (int i = 0; i < 6; i++)
        for (int o = 0; o <= 9; o++)
            for (int n = 0; n <= 9; n++)
                printf("other %d %d %d -> %d\n", tp[i], o, n, (int)m.tryOther(tp[i], o, n));
    for (int a = 0; a < 5; a++)
        for (int b = 0; b < 5; b++)
            printf("char %d %d -> %d\n", c[a], c[b], (int)m.getChar(c[a], c[b]));
}

int main(int argc, char** argv) {
    if (argc < 3) { fprintf(stderr, "usage: sprite_trace scenario steps\n"); return 2; }
    const char* scen = argv[1];
    int steps = atoi(argv[2]);

    // Reproducible randomness during loadFile() (oracle patch in random.cpp).
    char seedbuf[32];
    snprintf(seedbuf, sizeof seedbuf, "%d", SEED);
    setenv("MICROPOLIS_SEED", seedbuf, 1);

    Micropolis m;
    if (!m.loadFile("assets/cities/haight.cty")) { printf("load fail\n"); return 1; }

    m.seedRandom(SEED);
    // loadFile() runs the city simulation, which may leave sprites on the list
    // (doAirport). Unlink them all so both sides start from an empty list.
    while (m.spriteList != NULL) m.destroySprite(m.spriteList);
    m.spriteCycle = 0;
    m.simSpeed = 3;
    m.doAnimation = true;
    m.pollutionMaxX = 60;
    m.pollutionMaxY = 50;
    m.enableDisasters = false;
    m.scenario = SC_NONE;

    int fx = 0, fy = 0;

    if (!strcmp(scen, "pure")) {
        pure(m);
        return 0;
    }

    if (!strcmp(scen, "startmap")) {
        // The post-load state that every other scenario starts from. loadFile()
        // runs doSimInit() (power/pollution scans set tile bits and fill the
        // traffic and rate-of-growth maps), so this is not the raw .cty content.
        // Output: 12000 bare lines = map tiles, x-major (same order as the Rust
        // Vec<Tile>); then "traffic x y v" and "rate x y v" for nonzero cells.
        for (int x = 0; x < WORLD_W; x++)
            for (int y = 0; y < WORLD_H; y++)
                printf("%d\n", (int)m.map[x][y]);
        for (int x = 0; x < WORLD_W; x++)
            for (int y = 0; y < WORLD_H; y++) {
                int v = m.trafficDensityMap.worldGet(x, y);
                if (v != 0) printf("traffic %d %d %d\n", x, y, v);
            }
        for (int x = 0; x < WORLD_W; x++)
            for (int y = 0; y < WORLD_H; y++) {
                int v = m.rateOfGrowthMap.worldGet(x, y);
                if (v != 0) printf("rate %d %d %d\n", x, y, v);
            }
        return 0;
    }

    if (!strcmp(scen, "train")) {
        // haight.cty has no rail: lay a straight horizontal track at y = 30.
        for (int x = 10; x <= 100; x++) m.map[x][30] = HRAIL;
        m.makeSprite(SPRITE_TRAIN, (12 << 4) + 8, (30 << 4) + 8);
    } else if (!strcmp(scen, "copter")) {
        m.makeSprite(SPRITE_HELICOPTER, 60 << 4, 50 << 4);
    } else if (!strcmp(scen, "airplane")) {
        m.generatePlane(Position(20, 20));
    } else if (!strcmp(scen, "tornado")) {
        m.makeSprite(SPRITE_TORNADO, 40 << 4, 40 << 4);
    } else if (!strcmp(scen, "monster")) {
        m.makeSprite(SPRITE_MONSTER, (60 << 4) + 48, 50 << 4);
    } else if (!strcmp(scen, "explosion")) {
        m.makeExplosion(40, 40);
    } else if (!strcmp(scen, "bus")) {
        if (!findTile(m, ROADBASE, LASTROAD, &fx, &fy)) { printf("no road\n"); return 1; }
        m.makeSprite(SPRITE_BUS, fx << 4, fy << 4);
    } else if (!strcmp(scen, "ship") || !strcmp(scen, "ship_sf")) {
        if (!strcmp(scen, "ship_sf")) m.scenario = SC_SAN_FRANCISCO;
        // haight.cty has no channel: lay a straight channel at y = 40.
        for (int x = 10; x <= 60; x++) m.map[x][40] = CHANNEL;
        m.makeSprite(SPRITE_SHIP, 10 << 4, 40 << 4);
    } else if (!strcmp(scen, "none")) {
        // Baseline: the state straight after loadFile, no sprites, no edits.
    } else if (!strcmp(scen, "lists")) {
        m.makeExplosion(10, 10);
        m.makeExplosion(30, 10);
        m.makeExplosion(50, 10);
        // Destroy the middle one of the active list (index 1 in list order).
        SimSprite* mid = m.spriteList->next;
        m.destroySprite(mid);
        m.makeExplosion(70, 10);
        m.makeExplosion(90, 10);
    } else {
        fprintf(stderr, "unknown scenario %s\n", scen);
        return 2;
    }

    dump(m, 0);
    for (int t = 1; t <= steps; t++) {
        m.moveObjects();
        dump(m, t);
    }
    return 0;
}
