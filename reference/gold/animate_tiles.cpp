// Golden values for animate.cpp (animatedTiles, animateTiles, getNextAnimatedTile)
// against the ORIGINAL engine. Build and run from the repo root:
//   reference/build-harness.sh reference/gold/animate_tiles.cpp reference/build/animate_tiles
//   reference/build/animate_tiles > reference/gold/animate_tiles.out
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdint>

static uint64_t fnv(const unsigned short* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) { h ^= p[i] & 0xff; h *= 1099511628211ULL; h ^= p[i] >> 8; h *= 1099511628211ULL; }
    return h;
}

int main() {
    Micropolis m;
    for (int i = -2; i <= 1025; i++)
        printf("next %d %d\n", i, m.getNextAnimatedTile(i));

    const int N = WORLD_W * WORLD_H;
    unsigned short* p = &m.map[0][0];
    // Synthetic: every flag combination appears, over all tile characters.
    for (int i = 0; i < N; i++) p[i] = (unsigned short)((i * 37 + i / 3) & 0xffff);
    printf("synth_before %016llx\n", (unsigned long long)fnv(p, N));
    m.animateTiles();
    printf("synth_after %016llx\n", (unsigned long long)fnv(p, N));

    // Real city: raw file contents only (loadFileDir), without loadFile's
    // post-load initialisation (doSimInit etc.), which is not under test here.
    Micropolis c;
    if (!c.loadFileDir("assets/cities/haight.cty", NULL)) { printf("load fail\n"); return 1; }
    unsigned short* q = &c.map[0][0];
    printf("city_before %016llx\n", (unsigned long long)fnv(q, N));
    c.animateTiles();
    printf("city_after %016llx\n", (unsigned long long)fnv(q, N));
    return 0;
}
