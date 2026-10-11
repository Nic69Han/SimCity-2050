// Probe: prints numeric values of enums used by crates/micropolis-core/src/simulate.rs.
// Build: reference/build-harness.sh reference/gold/simulate_probe.cpp reference/build/simulate_probe
#define private public
#include "micropolis.h"
#undef private
#include "text.h"
#include <cstdio>

int main() {
    printf("MAP_TYPE_ALL=%d RES=%d COM=%d IND=%d POWER=%d ROAD=%d TRAFFIC=%d DYNAMIC=%d COUNT=%d\n",
           MAP_TYPE_ALL, MAP_TYPE_RES, MAP_TYPE_COM, MAP_TYPE_IND, MAP_TYPE_POWER, MAP_TYPE_ROAD,
           MAP_TYPE_TRAFFIC_DENSITY, MAP_TYPE_DYNAMIC, MAP_TYPE_COUNT);
    printf("MESSAGE_NOT_ENOUGH_POWER=%d MESSAGE_NUCLEAR_MELTDOWN=%d\n",
           MESSAGE_NOT_ENOUGH_POWER, MESSAGE_NUCLEAR_MELTDOWN);
    printf("SPRITE_SHIP=%d\n", SPRITE_SHIP);
    printf("SC_NONE=%d SC_RIO=%d SC_COUNT=%d\n", SC_NONE, SC_RIO, SC_COUNT);
    printf("LEVEL_EASY=%d LEVEL_HARD=%d CC_MEGALOPOLIS=%d\n", LEVEL_EASY, LEVEL_HARD, CC_MEGALOPOLIS);
    return 0;
}
