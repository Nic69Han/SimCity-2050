// Golden-value harness for scan.cpp (port: crates/micropolis-core/src/scan.rs).
//
// Build and run from the repository root:
//   reference/build-harness.sh reference/gold/scan_harness.cpp /tmp/scan_harness
//   /tmp/scan_harness chain  > reference/gold/scan_haight.txt
//   /tmp/scan_harness population > reference/gold/scan_population.txt
//
// "tiles" dumps the post-load tile map of haight.cty (loadFile). That dump,
// reference/gold/scan_haight_tiles.txt, is the scan input of the other modes.
// The original's loadFile result varies between processes (uninitialised reads
// in its load path; valgrind reports them), so the other modes load the dump.
//
// "chain" runs fireAnalysis, pollutionTerrainLandValueScan, crimeScan and
// computeComRateMap on that tile map, after injecting deterministic values into
// every map that the scans read but do not write. Four (donDither, seed)
// variants are run, so each dither branch of smoothDitherMap/smoothTerrain is
// covered. The injected values are a fixed formula, reproduced in the Rust test.
//
// "population" runs populationDensityScan on haight.cty. It needs the zone
// helpers (doFreePop, getResZonePop, ...) that belong to the zone module, so the
// Rust side of this section is an #[ignore]d test until that module lands.
//
// Output format (must match the Rust `dump` helper in
// crates/micropolis-core/tests/scan_gold.rs):
//   MAP <name> <W> <H>\n<values, column-major, space separated>\n
//   SCALAR <name> <value>\n
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstring>

static const char* CITY = "assets/cities/haight.cty";

// The original engine reads uninitialised memory while constructing itself
// (initGraphs / initGraphMax, found with valgrind), so its results depend on
// whatever the heap or stack held. Construct it in zeroed static storage instead;
// zero matches the Rust Simulation::new (all histories start at 0).
#include <new>
// Heap arrays (graph histories, map arrays) are also read before being written:
// zero all malloc'd memory so the reference is reproducible.
extern "C" void* malloc(size_t n) { return calloc(1, n); }
alignas(Micropolis) static unsigned char g_engine_buf[sizeof(Micropolis)];
static Micropolis& freshEngine() {
    memset(g_engine_buf, 0, sizeof g_engine_buf);
    return *new (g_engine_buf) Micropolis();
}

// Deterministic injected value for cluster (x, y) of a map.
static int pattern(int x, int y, int salt, int modulus) {
    return (x * 131 + y * 17 + salt * 29) % modulus;
}

template <class M>
static void dumpMap(const char* name, M& m) {
    printf("MAP %s %d %d\n", name, m.MAP_W, m.MAP_H);
    bool first = true;
    for (int x = 0; x < m.MAP_W; x++) {
        for (int y = 0; y < m.MAP_H; y++) {
            if (!first) putchar(' ');
            first = false;
            printf("%d", (int)m.get(x, y));
        }
    }
    putchar('\n');
}

static void scalar(const char* name, long v) {
    printf("SCALAR %s %ld\n", name, v);
}

// Same FNV-1a-like hash as reference/oracle.cpp, over the tile map.
static unsigned long long fnvTiles(Micropolis& m) {
    unsigned long long h = 1469598103934665603ULL;
    const unsigned short* p = &m.map[0][0];
    for (int i = 0; i < WORLD_W * WORLD_H; i++) {
        h ^= p[i] & 0xff; h *= 1099511628211ULL;
        h ^= p[i] >> 8;   h *= 1099511628211ULL;
    }
    return h;
}

static void dumpTiles(Micropolis& m) {
    printf("SCALAR tiles_hash %llu\n", fnvTiles(m));
}

static void dumpChainState(Micropolis& m) {
    dumpMap("fireStationMap", m.fireStationMap);
    dumpMap("fireStationEffectMap", m.fireStationEffectMap);
    dumpMap("policeStationMap", m.policeStationMap);
    dumpMap("policeStationEffectMap", m.policeStationEffectMap);
    dumpMap("populationDensityMap", m.populationDensityMap);
    dumpMap("comRateMap", m.comRateMap);
    dumpMap("landValueMap", m.landValueMap);
    dumpMap("pollutionDensityMap", m.pollutionDensityMap);
    dumpMap("crimeRateMap", m.crimeRateMap);
    dumpMap("terrainDensityMap", m.terrainDensityMap);
    dumpMap("tempMap1", m.tempMap1);
    dumpMap("tempMap2", m.tempMap2);
    dumpMap("tempMap3", m.tempMap3);
    scalar("landValueAverage", m.landValueAverage);
    scalar("pollutionAverage", m.pollutionAverage);
    scalar("crimeAverage", m.crimeAverage);
    scalar("pollutionMaxX", m.pollutionMaxX);
    scalar("pollutionMaxY", m.pollutionMaxY);
    scalar("crimeMaxX", m.crimeMaxX);
    scalar("crimeMaxY", m.crimeMaxY);
    scalar("cityCenterX", m.cityCenterX);
    scalar("cityCenterY", m.cityCenterY);
    scalar("donDither", (long)m.donDither);
    dumpTiles(m);
}

