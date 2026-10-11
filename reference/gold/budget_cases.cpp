// Golden values for crates/micropolis-core/src/budget.rs.
//
// For each case: set random funds and percentages (same generator as
// evaluate_cases.cpp), then
//   (a) doBudgetNow(fromMenu=true): prints the granted values and the scaled
//       percentages (float bit patterns), no spending happens;
//   (b) with autoBudget on, doBudgetNow(fromMenu=false): prints whether
//       auto budget stayed on (1) or had to be switched off (0).
// Build: reference/build-harness.sh reference/gold/budget_cases.cpp reference/build/budget_cases
// Run:   reference/build/budget_cases > crates/micropolis-core/tests/data/budget_gold.txt
#define private public
#include "micropolis.h"
#undef private
#include <cstdint>
#include <cstdio>
#include <cstring>

struct Gen {
    uint64_t s;
    uint64_t next() {
        s = s * 6364136223846793005ULL + 1442695040888963407ULL;
        return s >> 33;
    }
    long pick(long lo, long hi) { return lo + (long)(next() % (uint64_t)(hi - lo + 1)); }
};

static uint32_t bits(float f) {
    uint32_t u;
    memcpy(&u, &f, 4);
    return u;
}

#define LL(x) ((long long)(x))
static const int NCASES = 300;

int main() {
    Gen g{777001ULL};
    Micropolis m;
    for (int i = 0; i < NCASES; i++) {
        long long fire = g.pick(0, i % 8 == 7 ? 3000000 : 3000);
        long long police = g.pick(0, i % 8 == 7 ? 3000000 : 3000);
        long long road = g.pick(0, i % 8 == 7 ? 3000000 : 3000);
        long long tax = g.pick(0, i % 5 == 4 ? 300000 : 5000);
        long long total = i % 6 == 5 ? g.pick(0, 300000) : g.pick(-3000, 5000);
        float fp = (float)g.pick(0, 1000) / 1000.0f;
        float pp = (float)g.pick(0, 1000) / 1000.0f;
        float rp = (float)g.pick(0, 1000) / 1000.0f;
        if (i % 9 == 8) { fp = 1.0f; pp = 1.0f; rp = 1.0f; }
        if (i % 11 == 10) { fp = 0.0f; }

        // (a) from the menu: allocation only
        m.fireFund = fire; m.policeFund = police; m.roadFund = road;
        m.taxFund = tax; m.totalFunds = total;
        m.firePercent = fp; m.policePercent = pp; m.roadPercent = rp;
        m.fireValue = m.policeValue = m.roadValue = -7;
        m.autoBudget = false;
        m.doBudgetNow(true);
        printf("B %lld %lld %lld %u %u %u\n", LL(m.fireValue), LL(m.policeValue), LL(m.roadValue),
               bits(m.firePercent), bits(m.policePercent), bits(m.roadPercent));

        // (b) automatic: does the auto budget survive?
        m.fireFund = fire; m.policeFund = police; m.roadFund = road;
        m.taxFund = tax; m.totalFunds = total;
        m.firePercent = fp; m.policePercent = pp; m.roadPercent = rp;
        m.autoBudget = true;
        m.doBudgetNow(false);
        printf("A %d\n", m.autoBudget ? 1 : 0);
    }

    // initFundingLevel
    m.mustDrawBudget = 0;
    m.firePercent = 0.3f; m.policePercent = 0.2f; m.roadPercent = 0.1f;
    m.fireValue = 5; m.policeValue = 6; m.roadValue = 7;
    m.initFundingLevel();
    printf("I %u %u %u %lld %lld %lld %d\n", bits(m.firePercent), bits(m.policePercent),
           bits(m.roadPercent), LL(m.fireValue), LL(m.policeValue), LL(m.roadValue), m.mustDrawBudget);
    return 0;
}
