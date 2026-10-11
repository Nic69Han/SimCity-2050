// Golden values for Simulation::new_random_city and generate_map: the random stream
// and a few counters right after the ORIGINAL generateSomeCity(seed) (entry=some) and
// generateMap() (entry=map, see reference/oracle_gen.cpp), for the RNG-dependent part of
// new-city state that the fingerprint lines (empty city) do not expose.
// Build and run from the repo root:
//   reference/build-harness.sh reference/gold/newcity_rng.cpp reference/build/newcity_rng
//   reference/build/newcity_rng > reference/gold/newcity_rng.out
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdlib>

int main() {
    const int seeds[] = {1, 2, 3, 7, 42, 1234};
    for (int map = 0; map < 2; map++)
    for (int seed : seeds) {
        char buf[16];
        snprintf(buf, sizeof buf, "%d", seed);
        setenv("MICROPOLIS_SEED", buf, 1);
        Micropolis m;
        m.setEnableDisasters(false);
        if (map) {
            m.seedRandom(seed);
            snprintf(buf, sizeof buf, "%d", m.getRandom16());
            setenv("MICROPOLIS_SEED", buf, 1);
            m.seedRandom(seed);
            m.generateMap();
        } else {
            m.generateSomeCity(seed);
        }
        int dirt = 0;
        for (int x = 0; x < WORLD_W; x++)
            for (int y = 0; y < WORLD_H; y++)
                if (m.map[x][y] == DIRT) dirt++;
        printf("entry=%s seed=%d dirt=%d totalFunds=%ld cityTime=%ld tax=%d", map ? "map" : "some", seed, dirt,
               (long)m.totalFunds,
               (long)m.cityTime, (int)m.cityTax);
        for (int i = 0; i < 6; i++) printf(" r=%d", (int)m.getRandom16());
        printf("\n");
    }
    return 0;
}
