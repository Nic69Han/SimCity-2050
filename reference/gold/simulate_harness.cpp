// Golden-value harness for crates/micropolis-core/src/simulate.rs.
//
// Runs the ORIGINAL C++ functions on inputs produced by a fixed LCG (the same
// generator is re-implemented in tests/simulate_gold.rs, so both sides see the
// same inputs). Prints one line of integers per case.
//
// Build:  reference/build-harness.sh reference/gold/simulate_harness.cpp reference/build/simulate_harness
// Run:    reference/build/simulate_harness <mode> [args]
//   modes: valves | census10 | census120 | tax | time | fundfx | maps
//          | tiles | heat <rule> <wrap>
#define private public
#include "micropolis.h"
#undef private
#include "text.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>

static uint32_t lcg_state = 1;
static uint32_t lcg_next() {
    lcg_state = lcg_state * 1103515245u + 12345u;
    return (lcg_state >> 8) & 0xffffffu;
}
// Inclusive range.
static int rnd(int lo, int hi) { return lo + (int)(lcg_next() % (uint32_t)(hi - lo + 1)); }

// Same hash as reference/oracle.cpp fnv(): FNV-1a style over 16-bit words.
static uint64_t fnv16(const unsigned short* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) {
        h ^= p[i] & 0xff; h *= 1099511628211ULL;
        h ^= p[i] >> 8;   h *= 1099511628211ULL;
    }
    return h;
}

static uint64_t map_hash(Micropolis& m) {
    return fnv16(&m.map[0][0], WORLD_W * WORLD_H);
}

static void clear_sprites(Micropolis& m) { m.spriteList = NULL; }

static int mode_valves() {
    Micropolis m;
    for (int k = 0; k < 300; k++) {
        lcg_state = 1000 + k;
        m.resPop = rnd(0, 4000);
        m.comPop = rnd(0, 800);
        m.indPop = rnd(0, 800);
        m.resHist[1] = rnd(0, 600);
        m.comHist[1] = rnd(0, 300);
        m.indHist[1] = rnd(0, 300);
        m.resValve = rnd(-2000, 2000);
        m.comValve = rnd(-1500, 1500);
        m.indValve = rnd(-1500, 1500);
        m.crimeRamp = rnd(0, 255);
        m.pollutionRamp = rnd(0, 255);
        m.landValueAverage = rnd(0, 255);
        m.crimeAverage = rnd(0, 255);
        m.pollutionAverage = rnd(0, 255);
        m.gameLevel = (GameLevel)rnd(0, 2);
        m.cityClass = (CityClass)rnd(0, 5);
        m.cityScore = rnd(1, 999);
        m.cityTax = rnd(0, 20);
        m.totalPop = rnd(0, 5000);
        m.externalMarket = (float)rnd(0, 800) / 100.0f;
        m.resCap = rnd(0, 1);
        m.comCap = rnd(0, 1);
        m.indCap = rnd(0, 1);
        m.valveFlag = false;
        for (int i = 0; i < 120; i++) m.miscHist[i] = 0;
        m.setValves();
        printf("%d %d %d %d %d %d", m.resValve, m.comValve, m.indValve, m.totalPop, m.totalPopLast, (int)m.valveFlag);
        for (int i = 1; i <= 17; i++) printf(" %d", m.miscHist[i]);
        printf("\n");
    }
    return 0;
}

static void census_arrays(Micropolis& m, int seedbase) {
    lcg_state = seedbase;
    for (int x = 0; x < 240; x++) {
        m.resHist[x] = rnd(-50, 400);
        m.comHist[x] = rnd(-50, 400);
        m.indHist[x] = rnd(-50, 400);
        m.crimeHist[x] = rnd(0, 255);
        m.pollutionHist[x] = rnd(0, 255);
        m.moneyHist[x] = rnd(0, 255);
    }
}

static void print_census_arrays(Micropolis& m) {
    printf(" %llu %llu %llu %llu %llu %llu\n",
           (unsigned long long)fnv16((unsigned short*)m.resHist, 240),
           (unsigned long long)fnv16((unsigned short*)m.comHist, 240),
           (unsigned long long)fnv16((unsigned short*)m.indHist, 240),
           (unsigned long long)fnv16((unsigned short*)m.crimeHist, 240),
           (unsigned long long)fnv16((unsigned short*)m.pollutionHist, 240),
           (unsigned long long)fnv16((unsigned short*)m.moneyHist, 240));
}