// Scan input: the post-load tile map, dumped by the "tiles" mode. Loading it
// (instead of calling loadFile) keeps both programs on identical tiles. The
// original's loadFile result varies between processes (uninitialised reads in
// its load path), so it cannot be a reproducible reference by itself.
static const char* TILE_GOLD = "reference/gold/scan_haight_tiles.txt";
static bool loadTileGold(Micropolis& m) {
    FILE* f = fopen(TILE_GOLD, "r");
    if (!f) return false;
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) {
            unsigned v;
            if (fscanf(f, "%u", &v) != 1) { fclose(f); return false; }
            m.map[x][y] = (unsigned short)v;
        }
    fclose(f);
    return true;
}

static int runChain(long dither, unsigned long seed) {
    Micropolis& m = freshEngine();
    if (!loadTileGold(m)) { fprintf(stderr, "tile load fail\n"); return 1; }

    printf("RUN dither=%ld seed=%lu\n", dither, seed);
    m.donDither = dither;
    m.nextRandom = seed;          // same point as Rust `sim.rng.seed(seed)`
    m.cityCenterX = 55;           // injected: normally set by populationDensityScan
    m.cityCenterY = 47;

    for (int x = 0; x < m.fireStationMap.MAP_W; x++)
        for (int y = 0; y < m.fireStationMap.MAP_H; y++) {
            m.fireStationMap.set(x, y, (short)pattern(x, y, 1, 1000));
            m.policeStationMap.set(x, y, (short)pattern(x, y, 2, 1000));
        }
    for (int x = 0; x < m.populationDensityMap.MAP_W; x++)
        for (int y = 0; y < m.populationDensityMap.MAP_H; y++)
            m.populationDensityMap.set(x, y, (Byte)pattern(x, y, 3, 255));
    for (int x = 0; x < m.crimeRateMap.MAP_W; x++)
        for (int y = 0; y < m.crimeRateMap.MAP_H; y++)
            m.crimeRateMap.set(x, y, (Byte)pattern(x, y, 5, 256));
    for (int x = 0; x < m.terrainDensityMap.MAP_W; x++)
        for (int y = 0; y < m.terrainDensityMap.MAP_H; y++)
            m.terrainDensityMap.set(x, y, (Byte)pattern(x, y, 4, 256));
    for (int x = 0; x < m.pollutionDensityMap.MAP_W; x++)
        for (int y = 0; y < m.pollutionDensityMap.MAP_H; y++)
            m.pollutionDensityMap.set(x, y, (Byte)pattern(x, y, 6, 256));

    m.fireAnalysis();
    m.pollutionTerrainLandValueScan();
    m.crimeScan();
    m.computeComRateMap();
    dumpChainState(m);
    return 0;
}

static int runPopulation() {
    Micropolis& m = freshEngine();
    if (!loadTileGold(m)) { fprintf(stderr, "tile load fail\n"); return 1; }
    printf("RUN population haight\n");
    m.populationDensityScan();
    dumpMap("populationDensityMap", m.populationDensityMap);
    dumpMap("comRateMap", m.comRateMap);
    dumpMap("tempMap1", m.tempMap1);
    dumpMap("tempMap2", m.tempMap2);
    scalar("cityCenterX", m.cityCenterX);
    scalar("cityCenterY", m.cityCenterY);
    dumpTiles(m);
    return 0;
}

// Blank map (no zones): populationDensityScan takes the Ztot == 0 branch and
// never calls the zone helpers, so this section can be tested on the Rust side.
static int runEmpty() {
    Micropolis& m = freshEngine();
    printf("RUN population empty\n");
    m.populationDensityScan();
    dumpMap("populationDensityMap", m.populationDensityMap);
    dumpMap("comRateMap", m.comRateMap);
    dumpMap("tempMap1", m.tempMap1);
    dumpMap("tempMap2", m.tempMap2);
    scalar("cityCenterX", m.cityCenterX);
    scalar("cityCenterY", m.cityCenterY);
    dumpTiles(m);
    return 0;
}

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: scan_harness chain|population|empty\n"); return 2; }
    if (strcmp(argv[1], "empty") == 0) return runEmpty();
    if (strcmp(argv[1], "tiles") == 0) {
        // Post-load tile map of the original (loadFile runs doSimInit: power bits,
        // road/rail characters fixed up). Used as the scan input on the Rust side.
        Micropolis& m = freshEngine();
        if (!m.loadFile(CITY)) return 1;
        for (int x = 0; x < WORLD_W; x++) {
            for (int y = 0; y < WORLD_H; y++) printf("%u ", (unsigned)m.map[x][y]);
            putchar('\n');
        }
        return 0;
    }
    // Constructing the engine seeds the RNG from this variable (oracle patch).
    setenv("MICROPOLIS_SEED", "1", 1);
    if (strcmp(argv[1], "population") == 0) return runPopulation();
    if (strcmp(argv[1], "chain") == 0) {
        // (donDither, seed): 0 = no dithering, 1 = terrain dither,
        // 6 = both smoothing dithers, 7 = all dithers.
        static const long dithers[] = {0, 1, 6, 7};
        static const unsigned long seeds[] = {42, 42, 7, 1};
        for (int i = 0; i < 4; i++) {
            int rc = runChain(dithers[i], seeds[i]);
            if (rc) return rc;
        }
        return 0;
    }
    fprintf(stderr, "unknown mode\n");
    return 2;
}
