// Golden values for generate.cpp (terrain generator) from the ORIGINAL engine.
//
// Build & run (from the repository root):
//   reference/build-harness.sh reference/gold/generate_maps.cpp reference/build/generate_maps
//   reference/build/generate_maps <dump_dir>
//
// For every seed in SEEDS and every combination of the four terrain options
// (tree, lake, curve, island) it runs Micropolis::generateMap(seed) and prints
// one line:
//   seed tree lake curve island hash sample
// where hash is FNV-1a-like over the 12000 tile values in storage order
// (x-major, the same function as reference/oracle.cpp) and sample is the
// tile values of row y=50 at x = 0,10,...,110.
// Seeds 42 and 1234 also dump the complete default-option
// map (terrain options -1) to <dump_dir>/map_<seed>.txt, 100 values per line,
// in storage order, for the full-map equality test.
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

static const int SEEDS[] = { 0, 1, 42, 1234, 99999 };
static const int TREE[]   = { -1, 0, 6 };
static const int LAKE[]   = { -1, 0, 6 };
static const int CURVE[]  = { -1, 0, 20 };
static const int ISLAND[] = { -1, 0, 1 };

int main(int argc, char** argv) {
    const char* dump = argc > 1 ? argv[1] : NULL;
    for (int seed : SEEDS) {
        for (int tree : TREE) for (int lake : LAKE) for (int curve : CURVE) for (int island : ISLAND) {
            Micropolis* m = new Micropolis();
            m->terrainTreeLevel = tree;
            m->terrainLakeLevel = lake;
            m->terrainCurveLevel = curve;
            m->terrainCreateIsland = island;
            m->generateMap(seed);

            unsigned short flat[WORLD_W * WORLD_H];
            for (int x = 0; x < WORLD_W; x++)
                for (int y = 0; y < WORLD_H; y++)
                    flat[x * WORLD_H + y] = m->map[x][y];
            printf("%d %d %d %d %d %016llx", seed, tree, lake, curve, island,
                   (unsigned long long)fnv(flat, WORLD_W * WORLD_H));
            for (int x = 0; x < WORLD_W; x += 10)
                printf(" %d", (int)m->map[x][50]);
            printf("\n");

            bool full_default = tree == -1 && lake == -1 && curve == -1 && island == -1;
            if (dump && full_default && (seed == 42 || seed == 1234)) {
                char path[512];
                snprintf(path, sizeof path, "%s/map_%d.txt", dump, seed);
                FILE* f = fopen(path, "w");
                for (int i = 0; i < WORLD_W * WORLD_H; i++)
                    fprintf(f, "%u%c", flat[i], (i % 100 == 99) ? '\n' : ' ');
                fclose(f);
            }
            delete m;
        }
    }
    return 0;
}