static int mode_census10() {
    Micropolis m;
    for (int k = 0; k < 120; k++) {
        census_arrays(m, 5000 + k);
        m.resPop = rnd(0, 4000);
        m.comPop = rnd(0, 800);
        m.indPop = rnd(0, 800);
        m.crimeAverage = rnd(0, 255);
        m.pollutionAverage = rnd(0, 255);
        m.crimeRamp = rnd(-100, 255);
        m.pollutionRamp = rnd(-100, 255);
        m.cashFlow = rnd(-3000, 3000);
        m.hospitalPop = rnd(0, 40);
        m.churchPop = rnd(0, 40);
        m.faith = rnd(0, 5);
        m.needHospital = 0;
        m.needChurch = 0;
        // take10Census() calls changeCensus() (front-end callback only); the
        // Rust port tests history and needs separately, so run both halves here.
        m.take10Census();
        printf("%d %d %d %d %d %d %d %d %d %d %d %d %d %d",
               m.resHist10Max, m.comHist10Max, m.indHist10Max, m.graph10Max,
               m.crimeRamp, m.pollutionRamp, m.moneyHist[0], m.crimeHist[0],
               m.pollutionHist[0], m.resHist[0], m.comHist[0], m.indHist[0],
               m.needHospital, m.needChurch);
        print_census_arrays(m);
    }
    return 0;
}

static int mode_census120() {
    Micropolis m;
    for (int k = 0; k < 120; k++) {
        census_arrays(m, 7000 + k);
        m.resPop = rnd(0, 4000);
        m.comPop = rnd(0, 800);
        m.indPop = rnd(0, 800);
        m.moneyHist[0] = rnd(0, 255);
        m.crimeHist[0] = rnd(0, 255);
        m.pollutionHist[0] = rnd(0, 255);
        m.take120Census();
        printf("%d %d %d %d %d %d", m.resHist120Max, m.comHist120Max, m.indHist120Max,
               m.graph120Max, m.resHist[120], m.comHist[120]);
        print_census_arrays(m);
    }
    return 0;
}

static int mode_tax() {
    Micropolis m;
    for (int k = 0; k < 200; k++) {
        lcg_state = 9000 + k;
        m.totalPop = rnd(0, 3000);
        m.landValueAverage = rnd(0, 255);
        m.cityTax = rnd(0, 20);
        m.roadTotal = rnd(0, 800);
        m.railTotal = rnd(0, 200);
        m.policeStationPop = rnd(0, 50);
        m.fireStationPop = rnd(0, 50);
        m.gameLevel = (GameLevel)rnd(0, 2);
        m.cityTaxAverage = rnd(0, 1000);
        m.taxFlag = (rnd(0, 3) == 0);
        m.cashFlow = 0;
        m.policeFund = m.fireFund = m.roadFund = m.taxFund = -7777;
        m.roadEffect = m.policeEffect = m.fireEffect = 0;
        m.collectTax();
        // doBudget() (populated city) does not write the fund/cashflow fields
        // printed here, so these values are the ones set by collectTax itself.
        printf("%d %ld %ld %ld %ld %d", m.cashFlow, (long)m.policeFund, (long)m.fireFund,
               (long)m.roadFund, (long)m.taxFund, m.cityTaxAverage);
        if (m.totalPop == 0) {
            printf(" %ld %ld %ld", (long)m.roadEffect, (long)m.policeEffect, (long)m.fireEffect);
        }
        printf("\n");
    }
    return 0;
}

static int mode_time() {
    Micropolis m;
    for (int k = 0; k < 200; k++) {
        lcg_state = 11000 + k;
        m.cityTime = rnd(0, 200000);
        m.startingYear = rnd(1900, 2100);
        m.cityYearLast = rnd(-1, 3000);
        m.cityMonthLast = rnd(-1, 11);
        m.doTimeStuff();
        printf("%ld %ld %ld %ld %ld\n", (long)m.cityTimeLast, (long)m.cityYear, (long)m.cityMonth,
               (long)m.cityYearLast, (long)m.cityMonthLast);
    }
    return 0;
}

