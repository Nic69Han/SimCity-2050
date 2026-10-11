// Golden values for crates/micropolis-core/src/evaluate.rs.
//
// Each case sets a pseudo-random city state from the generator below, then
// calls the ORIGINAL functions in a fixed order and prints every result. The
// Rust test (tests/evaluate_gold.rs) uses the same generator and call order.
//
// Generator: s = s * 6364136223846793005 + 1442695040888963407 (mod 2^64),
// value = s >> 33, pick(lo, hi) = lo + value % (hi - lo + 1).
//
// Build: reference/gold/build-fixed-oracle.sh reference/gold/evaluate_cases.cpp reference/build/evaluate_cases_fixed
//        (the fixed-slot build: see build-fixed-oracle.sh for why)
// Run:   reference/build/evaluate_cases_fixed > crates/micropolis-core/tests/data/evaluate_gold.txt
#define private public
#include "micropolis.h"
#undef private
#include <cstdint>
#include <cstdio>

struct Gen {
    uint64_t s;
    uint64_t next() {
        s = s * 6364136223846793005ULL + 1442695040888963407ULL;
        return s >> 33;
    }
    long pick(long lo, long hi) { return lo + (long)(next() % (uint64_t)(hi - lo + 1)); }
};

#define LL(x) ((long long)(x))
static const int NCASES = 200;
static const int LV_W = 60, LV_H = 50; // landValueMap / trafficDensityMap: 2x2 blocks

