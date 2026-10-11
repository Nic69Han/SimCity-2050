// Gold harness for zone.cpp (golden values for crates/micropolis-core/src/zone.rs).
//
// Runs the ORIGINAL zone code on assets/cities/haight.cty with a fixed state, and
// prints the results. The Rust test (zone.rs, gold_tests) runs the same script
// and compares the output byte for byte with tests/zone_gold.txt.
//
// makeTraffic is another module's code (traffic.cpp). build-zone-gold.sh compiles
// traffic.cpp with makeTraffic renamed, so the real one is not linked, and the
// stub below supplies it. The stub returns g_traffic_result, which the script sets
// before each call. The Rust test-only stub (shim_zone.rs) does the same.
// repairZone and doSpecialZone (simulate.cpp) are linked for real but never reached:
// the script keeps cityTime % 16 != 0 and selects no special zone centres.
//
// Build and run from the repository root:
//   reference/gold/build-zone-gold.sh    (-> reference/build/zone_gold)
//   reference/build/zone_gold assets/cities/haight.cty > crates/micropolis-core/tests/zone_gold.txt
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdint>
#include <vector>
#include <algorithm>

static int g_traffic_result = 1;

// .cty layout: six history arrays of 240 shorts, the misc history of 120 shorts,
// then the 120x100 tile map as big-endian shorts in column-major order.
static const size_t CTY_TILES_OFFSET = (6 * 240 + 120) * 2;
static const size_t CTY_BYTES = CTY_TILES_OFFSET + 2 * 120 * 100;

// Stub replacing traffic.cpp (only zone.cpp's Position overload is used here).
short Micropolis::makeTraffic(const Position &startPos, ZoneType dest)
{
    (void)startPos;
    (void)dest;
    return (short)g_traffic_result;
}

static const uint64_t FNV0 = 1469598103934665603ULL;

static uint64_t hadd(uint64_t h, long v)
{
    uint32_t u = (uint32_t)v;
    for (int b = 0; b < 4; b++) {
        h ^= (u >> (8 * b)) & 0xff;
        h *= 1099511628211ULL;
    }
    return h;
}

static uint64_t tilehash(Micropolis &m)
{
    uint64_t h = FNV0;
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++)
            h = hadd(h, m.map[x][y]);
    return h;
}

template <class M>
static uint64_t maphash(M &mp)
{
    uint64_t h = FNV0;
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++)
            h = hadd(h, (long)mp.worldGet(x, y));
    return h;
}

static Position P(int x, int y)
{
    Position p;
    p.posX = x;
    p.posY = y;
    return p;
}

static long cell(Micropolis &m, int x, int y)
{
    return (x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) ? (long)m.map[x][y] : -1;
}

static void print3x3(Micropolis &m, int x, int y)
{
    printf("  3x3");
    for (int dy = -1; dy <= 1; dy++)
        for (int dx = -1; dx <= 1; dx++)
            printf(" %ld", cell(m, x + dx, y + dy));
    printf("\n");
}

// Deterministic setup, mirrored exactly in zone.rs.
static void setup(Micropolis &m)
{
    m.seedRandom(2024);
    for (int x = 0; x < WORLD_W; x++) {
        for (int y = 0; y < WORLD_H; y++) {
            m.landValueMap.worldSet(x, y, (x * 7 + y * 13) % 256);
            m.pollutionDensityMap.worldSet(x, y, (x * 5 + y * 3 + 40) % 128);
            m.populationDensityMap.worldSet(x, y, (x * 3 + y * 17) % 200);
            m.powerGridMap.worldSet(x, y, ((x + y) % 3) != 0 ? 1 : 0);
            m.rateOfGrowthMap.worldSet(x, y, (short)((x * x + y) % 401 - 200));
            m.comRateMap.worldSet(x, y, (short)((x * y) % 256));
        }
    }
    m.cityTime = 5; // not a multiple of 16, so repairZone is not reached
    m.poweredZoneCount = 0;
    m.unpoweredZoneCount = 0;
    m.resZonePop = 0;
    m.resPop = 0;
    m.comZonePop = 0;
    m.comPop = 0;
    m.indZonePop = 0;
    m.indPop = 0;
    m.hospitalPop = 0;
    m.churchPop = 0;
    m.resValve = 300;
    m.comValve = -200;
    m.indValve = 150;
}

struct Pick {
    int x, y, cat;
};

