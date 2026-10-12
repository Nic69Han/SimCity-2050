// Reference oracle for "load a city file": runs the ORIGINAL C++ engine's loadFile() on a
// payload file, then N ticks, and prints one fingerprint line per tick (tick 0 = right after
// loading). Same line format as reference/oracle_gen.cpp.
//
// The payload is a city file without its 10-byte extended header (magic MCTY, version, width,
// height): the data that loadFile reads. For 120x100 the payload is the plain .cty itself.
// The program is built per size by scripts/build-oracle-size.sh W H --load, which patches
// loadFile in the scratch copy only (expected size = the W x H payload; the map is read
// column by column, since the size oracles pad the map storage).
//
// Usage: [ORACLE_DISASTERS=1] oracle_load <seed> <ticks> <payload file>
//   <seed> seeds the generator before loadFile, as the Rust side does: load_city(bytes, seed).
//   Disasters are set after loading, as the Rust side does after load_city.
#define private public
#include "micropolis.h"
#include "text.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <vector>

// The world's tiles in column-major order (x * WORLD_H + y), independent of the map's
// storage stride (the size oracles pad the storage; see scripts/build-oracle-size.sh).
static std::vector<unsigned short> world_tiles(Micropolis& m) {
    std::vector<unsigned short> t(WORLD_W * WORLD_H);
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) t[x * WORLD_H + y] = m.map[x][y];
    return t;
}

static uint64_t fnv(const unsigned short* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) { h ^= p[i] & 0xff; h *= 1099511628211ULL; h ^= p[i] >> 8; h *= 1099511628211ULL; }
    return h;
}

int main(int argc, char** argv) {
    if (argc < 4) { fprintf(stderr, "usage: oracle_load seed ticks payload_file\n"); return 2; }
    int seed = atoi(argv[1]);
    int ticks = atoi(argv[2]);
    char buf[32];
    snprintf(buf, sizeof buf, "%d", seed);
    setenv("MICROPOLIS_SEED", buf, 1); // read by randomlySeedRandom() (oracle patch)
    Micropolis m; // constructor runs simInit(), as the front-end does at startup
    m.seedRandom(seed);
    if (!m.loadFile(argv[3])) { fprintf(stderr, "loadFile failed: %s\n", argv[3]); return 2; }
    m.setEnableDisasters(getenv("ORACLE_DISASTERS") != NULL); // disasters off unless ORACLE_DISASTERS=1
    for (int t = 0; t <= ticks; t++) {
        if (t > 0) m.simTick();
        std::vector<unsigned short> tiles = world_tiles(m);
        printf("tick %d time=%ld funds=%ld pop=%d res=%d com=%d ind=%d resV=%d comV=%d indV=%d crime=%d poll=%d lv=%d traf=%d maphash=%016llx\n",
               t, (long)m.cityTime, (long)m.totalFunds, (int)m.totalPop, (int)m.resPop, (int)m.comPop, (int)m.indPop,
               (int)m.resValve, (int)m.comValve, (int)m.indValve, (int)m.crimeAverage, (int)m.pollutionAverage,
               (int)m.landValueAverage, (int)m.trafficAverage, (unsigned long long)fnv(tiles.data(), WORLD_W * WORLD_H));
    }
    return 0;
}