int main() {
    Gen g{20240611ULL};
    Micropolis m;
    for (int i = 0; i < NCASES; i++) {
        // ---- state ----
        m.resPop = (short)g.pick(0, i % 10 == 9 ? 32767 : 4000);
        m.comPop = (short)g.pick(0, i % 10 == 9 ? 32767 : 800);
        m.indPop = (short)g.pick(0, i % 10 == 9 ? 32767 : 800);
        m.firePop = (short)g.pick(0, i % 7 == 6 ? 32767 : 120);
        m.roadTotal = (short)g.pick(0, 2000);
        m.railTotal = (short)g.pick(0, 300);
        m.policeStationPop = (short)g.pick(0, 40);
        m.fireStationPop = (short)g.pick(0, 40);
        m.hospitalPop = (short)g.pick(0, 60);
        m.stadiumPop = (short)g.pick(0, 4);
        m.seaportPop = (short)g.pick(0, 3);
        m.airportPop = (short)g.pick(0, 3);
        m.coalPowerPop = (short)g.pick(0, 5);
        m.nuclearPowerPop = (short)g.pick(0, 3);
        m.crimeAverage = (short)g.pick(0, 255);
        m.pollutionAverage = (short)g.pick(0, 255);
        m.landValueAverage = (short)g.pick(0, 255);
        m.cityTax = (short)g.pick(0, 20);
        m.cityPop = g.pick(0, 600000);
        {
            long mode = g.pick(0, 9);
            if (mode == 0) m.cityPopDelta = 0;
            else if (mode == 1) m.cityPopDelta = m.cityPop;
            else m.cityPopDelta = g.pick(-m.cityPop, m.cityPop);
        }
        m.poweredZoneCount = (short)g.pick(0, 400);
        m.unpoweredZoneCount = (short)g.pick(0, 400);
        m.resValve = (short)g.pick(-2100, 2100);
        m.comValve = (short)g.pick(-2000, 1600);
        m.indValve = (short)g.pick(-2000, 1600);
        m.resCap = g.pick(0, 4) == 0;
        m.comCap = g.pick(0, 4) == 0;
        m.indCap = g.pick(0, 4) == 0;
        m.roadEffect = g.pick(0, 32);
        m.policeEffect = g.pick(0, 1000);
        m.fireEffect = g.pick(0, 1000);
        m.cityScore = (short)g.pick(0, 1000);
        short table[PROBNUM];
        for (int k = 0; k < CVP_NUMPROBLEMS; k++) table[k] = (short)g.pick(0, 255);
        for (int k = CVP_NUMPROBLEMS; k < PROBNUM; k++) table[k] = 0;
        m.totalPop = (short)(g.pick(0, 4) == 0 ? 0 : g.pick(1, 32767));
        unsigned char* lv = m.landValueMap.getBase();
        for (int x = 0; x < LV_W; x++)
            for (int y = 0; y < LV_H; y++)
                lv[x * LV_H + y] = (unsigned char)(g.pick(0, 2) == 0 ? 0 : g.pick(0, 255));
        unsigned char* tr = m.trafficDensityMap.getBase();
        for (int x = 0; x < LV_W; x++)
            for (int y = 0; y < LV_H; y++) tr[x * LV_H + y] = (unsigned char)g.pick(0, 255);
        const unsigned long seed = 1000 + i;

        // ---- A: pure functions of the census ----
        long long pop = m.getPopulation();
        long long cls = m.getCityClass(m.cityPop);
        long long unemp = m.getUnemployment();
        long long fire = m.getFireSeverity();
        m.getAssessedValue();
        long long traffic = m.getTrafficAverage();
        printf("A %lld %lld %lld %lld %lld %lld\n", pop, cls, unemp, fire, LL(m.cityAssessedValue), traffic);

        // ---- S: score ----
        m.getScore(table);
        printf("S %lld %lld\n", LL(m.cityScore), LL(m.cityScoreDelta));

        // ---- P: population and class ----
        m.doPopNum();
        printf("P %lld %lld %lld\n", LL(m.cityPop), LL(m.cityPopDelta), LL(m.cityClass));

        // ---- V: mayor's approval ----
        m.nextRandom = seed;
        m.doVotes();
        printf("V %lld %lld\n", LL(m.cityYes), LL(m.getRandom16()));

        // ---- D: doProblems (computes its own table) ----
        m.nextRandom = seed + 1000;
        short t2[PROBNUM + 8] = {0};
        m.doProblems(t2);
        printf("D");
        for (int k = 0; k < PROBNUM; k++) printf(" %lld", LL(t2[k]));
        for (int k = 0; k < CVP_PROBLEM_COMPLAINTS; k++) printf(" o%lld", LL(m.problemOrder[k]));
        for (int k = 0; k < PROBNUM; k++) printf(" v%lld", LL(m.problemVotes[k]));
        printf(" r%lld\n", LL(m.getRandom16()));

        // ---- W: voteProblems on a given table (buffer keeps slot PROBNUM at 0) ----
        m.nextRandom = seed + 2000;
        short t3[PROBNUM + 8] = {0};
        for (int k = 0; k < PROBNUM; k++) t3[k] = table[k];
        m.voteProblems(t3);
        printf("W");
        for (int k = 0; k < PROBNUM; k++) printf(" %lld", LL(m.problemVotes[k]));
        printf(" r%lld\n", LL(m.getRandom16()));

        // ---- C: accessors on the problem order ----
        printf("C %lld", LL(m.countProblems()));
        for (int k = 0; k < CVP_PROBLEM_COMPLAINTS; k++)
            printf(" %lld %lld", LL(m.getProblemNumber(k)), LL(m.getProblemVotes(k)));
        printf(" %lld %lld\n", LL(m.getProblemNumber(-1)), LL(m.getProblemVotes(4)));

        // ---- E: whole evaluation (cityEvaluation with a fresh random seed) ----
        m.nextRandom = seed + 3000;
        m.evalChanged = false;
        m.cityEvaluation();
        printf("E %lld %lld %lld %lld %lld %lld %lld %lld %lld", LL(m.cityYes), LL(m.cityScore),
               LL(m.cityScoreDelta), LL(m.cityPop), LL(m.cityPopDelta), LL(m.cityClass),
               LL(m.cityAssessedValue), LL(m.trafficAverage), LL(m.evalChanged));
        for (int k = 0; k < PROBNUM; k++) printf(" v%lld", LL(m.problemVotes[k]));
        for (int k = 0; k < CVP_PROBLEM_COMPLAINTS; k++) printf(" o%lld", LL(m.problemOrder[k]));
        printf(" r%lld\n", LL(m.getRandom16()));
    }
    return 0;
}