static int category(int t)
{
    if (t >= RESBASE && t < HOSPITAL) return 0;                                  // residential
    if (t >= COMBASE && t < INDBASE) return 1;                                   // commercial
    if (t >= INDBASE && t <= PORTBASE) return 2;                                 // industrial
    if ((t >= HOSPITAL && t < COMBASE) || (t >= CHURCH1BASE && t <= CHURCH7LAST)) return 3; // hospital/church
    return -1;                                                                   // special, not tested here
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: zone_gold assets/cities/haight.cty\n");
        return 2;
    }
    Micropolis m;
    if (!m.loadFile(argv[1])) {
        printf("load fail\n");
        return 1;
    }
    // Use the RAW tile layer of the file: loadFile() also runs the scans of other
    // modules (simLoadInit, doPowerScan, ...), which change 807 tiles of this city.
    // The zone script must start from the same tiles in both languages.
    {
        FILE *f = fopen(argv[1], "rb");
        if (!f) { printf("open fail\n"); return 1; }
        std::vector<unsigned char> buf(CTY_BYTES);
        if (fread(buf.data(), 1, CTY_BYTES, f) != (size_t)CTY_BYTES) { printf("read fail\n"); return 1; }
        fclose(f);
        for (int i = 0; i < WORLD_W * WORLD_H; i++) {
            size_t at = CTY_TILES_OFFSET + 2 * (size_t)i;
            (&m.map[0][0])[i] = (unsigned short)((buf[at] << 8) | buf[at + 1]);
        }
    }
    printf("loaded tiles=%016llx\n", (unsigned long long)tilehash(m));

    setup(m);

    // ---- phase 1: doZone on zone centres found in the loaded map ----
    std::vector<Pick> all[4];
    for (int x = 0; x < WORLD_W; x++) {
        for (int y = 0; y < WORLD_H; y++) {
            int t = m.map[x][y];
            if (!(t & ZONEBIT)) continue;
            int c = category(t & LOMASK);
            if (c >= 0) {
                Pick p = {x, y, c};
                all[c].push_back(p);
            }
        }
    }
    printf("candidates res=%d com=%d ind=%d hc=%d\n", (int)all[0].size(), (int)all[1].size(),
           (int)all[2].size(), (int)all[3].size());

    const int quota[4] = {10, 8, 7, 5};
    std::vector<Pick> picks;
    for (int c = 0; c < 4; c++) {
        int n = (int)all[c].size();
        int k = std::min(quota[c], n);
        for (int j = 0; j < k; j++) picks.push_back(all[c][j * n / k]);
    }

    for (size_t i = 0; i < picks.size(); i++) {
        const Pick &p = picks[i];
        int nh = (i % 4 == 0) ? -1 : (i % 4 == 1) ? 1 : 0;
        int nc = (i % 5 == 0) ? -1 : (i % 5 == 1) ? 1 : 0;
        m.needHospital = nh;
        m.needChurch = nc;
        g_traffic_result = (i % 3 == 0) ? 1 : (i % 3 == 1) ? 0 : -1;

        Position pos = P(p.x, p.y);
        int pre = m.map[p.x][p.y];
        m.doZone(pos);

        printf("zone %d at %d,%d cat=%d pre=%d traf=%d nh=%d nc=%d\n", (int)i, p.x, p.y, p.cat, pre,
               g_traffic_result, nh, nc);
        print3x3(m, p.x, p.y);
        printf("  pz=%d uz=%d rz=%d rp=%d cz=%d cp=%d iz=%d ip=%d hp=%d chp=%d rog=%d nh=%d nc=%d rng=%d\n",
               (int)m.poweredZoneCount, (int)m.unpoweredZoneCount, (int)m.resZonePop, (int)m.resPop,
               (int)m.comZonePop, (int)m.comPop, (int)m.indZonePop, (int)m.indPop, (int)m.hospitalPop,
               (int)m.churchPop, (int)m.rateOfGrowthMap.worldGet(p.x, p.y), (int)m.needHospital,
               (int)m.needChurch, m.getRandom16());
    }
    // ---- phase 4: 20 repetitions of doZone over all picked centres ----
    for (int rep = 0; rep < 20; rep++) {
        for (size_t j = 0; j < picks.size(); j++) {
            int k = rep + (int)j;
            m.needHospital = (k % 4 == 0) ? -1 : (k % 4 == 1) ? 1 : 0;
            m.needChurch = (k % 5 == 0) ? -1 : (k % 5 == 1) ? 1 : 0;
            g_traffic_result = (k % 3 == 0) ? 1 : (k % 3 == 1) ? 0 : -1;
            m.doZone(P(picks[j].x, picks[j].y));
        }
        printf("rep %d tiles=%08llx rog=%08llx pz=%d uz=%d rz=%d rp=%d cz=%d cp=%d iz=%d ip=%d hp=%d chp=%d rng=%d\n",
               rep, (unsigned long long)(tilehash(m) & 0xffffffffULL),
               (unsigned long long)(maphash(m.rateOfGrowthMap) & 0xffffffffULL),
               (int)m.poweredZoneCount, (int)m.unpoweredZoneCount, (int)m.resZonePop, (int)m.resPop,
               (int)m.comZonePop, (int)m.comPop, (int)m.indZonePop, (int)m.indPop, (int)m.hospitalPop,
               (int)m.churchPop, m.getRandom16());
    }
    printf("after-phase1 tiles=%016llx rog=%016llx com=%016llx\n", (unsigned long long)tilehash(m),
           (unsigned long long)maphash(m.rateOfGrowthMap), (unsigned long long)maphash(m.comRateMap));

    // ---- phase 2: the helper functions, one group of calls per position ----
    // Positions: ten evenly spaced clear lots (evalLot >= 1, so buildHouse acts),
    // plus two corners.
    std::vector<Pick> clear;
    for (int x = 0; x < WORLD_W; x++)
        for (int y = 0; y < WORLD_H; y++)
            if (m.evalLot(x, y) >= 1) {
                Pick p = {x, y, 0};
                clear.push_back(p);
            }
    printf("clear lots %d\n", (int)clear.size());
    std::vector<Pick> p2;
    for (int j = 0; j < 10; j++) {
        int n = (int)clear.size();
        p2.push_back(clear[j * n / 10]);
    }
    Pick c0 = {0, 0, 0}, c1 = {WORLD_W - 1, WORLD_H - 1, 0};
    p2.push_back(c0);
    p2.push_back(c1);
    for (int i = 0; i < (int)p2.size(); i++) {
        int x = p2[i].x;
        int y = p2[i].y;
        Position pos = P(x, y);
        int pop1 = (i * 7) % 42;
        int val = i % 4;

        bool b = m.setZonePower(pos);
        printf("setZonePower %d %d -> %d t=%08llx\n", x, y, (int)b, (unsigned long long)(tilehash(m) & 0xffffffffULL));

        short lp = m.getLandPollutionValue(pos);
        printf("getLandPollutionValue %d %d -> %d\n", x, y, (int)lp);

        short fp = m.doFreePop(pos);
        printf("doFreePop %d %d -> %d\n", x, y, (int)fp);

        short el = m.evalLot(x, y);
        printf("evalLot %d %d -> %d\n", x, y, (int)el);

        m.buildHouse(pos, val);
        printf("buildHouse %d %d v=%d t=%08llx\n", x, y, val, (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.doResIn(pos, pop1, val);
        printf("doResIn %d %d p=%d v=%d t=%08llx rog=%d\n", x, y, pop1, val,
               (unsigned long long)(tilehash(m) & 0xffffffffULL), (int)m.rateOfGrowthMap.worldGet(x, y));

        m.doResOut(pos, pop1, val);
        printf("doResOut %d %d p=%d v=%d t=%08llx rog=%d\n", x, y, pop1, val,
               (unsigned long long)(tilehash(m) & 0xffffffffULL), (int)m.rateOfGrowthMap.worldGet(x, y));

        m.doComIn(pos, pop1 % 6, val);
        printf("doComIn %d %d p=%d v=%d t=%08llx\n", x, y, pop1 % 6, val,
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.doComOut(pos, pop1 % 6, val);
        printf("doComOut %d %d p=%d v=%d t=%08llx\n", x, y, pop1 % 6, val,
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.doIndIn(pos, pop1 % 5, val % 2);
        printf("doIndIn %d %d p=%d v=%d t=%08llx\n", x, y, pop1 % 5, val % 2,
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.doIndOut(pos, pop1 % 5, val % 2);
        printf("doIndOut %d %d p=%d v=%d t=%08llx\n", x, y, pop1 % 5, val % 2,
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.resPlop(pos, pop1 % 4, val);
        printf("resPlop %d %d den=%d v=%d t=%08llx\n", x, y, pop1 % 4, val,
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.comPlop(pos, pop1 % 5, val);
        printf("comPlop %d %d den=%d v=%d t=%08llx\n", x, y, pop1 % 5, val,
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.indPlop(pos, pop1 % 4, val % 2);
        printf("indPlop %d %d den=%d v=%d t=%08llx\n", x, y, pop1 % 4, val % 2,
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        bool zp = m.zonePlop(pos, RZB - 4 + 9 * (i % 30));
        printf("zonePlop %d %d -> %d t=%08llx\n", x, y, (int)zp, (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.setSmoke(pos, i % 2 == 0);
        printf("setSmoke %d %d pw=%d t=%08llx\n", x, y, (int)(i % 2 == 0),
               (unsigned long long)(tilehash(m) & 0xffffffffULL));

        m.needHospital = (i % 3 == 0) ? 1 : 0;
        m.needChurch = (i % 3 == 1) ? 1 : 0;
        m.makeHospital(pos);
        printf("makeHospital %d %d nh=%d nc=%d t=%08llx rng=%d\n", x, y, (int)m.needHospital, (int)m.needChurch,
               (unsigned long long)(tilehash(m) & 0xffffffffULL), m.getRandom16());

        m.incRateOfGrowth(pos, (i % 5) - 2);
        printf("incRateOfGrowth %d %d a=%d rog=%d\n", x, y, (i % 5) - 2, (int)m.rateOfGrowthMap.worldGet(x, y));

        int t = (i % 3) - 1;
        printf("evalRes %d %d t=%d -> %d\n", x, y, t, (int)m.evalRes(pos, t));
        printf("evalCom %d %d t=%d -> %d\n", x, y, t, (int)m.evalCom(pos, t));
        printf("evalInd t=%d -> %d\n", t, (int)m.evalInd(t));
    }

    // ---- phase 5: build_house on 200 evenly spaced clear lots (tie-break coverage) ----
    for (int j = 0; j < 200; j++) {
        int n = (int)clear.size();
        Pick c = clear[j * n / 200];
        m.buildHouse(P(c.x, c.y), j % 4);
        if (j % 50 == 49)
            printf("bh %d tiles=%08llx\n", j, (unsigned long long)(tilehash(m) & 0xffffffffULL));
    }

    // ---- phase 6: immigration/emigration helpers over every population value ----
    {
        Pick c = clear[clear.size() / 3];
        Position pos = P(c.x, c.y);
        for (int k = 0; k < 42; k++) {
            int v = k % 4;
            m.doResOut(pos, k, v);
            unsigned long long a = tilehash(m) & 0xffffffffULL;
            m.doResIn(pos, k, v);
            unsigned long long b = tilehash(m) & 0xffffffffULL;
            m.doComOut(pos, k % 8, v);
            unsigned long long c1 = tilehash(m) & 0xffffffffULL;
            m.doComIn(pos, k % 8, v);
            unsigned long long d = tilehash(m) & 0xffffffffULL;
            m.doIndOut(pos, k % 6, v % 2);
            unsigned long long e = tilehash(m) & 0xffffffffULL;
            m.doIndIn(pos, k % 6, v % 2);
            unsigned long long f = tilehash(m) & 0xffffffffULL;
            printf("po %d ro=%08llx ri=%08llx co=%08llx ci=%08llx io=%08llx ii=%08llx\n", k, a, b, c1, d, e, f);
        }
    }

    // ---- phase 3: pure table functions over every tile value ----
    uint64_t hr = FNV0, hc = FNV0, hi = FNV0;
    for (int t = 0; t < 1024; t++) {
        hr = hadd(hr, m.getResZonePop((MapTile)t));
        hc = hadd(hc, m.getComZonePop((MapTile)t));
        hi = hadd(hi, m.getIndZonePop((MapTile)t));
    }
    printf("getResZonePop hash=%016llx\n", (unsigned long long)hr);
    printf("getComZonePop hash=%016llx\n", (unsigned long long)hc);
    printf("getIndZonePop hash=%016llx\n", (unsigned long long)hi);

    printf("end tiles=%016llx rog=%016llx com=%016llx\n", (unsigned long long)tilehash(m),
           (unsigned long long)maphash(m.rateOfGrowthMap), (unsigned long long)maphash(m.comRateMap));
    printf("end pz=%d uz=%d rz=%d rp=%d cz=%d cp=%d iz=%d ip=%d hp=%d chp=%d rng=%d\n",
           (int)m.poweredZoneCount, (int)m.unpoweredZoneCount, (int)m.resZonePop, (int)m.resPop,
           (int)m.comZonePop, (int)m.comPop, (int)m.indZonePop, (int)m.indPop, (int)m.hospitalPop,
           (int)m.churchPop, m.getRandom16());
    return 0;
}
