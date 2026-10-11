// Golden values for traffic.cpp (makeTraffic and helpers), produced by the
// ORIGINAL engine. Build and run from the repository root:
//
//   reference/build-harness.sh reference/gold/traffic_gold.cpp /tmp/traffic_gold
//   /tmp/traffic_gold > traffic_gold.out
//
// Output: a Rust array literal (copied into tests/traffic_gold.rs), plus
// comment lines starting with "//" that report map state and whether the
// heavy-traffic helicopter branch ran (that branch needs the sprite module, so
// a Rust test must not contain such a case).
//
// Each case: variant (0 = makeTraffic(x,y), 1 = makeTraffic(Position),
// 2 = makeTrafficAt(x,y), which does NOT clear the position stack), start
// position, destination zone, return value, position-stack pointer after the
// call, number of road tiles with non-zero traffic density, and an FNV hash of
// the whole traffic density map (per tile).
//
// The city is the raw tile section of assets/cities/haight.cty (no doSimInit,
// see load_raw_tiles). The RNG is seeded once (4242) after loading, so the call sequence
// is part of the golden data. The density map is cleared before every call
// (heavy traffic would otherwise be reached with accumulated density).
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

static uint64_t density_hash(Micropolis &m, int *nonzero) {
    uint64_t h = 1469598103934665603ULL;
    int nz = 0;
    for (int x = 0; x < WORLD_W; x++) {
        for (int y = 0; y < WORLD_H; y++) {
            unsigned v = m.trafficDensityMap.worldGet(x, y);
            if (v) nz++;
            h ^= v;
            h *= 1099511628211ULL;
        }
    }
    if (nonzero) *nonzero = nz;
    return h;
}

// Loads the tile section of a .cty file into m.map, exactly as loadFile reads
// it, but without doSimInit (which changes power/status bits after the read).
// The traffic and disaster functions only use the tile bits from the file.
static bool load_raw_tiles(Micropolis &m, const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return false;
    unsigned char buf[27120];
    size_t n = fread(buf, 1, sizeof buf, f);
    fclose(f);
    if (n != sizeof buf) return false;
    const unsigned char *t = buf + 3120; // 6 histories of 240 shorts + 120 misc shorts
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) {
            int i = x * WORLD_H + y;
            m.map[x][y] = (unsigned short)((t[2 * i] << 8) | t[2 * i + 1]);
        }
    return true;
}

int main() {
    setenv("MICROPOLIS_SEED", "1", 1);
    Micropolis m;
    if (!load_raw_tiles(m, "assets/cities/haight.cty")) {
        printf("// load fail\n");
        return 1;
    }
    printf("// map hash = 0x%016llxULL\n", (unsigned long long)fnv(&m.map[0][0], WORLD_W * WORLD_H));

    m.seedRandom(4242);

    int total = 0, ok = 0, heavy = 0;
    printf("type Case = (i32, i32, i32, i32, i32, i32, i32, u64);\n");
    printf("pub const CASES: &[Case] = &[\n");
    int step = 0;
    for (int x = 0; x < WORLD_W; x += 6) {
        for (int y = 0; y < WORLD_H; y += 5) {
            int variant = step % 3;
            int dest = (step / 3) % 3;
            step++;

            m.trafficDensityMap.clear();
            m.trafMaxX = -1;
            m.trafMaxY = -1;

            short ret = 0;
            if (variant == 0) {
                ret = m.makeTraffic(x, y, (ZoneType)dest);
            } else if (variant == 1) {
                Position p;
                p.posX = x;
                p.posY = y;
                ret = m.makeTraffic(p, (ZoneType)dest);
            } else {
                ret = m.makeTrafficAt(x, y, (ZoneType)dest);
            }

            if (m.trafMaxX != -1) {
                heavy++;
                printf("// HEAVY at variant=%d x=%d y=%d dest=%d\n", variant, x, y, dest);
            }

            int nz = 0;
            uint64_t h = density_hash(m, &nz);
            printf("    (%d, %d, %d, %d, %d, %d, %d, 0x%016llxu64),\n",
                   variant, x, y, dest, (int)ret, (int)m.curMapStackPointer, nz, (unsigned long long)h);
            total++;
            if (ret == 1) ok++;
        }
    }
    printf("];\n");
    printf("// cases=%d connected=%d heavy=%d\n", total, ok, heavy);
    printf("// final map hash = 0x%016llxULL (must equal the initial hash)\n",
           (unsigned long long)fnv(&m.map[0][0], WORLD_W * WORLD_H));
    return 0;
}
