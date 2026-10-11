// Reference oracle for "start a new random city": runs the ORIGINAL C++ engine's
// generateSomeCity(seed) (what the front-end's "new random city" reaches) and prints
// state fingerprints. Same line format as reference/oracle.cpp; tick 0 is right after
// generation.
// Usage: [ORACLE_DISASTERS=1] oracle_gen <seed> <ticks> [some|map]
//   some (default): generateSomeCity(seed)
//   map:            generateMap() (no seed): the seed is drawn from the generator, which
//                   the constructor leaves seeded with <seed>. generateSomeCity then
//                   reseeds through randomlySeedRandom(), which here reads the env, so the
//                   env is set to the drawn seed (a deterministic stand-in for the clock).
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>

static uint64_t fnv(const unsigned short* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) { h ^= p[i] & 0xff; h *= 1099511628211ULL; h ^= p[i] >> 8; h *= 1099511628211ULL; }
    return h;
}

int main(int argc, char** argv) {
    if (argc < 3) { fprintf(stderr, "usage: oracle_gen seed ticks [some|map]\n"); return 2; }
    int seed = atoi(argv[1]);
    bool map = argc > 3 && strcmp(argv[3], "map") == 0;
    char buf[32];
    snprintf(buf, sizeof buf, "%d", seed);
    setenv("MICROPOLIS_SEED", buf, 1); // read by randomlySeedRandom() (oracle patch)
    Micropolis m; // constructor runs simInit(), as the front-end does at startup
    m.setEnableDisasters(getenv("ORACLE_DISASTERS") != NULL); // disasters off unless ORACLE_DISASTERS=1
    if (map) {
        m.seedRandom(seed);
        int drawn = m.getRandom16(); // the seed generateMap() will draw
        snprintf(buf, sizeof buf, "%d", drawn);
        setenv("MICROPOLIS_SEED", buf, 1);
        m.seedRandom(seed);
        m.generateMap();
    } else {
        m.generateSomeCity(seed);
    }
    m.setSpeed(3);
    m.setPasses(1);
    int ticks = atoi(argv[2]);
    for (int t = 0; t <= ticks; t++) {
        if (t > 0) m.simTick();
        printf("tick %d time=%ld funds=%ld pop=%d res=%d com=%d ind=%d resV=%d comV=%d indV=%d crime=%d poll=%d lv=%d traf=%d maphash=%016llx\n",
               t, (long)m.cityTime, (long)m.totalFunds, (int)m.totalPop, (int)m.resPop, (int)m.comPop, (int)m.indPop,
               (int)m.resValve, (int)m.comValve, (int)m.indValve, (int)m.crimeAverage, (int)m.pollutionAverage,
               (int)m.landValueAverage, (int)m.trafficAverage, (unsigned long long)fnv(&m.map[0][0], WORLD_W * WORLD_H));
    }
    return 0;
}
