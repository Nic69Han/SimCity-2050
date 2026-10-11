// Golden snapshots of cityEvaluation() on a real city.
//
// Loads assets/cities/haight.cty, runs the original simulation (no disasters,
// speed 3, seed from MICROPOLIS_SEED), and at the ticks given on the command
// line writes the evaluation inputs (census, maps, RNG state), then calls the
// original cityEvaluation() and writes its outputs.
//
// Run from the repository root, through the fixed-slot oracle (see
// build-fixed-oracle.sh):
//   reference/gold/build-fixed-oracle.sh reference/gold/evaluate_haight.cpp reference/build/evaluate_haight
//   MICROPOLIS_SEED=42 reference/build/evaluate_haight 1 40 150 300 > crates/micropolis-core/tests/data/evaluate_haight.txt
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdlib>

#define LL(x) ((long long)(x))
static const int LV_W = 60, LV_H = 50;

static void snapshot(Micropolis& m, int tick) {
    printf("snapshot %d\n", tick);
    printf("totalPop %lld\nresPop %lld\ncomPop %lld\nindPop %lld\nfirePop %lld\n", LL(m.totalPop), LL(m.resPop),
           LL(m.comPop), LL(m.indPop), LL(m.firePop));
    printf("roadTotal %lld\nrailTotal %lld\npoliceStationPop %lld\nfireStationPop %lld\nhospitalPop %lld\n",
           LL(m.roadTotal), LL(m.railTotal), LL(m.policeStationPop), LL(m.fireStationPop), LL(m.hospitalPop));
    printf("stadiumPop %lld\nseaportPop %lld\nairportPop %lld\ncoalPowerPop %lld\nnuclearPowerPop %lld\n",
           LL(m.stadiumPop), LL(m.seaportPop), LL(m.airportPop), LL(m.coalPowerPop), LL(m.nuclearPowerPop));
    printf("crimeAverage %lld\npollutionAverage %lld\nlandValueAverage %lld\ncityTax %lld\n", LL(m.crimeAverage),
           LL(m.pollutionAverage), LL(m.landValueAverage), LL(m.cityTax));
    printf("cityPop %lld\ncityPopDelta %lld\npoweredZoneCount %lld\nunpoweredZoneCount %lld\n", LL(m.cityPop),
           LL(m.cityPopDelta), LL(m.poweredZoneCount), LL(m.unpoweredZoneCount));
    printf("resValve %lld\ncomValve %lld\nindValve %lld\n", LL(m.resValve), LL(m.comValve), LL(m.indValve));
    printf("resCap %d\ncomCap %d\nindCap %d\n", m.resCap ? 1 : 0, m.comCap ? 1 : 0, m.indCap ? 1 : 0);
    printf("roadEffect %lld\npoliceEffect %lld\nfireEffect %lld\ncityScore %lld\n", LL(m.roadEffect),
           LL(m.policeEffect), LL(m.fireEffect), LL(m.cityScore));
    printf("rng %llu\n", (unsigned long long)(m.nextRandom & 0xffffffffULL));
    printf("lv");
    unsigned char* lv = m.landValueMap.getBase();
    for (int i = 0; i < LV_W * LV_H; i++) printf(" %u", (unsigned)lv[i]);
    printf("\ntr");
    unsigned char* tr = m.trafficDensityMap.getBase();
    for (int i = 0; i < LV_W * LV_H; i++) printf(" %u", (unsigned)tr[i]);
    printf("\n");

    // Original cityEvaluation (on the fixed-slot oracle).
    m.evalChanged = false;
    m.cityEvaluation();
    printf("out_cityYes %lld\nout_cityScore %lld\nout_cityScoreDelta %lld\n", LL(m.cityYes), LL(m.cityScore),
           LL(m.cityScoreDelta));
    printf("out_cityPop %lld\nout_cityPopDelta %lld\nout_cityClass %lld\nout_cityAssessedValue %lld\n",
           LL(m.cityPop), LL(m.cityPopDelta), LL(m.cityClass), LL(m.cityAssessedValue));
    printf("out_trafficAverage %lld\nout_evalChanged %d\n", LL(m.trafficAverage), m.evalChanged ? 1 : 0);
    printf("out_problemVotes");
    for (int k = 0; k < PROBNUM; k++) printf(" %lld", LL(m.problemVotes[k]));
    printf("\nout_problemOrder");
    for (int k = 0; k < CVP_PROBLEM_COMPLAINTS; k++) printf(" %lld", LL(m.problemOrder[k]));
    printf("\nout_rng %lld\n", LL(m.getRandom16()));
    printf("end\n");
}

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: evaluate_haight tick...\n"); return 2; }
    Micropolis m;
    if (!m.loadFile("assets/cities/haight.cty")) { fprintf(stderr, "load fail\n"); return 1; }
    m.setEnableDisasters(false);
    m.setSpeed(3);
    m.setPasses(1);
    int last = atoi(argv[argc - 1]);
    int next = 1;
    for (int t = 1; t <= last; t++) {
        m.simTick();
        for (int a = 1; a < argc; a++) {
            if (atoi(argv[a]) == t) snapshot(m, t);
        }
    }
    return 0;
}