static int mode_fundfx() {
    Micropolis m;
    for (int k = 0; k < 200; k++) {
        lcg_state = 13000 + k;
        m.roadSpend = rnd(0, 5000);
        m.roadFund = rnd(0, 5000);
        m.policeSpend = rnd(0, 5000);
        m.policeFund = rnd(0, 5000);
        m.fireSpend = rnd(0, 5000);
        m.fireFund = rnd(0, 5000);
        m.roadEffect = m.policeEffect = m.fireEffect = 0;
        m.mustDrawBudget = 0;
        m.updateFundEffects();
        printf("%ld %ld %ld %d\n", (long)m.roadEffect, (long)m.policeEffect, (long)m.fireEffect, m.mustDrawBudget);
    }
    return 0;
}

static int mode_maps() {
    Micropolis m;
    for (int k = 0; k < 20; k++) {
        lcg_state = 15000 + k;
        // rateOfGrowthMap: 8x8 clusters, values in -250..250 (clamped by the function).
        for (int x = 0; x < m.rateOfGrowthMap.MAP_W; x++)
            for (int y = 0; y < m.rateOfGrowthMap.MAP_H; y++)
                m.rateOfGrowthMap.set(x, y, (short)rnd(-250, 250));
        m.decRateOfGrowthMap();
        unsigned short buf[4096];
        int n = 0;
        for (int x = 0; x < m.rateOfGrowthMap.MAP_W; x++)
            for (int y = 0; y < m.rateOfGrowthMap.MAP_H; y++)
                buf[n++] = (unsigned short)m.rateOfGrowthMap.get(x, y);
        printf("rate %llu", (unsigned long long)fnv16(buf, n));

        // trafficDensityMap: 2x2 clusters, values 0..255.
        for (int x = 0; x < m.trafficDensityMap.MAP_W; x++)
            for (int y = 0; y < m.trafficDensityMap.MAP_H; y++)
                m.trafficDensityMap.set(x, y, (unsigned char)rnd(0, 255));
        m.decTrafficMap();
        n = 0;
        for (int x = 0; x < m.trafficDensityMap.MAP_W; x++)
            for (int y = 0; y < m.trafficDensityMap.MAP_H; y++)
                buf[n++] = (unsigned short)m.trafficDensityMap.get(x, y);
        printf(" traffic %llu\n", (unsigned long long)fnv16(buf, n));
    }
    return 0;
}

// Random map contents: any 16-bit tile value; optionally without ZONEBIT
// (no explosions) or always burnable (doRoad then never enters doBridge, whose
// boat distance depends on the sprite list, which the Rust tests don't model).
static void fill_map(Micropolis& m, bool no_zone, bool burnable) {
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++) {
            unsigned short v = (unsigned short)rnd(0, 65535);
            if (no_zone) v &= ~ZONEBIT;
            if (burnable) v |= BURNBIT;
            m.map[x][y] = v;
        }
}

