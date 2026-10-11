// Reference oracle: runs the ORIGINAL C++ engine and prints state fingerprints.
// Usage: [ORACLE_DISASTERS=1] oracle <city.cty> <seed> <ticks> [dump_dir]
// Prints one line per tick: "tick N key=value ..." so Rust can be diffed line by line.
// With dump_dir, also writes <dump_dir>/map_<N>.txt (12000 tile values, column-major).
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstdint>

static uint64_t fnv(const unsigned short* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) { h ^= p[i] & 0xff; h *= 1099511628211ULL; h ^= p[i] >> 8; h *= 1099511628211ULL; }
    return h;
}

int main(int argc, char** argv) {
    if (argc < 4) { fprintf(stderr, "usage: oracle city.cty seed ticks [dump_dir]\n"); return 2; }
    setenv("MICROPOLIS_SEED", argv[2], 1); // read by randomlySeedRandom() (oracle patch)
    Micropolis m;
    if (!m.loadFile(argv[1])) { printf("load fail\n"); return 1; }
    m.setEnableDisasters(getenv("ORACLE_DISASTERS") != NULL); // env ORACLE_DISASTERS=1 enables them
    m.setSpeed(3);
    m.setPasses(1);
    int ticks = atoi(argv[3]);
    const char* dump = argc > 4 ? argv[4] : NULL;
    for (int t = 0; t <= ticks; t++) {
        if (t > 0) m.simTick();
        printf("tick %d time=%ld funds=%ld pop=%d res=%d com=%d ind=%d resV=%d comV=%d indV=%d crime=%d poll=%d lv=%d traf=%d maphash=%016llx\n",
               t, (long)m.cityTime, (long)m.totalFunds, (int)m.totalPop, (int)m.resPop, (int)m.comPop, (int)m.indPop,
               (int)m.resValve, (int)m.comValve, (int)m.indValve, (int)m.crimeAverage, (int)m.pollutionAverage,
               (int)m.landValueAverage, (int)m.trafficAverage, (unsigned long long)fnv(&m.map[0][0], WORLD_W * WORLD_H));
        if (dump) {
            char path[512]; snprintf(path, sizeof path, "%s/map_%d.txt", dump, t);
            FILE* f = fopen(path, "w");
            for (int i = 0; i < WORLD_W * WORLD_H; i++) fprintf(f, "%u\n", (&m.map[0][0])[i]);
            fclose(f);
        }
    }
    return 0;
}