static int mode_tiles() {
    Micropolis m;
    clear_sprites(m);
    // Functions: 0 doRoad, 1 doRadTile, 2 doBridge, 3 fireZone, 4 repairZone,
    //            5 drawStadium, 6 coalSmoke, 7 doFire
    static const unsigned short bridge_tiles[] = {
        BRWV, BRWH, HBRIDGE, VBRIDGE, RIVER, CHANNEL, HBRDG0, HBRDG1, HBRDG2, HBRDG3,
        VBRDG0, VBRDG1, VBRDG2, VBRDG3, HBRIDGE + 1, VBRIDGE + 1,
    };
    static const unsigned short zone_centers[] = {
        POWERPLANT, NUCLEAR, FIRESTATION, POLICESTATION, STADIUM, PORT, AIRPORT,
    };
    static const unsigned short stadium_states[] = { STADIUM, FULLSTADIUM };
    const int cases = 60;
    for (int fn = 0; fn < 8; fn++) {
        for (int k = 0; k < cases; k++) {
            uint32_t seed = 20000u + (uint32_t)fn * 1000u + (uint32_t)k;
            lcg_state = seed;
            m.seedRandom((int)seed);
            fill_map(m, fn == 7, fn == 0);
            // Sequenced draws: C++ argument evaluation order is unspecified.
            int px = rnd(2, WORLD_W - 3);
            int py = rnd(2, WORLD_H - 3);
            Position pos(px, py);
            m.roadEffect = rnd(0, 32);
            m.roadTotal = 0;
            m.railTotal = 0;
            for (int x = 0; x < m.trafficDensityMap.MAP_W; x++)
                for (int y = 0; y < m.trafficDensityMap.MAP_H; y++)
                    m.trafficDensityMap.set(x, y, (unsigned char)rnd(0, 255));
            for (int x = 0; x < m.fireStationEffectMap.MAP_W; x++)
                for (int y = 0; y < m.fireStationEffectMap.MAP_H; y++)
                    m.fireStationEffectMap.set(x, y, (short)rnd(-5, 150));
            for (int x = 0; x < m.rateOfGrowthMap.MAP_W; x++)
                for (int y = 0; y < m.rateOfGrowthMap.MAP_H; y++)
                    m.rateOfGrowthMap.set(x, y, (short)rnd(-200, 200));
            int extra = 0;
            switch (fn) {
            case 0:
                m.doRoad(pos);
                break;
            case 1:
                m.doRadTile(pos);
                break;
            case 2: {
                unsigned short t = bridge_tiles[rnd(0, (int)(sizeof bridge_tiles / sizeof bridge_tiles[0]) - 1)];
                // Odd/even bridge variants, and random tile bits.
                if (rnd(0, 3) == 0) t |= (unsigned short)rnd(0, 0x3ff);
                // Boat at distance d along x (or none, when d == 99999).
                int d = (rnd(0, 4) == 0) ? 99999 : rnd(0, 800);
                SimSprite* s = NULL;
                static SimSprite ship;
                if (d != 99999) {
                    memset(&ship, 0, sizeof ship);
                    ship.type = SPRITE_SHIP;
                    ship.frame = 1;
                    ship.x = pos.posX * 16 + 8 + d;
                    ship.y = pos.posY * 16 + 8;
                    ship.xHot = 0;
                    ship.yHot = 0;
                    ship.next = NULL;
                    s = &ship;
                }
                m.spriteList = s;
                extra = d;
                m.map[pos.posX][pos.posY] = t;
                int r = (int)m.doBridge(pos, t);
                m.spriteList = NULL;
                extra = extra * 2 + r;
                break;
            }
            case 3: {
                unsigned short ch = (unsigned short)rnd(0, 1023);
                if (rnd(0, 1)) ch |= ZONEBIT;
                m.fireZone(pos, ch);
                extra = m.rateOfGrowthMap.worldGet(pos.posX, pos.posY);
                break;
            }
            case 4: {
                unsigned short zc = (rnd(0, 3) == 0) ? (unsigned short)rnd(0, 1023) : zone_centers[rnd(0, 6)];
                int size = rnd(0, 2) == 0 ? 3 : (rnd(0, 1) ? 4 : 6);
                m.repairZone(pos, zc, (short)size);
                break;
            }
            case 5:
                m.drawStadium(pos, stadium_states[rnd(0, 1)]);
                break;
            case 6:
                m.coalSmoke(pos);
                break;
            case 7:
                m.doFire(pos);
                break;
            }
            printf("%d %llu %d %d %u\n", fn, (unsigned long long)map_hash(m), m.roadTotal * 1000 + m.railTotal,
                   extra, (unsigned)m.getRandom16());
        }
    }
    return 0;
}

static int mode_heat(int rule, int wrap) {
    Micropolis m;
    lcg_state = 4242;
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++)
            m.map[x][y] = (unsigned short)rnd(0, 65535);
    m.heatRule = rule;
    m.heatWrap = wrap;
    m.heatFlow = -7;
    for (int step = 0; step < 3; step++) {
        m.simHeat();
        printf("%d %llu\n", step, (unsigned long long)map_hash(m));
    }
    return 0;
}

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: simulate_harness <mode> [args]\n"); return 2; }
    const char* mode = argv[1];
    if (!strcmp(mode, "valves")) return mode_valves();
    if (!strcmp(mode, "census10")) return mode_census10();
    if (!strcmp(mode, "census120")) return mode_census120();
    if (!strcmp(mode, "tax")) return mode_tax();
    if (!strcmp(mode, "time")) return mode_time();
    if (!strcmp(mode, "fundfx")) return mode_fundfx();
    if (!strcmp(mode, "maps")) return mode_maps();
    if (!strcmp(mode, "tiles")) return mode_tiles();
    if (!strcmp(mode, "heat") && argc >= 4) return mode_heat(atoi(argv[2]), atoi(argv[3]));
    fprintf(stderr, "unknown mode\n");
    return 2;
}
