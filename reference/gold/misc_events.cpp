// Golden values for utilities.cpp, update.cpp, message.cpp (sendMessages,
// doScenarioScore, doMakeSound), graph.cpp and stubs.cpp, against the ORIGINAL
// engine. Every front-end callback is logged through callbackHook, in the
// canonical form also produced by the Rust tests:
//   U <what>            callback("update", "s", what)
//   M num x y pic imp   callback("update", "sdddbb", "message", ...)
//   S chan snd x y      callback("makeSound", ...)
//   G x y               callback("autoGoto", ...)
//   QUAKE n | LOSE | WIN | NEW
// Build and run from the repo root:
//   reference/build-harness.sh reference/gold/misc_events.cpp reference/build/misc_events
//   reference/build/misc_events > reference/gold/misc_events.out
#define private public
#include "micropolis.h"
#undef private
#include <cstdio>
#include <cstdarg>
#include <cstring>

static void hook(Micropolis*, void*, const char* name, const char* params, va_list ap) {
    if (!strcmp(name, "update")) {
        const char* what = va_arg(ap, const char*);
        if (!strcmp(params, "sdddbb")) {
            int num = va_arg(ap, int), x = va_arg(ap, int), y = va_arg(ap, int);
            int pic = va_arg(ap, int), imp = va_arg(ap, int);
            printf("M %d %d %d %d %d\n", num, x, y, pic, imp);
        } else {
            printf("U %s\n", what);
        }
    } else if (!strcmp(name, "makeSound")) {
        const char* ch = va_arg(ap, const char*);
        const char* snd = va_arg(ap, const char*);
        int x = va_arg(ap, int), y = va_arg(ap, int);
        printf("S %s %s %d %d\n", ch, snd, x, y);
    } else if (!strcmp(name, "autoGoto")) {
        int x = va_arg(ap, int), y = va_arg(ap, int);
        printf("G %d %d\n", x, y);
    } else if (!strcmp(name, "startEarthquake")) {
        printf("QUAKE %d\n", va_arg(ap, int));
    } else if (!strcmp(name, "loseGame")) {
        printf("LOSE\n");
    } else if (!strcmp(name, "winGame")) {
        printf("WIN\n");
    } else if (!strcmp(name, "newGame")) {
        printf("NEW\n");
    } else {
        printf("?? %s\n", name);
    }
}

static void resetState(Micropolis& m) {
    m.scenario = SC_NONE;
    m.scoreType = SC_NONE;
    m.scoreWait = 0;
    m.cityClass = CC_VILLAGE;
    m.trafficAverage = 0;
    m.crimeAverage = 0;
    m.cityScore = 500;
    m.cityPopLast = 0;
    m.categoryLast = 0;
}

static void setCensus(Micropolis& m, int preset) {
    resetState(m);
    m.resPop = m.comPop = m.indPop = 0;
    m.stadiumPop = m.seaportPop = m.airportPop = 0;
    m.resZonePop = m.comZonePop = m.indZonePop = 0;
    m.roadTotal = m.railTotal = 0;
    m.poweredZoneCount = m.unpoweredZoneCount = 0;
    m.pollutionAverage = m.crimeAverage = m.trafficAverage = 0;
    m.totalPop = m.fireStationPop = m.policeStationPop = 0;
    m.cityTax = 7;
    m.roadEffect = MAX_ROAD_EFFECT;
    m.fireEffect = MAX_FIRE_STATION_EFFECT;
    m.policeEffect = MAX_POLICE_STATION_EFFECT;
    m.nuclearPowerPop = m.coalPowerPop = 0;
    m.resCap = m.comCap = m.indCap = false;
    switch (preset) {
    case 0:
        break;
    case 1:
        m.resPop = 600; m.comPop = 150; m.indPop = 80;
        m.resZonePop = 10; m.comZonePop = 3; m.indZonePop = 2;
        m.roadTotal = 50; m.railTotal = 10;
        m.poweredZoneCount = 3; m.unpoweredZoneCount = 5;
        m.pollutionAverage = 70; m.crimeAverage = 120; m.trafficAverage = 70;
        m.totalPop = 70; m.cityTax = 13; m.roadEffect = 10;
        m.fireEffect = 600; m.policeEffect = 600;
        break;
    case 2:
        m.resPop = 100; m.stadiumPop = 5; m.comPop = 10; m.airportPop = 3;
        m.indPop = 10; m.seaportPop = 2;
        m.resZonePop = 400; m.comZonePop = 100; m.indZonePop = 50;
        m.roadTotal = 20; m.railTotal = 500;
        m.poweredZoneCount = 10; m.unpoweredZoneCount = 0;
        m.pollutionAverage = 30; m.crimeAverage = 50; m.trafficAverage = 10;
        m.totalPop = 1000; m.fireStationPop = 2; m.policeStationPop = 3;
        m.cityTax = 5; m.roadEffect = 20; m.fireEffect = 900; m.policeEffect = 999;
        break;
    case 3: // ratio exactly 0.7 in float
        m.resPop = 0; m.comPop = 300; m.indPop = 100;
        m.resZonePop = 0; m.comZonePop = 20; m.indZonePop = 0;
        m.poweredZoneCount = 7; m.unpoweredZoneCount = 3;
        m.totalPop = 21; m.roadTotal = 31; m.roadEffect = 19;
        m.fireEffect = 699; m.policeEffect = 700;
        m.cityTax = 12;
        break;
    case 4: // power pops, zone counts for the 22 check
        m.nuclearPowerPop = 1; m.coalPowerPop = 0;
        m.resZonePop = 40; m.comZonePop = 0; m.indZonePop = 0;
        m.crimeAverage = 101; m.pollutionAverage = 61; m.trafficAverage = 61;
        m.totalPop = 61; m.fireStationPop = 0; m.policeStationPop = 0;
        m.indPop = 71; m.seaportPop = 0; m.comPop = 101; m.airportPop = 0;
        m.resPop = 501; m.stadiumPop = 0;
        m.comZonePop = 25; m.indZonePop = 10;
        break;
    case 5: // scenario in progress with a countdown
        m.scenario = SC_BERN;
        m.scoreType = SC_BERN;
        m.scoreWait = 3;
        m.trafficAverage = 79;
        m.resPop = 9; m.totalPop = 9;
        break;
    }
}

static void dumpCensus(Micropolis& m) {
    printf("S2 res=%d com=%d ind=%d resCap=%d comCap=%d indCap=%d totalZone=%d scoreWait=%d\n",
           (int)m.resPop, (int)m.comPop, (int)m.indPop, (int)m.resCap, (int)m.comCap,
           (int)m.indCap, (int)m.totalZonePop, (int)m.scoreWait);
}

int main() {
    Micropolis m;
    m.enableSound = false;
    m.callbackHook = hook;
    // Pin the "last shown" values so that the first updates do not depend on
    // constructor defaults (the Rust side pins the same values).
    m.cityTimeLast = m.cityYearLast = m.cityMonthLast = m.totalFundsLast = -1;
    m.resLast = m.comLast = m.indLast = -999999;
    m.mustUpdateFunds = false;
    m.valveFlag = false;

    // ---- setSpeed clamping, paused or not ----
    for (int paused = 0; paused <= 1; paused++) {
        for (int v = -2; v <= 5; v++) {
            m.simPaused = paused != 0;
            m.simSpeedMeta = 0;
            m.simSpeed = 0;
            m.simPausedSpeed = 3;
            printf("SPEED p=%d v=%d\n", paused, v);
            m.setSpeed((short)v);
            printf("SPEED-STATE meta=%d speed=%d pausedSpeed=%d\n",
                   (int)m.simSpeedMeta, (int)m.simSpeed, (int)m.simPausedSpeed);
        }
    }

    // ---- pause / resume ----
    m.simPaused = false; m.simSpeedMeta = 0; m.simSpeed = 0; m.simPausedSpeed = 3;
    m.setSpeed(2);
    printf("PR setSpeed(2) meta=%d speed=%d\n", (int)m.simSpeedMeta, (int)m.simSpeed);
    m.pause();
    printf("PR pause meta=%d speed=%d pausedSpeed=%d paused=%d\n", (int)m.simSpeedMeta,
           (int)m.simSpeed, (int)m.simPausedSpeed, (int)m.simPaused);
    m.pause();
    printf("PR pause2 meta=%d speed=%d pausedSpeed=%d paused=%d\n", (int)m.simSpeedMeta,
           (int)m.simSpeed, (int)m.simPausedSpeed, (int)m.simPaused);
    m.setSpeed(3);
    printf("PR setSpeed(3) while paused meta=%d speed=%d pausedSpeed=%d\n", (int)m.simSpeedMeta,
           (int)m.simSpeed, (int)m.simPausedSpeed);
    m.resume();
    printf("PR resume meta=%d speed=%d pausedSpeed=%d paused=%d\n", (int)m.simSpeedMeta,
           (int)m.simSpeed, (int)m.simPausedSpeed, (int)m.simPaused);
    m.resume();
    printf("PR resume2 meta=%d speed=%d paused=%d\n", (int)m.simSpeedMeta, (int)m.simSpeed,
           (int)m.simPaused);

    // ---- passes, game level, city name ----
    m.setPasses(5);
    printf("PASSES passes=%d pass=%d\n", (int)m.simPasses, (int)m.simPass);
    m.setGameLevel(LEVEL_HARD);
    printf("LEVEL %d\n", (int)m.gameLevel);
    m.setCityName("San Fran-cisco 2!");
    printf("CITYNAME [%s]\n", m.cityName.c_str());
    m.setCityName("");
    printf("CITYNAME [%s]\n", m.cityName.c_str());
    m.setCleanCityName("Ab_c");
    printf("CITYNAME [%s]\n", m.cityName.c_str());

    // ---- setYear / currentYear ----
    m.startingYear = 1990;
    long times[] = {0, 47, 48, 95, 4800, 100000};
    int years[] = {1900, 1990, 2000, 2050};
    for (long t : times) {
        for (int y : years) {
            m.cityTime = t;
            m.setYear(y);
            printf("YEAR t=%ld y=%d -> time=%ld cityYear=%ld cityMonth=%ld cur=%d\n", t, y,
                   (long)m.cityTime, (long)m.cityYear, (long)m.cityMonth, m.currentYear());
        }
    }

    // ---- option flags are flushed once ----
    m.mustUpdateOptions = false;
    m.setEnableDisasters(false);
    m.setAutoBudget(false);
    m.setAutoBulldoze(true);
    m.setAutoGoto(true);
    m.setEnableSound(true);
    m.setDoAnimation(false);
    m.setDoMessages(false);
    m.setDoNotices(true);
    m.updateOptions();
    printf("OPT dis=%d budget=%d bull=%d goto=%d sound=%d anim=%d msg=%d notice=%d\n",
           (int)m.enableDisasters, (int)m.autoBudget, (int)m.autoBulldoze, (int)m.autoGoto,
           (int)m.enableSound, (int)m.doAnimation, (int)m.doMessages, (int)m.doNotices);
    m.updateOptions();
    printf("OPT-again\n");
    m.enableSound = false;

    // ---- funds ----
    m.totalFunds = 20000; m.totalFundsLast = -1; m.mustUpdateFunds = false;
    m.updateFunds(); m.reallyUpdateFunds();
    printf("FUNDS 1 total=%ld last=%ld\n", (long)m.totalFunds, (long)m.totalFundsLast);
    m.reallyUpdateFunds();
    m.spend(1500);
    m.reallyUpdateFunds();
    printf("FUNDS 2 total=%ld\n", (long)m.totalFunds);
    m.setFunds(7); m.updateFunds(); m.reallyUpdateFunds();
    m.updateFunds(); m.reallyUpdateFunds();
    printf("FUNDS 3 total=%ld last=%ld\n", (long)m.totalFunds, (long)m.totalFundsLast);

    // ---- updateDate ----
    long dates[] = {0, 1, 3, 4, 47, 48, 50, 4799, 100000, 48L * (1000000 - 1990 + 3)};
    for (long t : dates) {
        m.cityTime = t;
        m.cityTimeLast = m.cityYearLast = m.cityMonthLast = -1;
        m.updateDate();
        printf("DATE t=%ld -> time=%ld timeLast=%ld year=%ld month=%ld yearLast=%ld monthLast=%ld\n",
               t, (long)m.cityTime, (long)m.cityTimeLast, (long)m.cityYear, (long)m.cityMonth,
               (long)m.cityYearLast, (long)m.cityMonthLast);
    }

    // ---- valves (drawValve clamps to +-1500) and updateHeads ----
    struct { int r, c, i; } valves[] = {{0, 0, 0}, {-3000, 1500, 700}, {1500, -1500, -1499},
                                        {17, 17, 17}, {2600, -7, 0}};
    for (auto v : valves) {
        m.resValve = (short)v.r; m.comValve = (short)v.c; m.indValve = (short)v.i;
        m.valveFlag = true;
        m.showValves();
        printf("VALVE r=%d c=%d i=%d -> last %ld %ld %ld flag=%d\n", v.r, v.c, v.i,
               (long)m.resLast, (long)m.comLast, (long)m.indLast, (int)m.valveFlag);
        m.showValves();
    }
    m.resValve = 1200; m.comValve = -400; m.indValve = 90;
    m.updateHeads();
    printf("HEADS last %ld %ld %ld timeLast=%ld yearLast=%ld monthLast=%ld fundsLast=%ld\n",
           (long)m.resLast, (long)m.comLast, (long)m.indLast, (long)m.cityTimeLast,
           (long)m.cityYearLast, (long)m.cityMonthLast, (long)m.totalFundsLast);

    // ---- graphs ----
    short* arrays[6] = {m.resHist, m.comHist, m.indHist, m.moneyHist, m.crimeHist, m.pollutionHist};
    for (int a = 0; a < 6; a++)
        for (int i = 0; i < 240; i++)
            arrays[a][i] = (short)((i * (37 + a * 11)) % 301 - 50);
    for (int t = -1; t <= 6; t++)
        for (int s = -1; s <= 2; s++)
            for (int idx : {-1, 0, 5, 119, 120, 239, 240}) {
                if (t >= 0 && t < 6 && s >= 0 && s < 2 && idx >= 0 && idx < 120)
                    printf("GET %d %d %d = %d\n", t, s, idx, (int)m.getHistory(t, s, idx));
                else
                    printf("GET %d %d %d = %d\n", t, s, idx, (int)m.getHistory(t, s, idx));
            }
    for (int t = -1; t <= 6; t++)
        for (int s = -1; s <= 2; s++) {
            short mn = 99, mx = 99;
            m.getHistoryRange(t, s, &mn, &mx);
            printf("RANGE %d %d = %d %d\n", t, s, (int)mn, (int)mx);
        }
    m.setHistory(HISTORY_TYPE_MONEY, HISTORY_SCALE_LONG, 7, 1234);
    m.setHistory(HISTORY_TYPE_RES, HISTORY_SCALE_SHORT, 119, -5);
    m.setHistory(HISTORY_TYPE_RES, HISTORY_SCALE_SHORT, 120, 9);   // index beyond 119 is ignored
    m.setHistory(9, 0, 1, 77);                                       // bad type ignored
    printf("SET money-long7=%d res-short119=%d bad=%d\n",
           (int)m.getHistory(HISTORY_TYPE_MONEY, HISTORY_SCALE_LONG, 7),
           (int)m.getHistory(HISTORY_TYPE_RES, HISTORY_SCALE_SHORT, 119),
           (int)m.getHistory(9, 0, 1));
    m.changeCensus();
    m.graphDoer();
    m.graphDoer();
    printf("GRAPH-DOER done\n");

    // ---- map accessors ----
    m.setTile(3, 4, 0x1234);
    printf("TILE get(-1,0)=%d get(0,0)=%d get(3,4)=%d\n", m.getTile(-1, 0), m.getTile(0, 0),
           m.getTile(3, 4));
    m.setTile(120, 0, 5);
    printf("TILE off-map set ignored get(120,0)=%d\n", m.getTile(120, 0));
    m.setPowerGrid(5, 7, 300);
    printf("POWER %d %d %d\n", m.getPowerGrid(5, 7), m.getPowerGrid(-1, 0), m.getPowerGrid(119, 99));
    m.setPowerGrid(119, 99, 9);
    printf("POWER-set %d\n", m.getPowerGrid(119, 99));
    m.setPopulationDensity(3, 4, 300);   m.setPopulationDensity(-1, 0, 5);
    printf("POPDENS %d %d %d\n", m.getPopulationDensity(3, 4), m.getPopulationDensity(-1, 0),
           m.getPopulationDensity(59, 49));
    m.setRateOfGrowth(3, 4, 70000);      m.setRateOfGrowth(15, 0, 1);
    printf("ROG %d %d\n", m.getRateOfGrowth(3, 4), m.getRateOfGrowth(15, 0));
    m.setTrafficDensity(3, 4, 255);      m.setTrafficDensity(2, 2, 256);
    printf("TRAF %d %d %d\n", m.getTrafficDensity(3, 4), m.getTrafficDensity(2, 2), m.getTrafficDensity(-2, 0));
    m.setPollutionDensity(3, 4, 201);    m.setPollutionDensity(60, 0, 3);
    printf("POLL %d %d\n", m.getPollutionDensity(3, 4), m.getPollutionDensity(60, 0));
    m.setCrimeRate(3, 4, 99);            m.setCrimeRate(1, -1, 4);
    printf("CRIME %d %d\n", m.getCrimeRate(3, 4), m.getCrimeRate(1, -1));
    m.setLandValue(3, 4, 150);           m.setLandValue(3, 4, 1000);
    printf("LAND %d %d\n", m.getLandValue(3, 4), m.getLandValue(-1, -1));
    m.setFireCoverage(3, 4, 70000);      m.setFireCoverage(14, 12, -33);
    printf("FIRE %d %d\n", m.getFireCoverage(3, 4), m.getFireCoverage(14, 12));
    m.setPoliceCoverage(3, 4, -70000);   m.setPoliceCoverage(15, 0, 2);
    printf("POLICE %d %d\n", m.getPoliceCoverage(3, 4), m.getPoliceCoverage(15, 0));

    // ---- invalidateMaps, sounds, notifications ----
    m.mapSerial = 1;
    m.invalidateMaps();
    printf("MAPSERIAL %d\n", (int)m.mapSerial);
    m.makeSound("city", "Siren", 3, 4);      // sound disabled: nothing
    m.enableSound = true;
    m.makeSound("city", "Siren", 3, 4);
    m.makeSound("city", "Monster");           // default x,y = -1
    m.doEarthquake(5);
    m.enableSound = false;
    m.doEarthquake(6);
    m.enableSound = true;
    m.doAutoGoto(10, 20, (char*)"ignored");
    m.doLoseGame();
    m.doWinGame();
    m.doNewGame();
    printf("NOTIFY done\n");

    // ---- sendMessages over the 64-step cycle (checkGrowth skipped: t & 3 != 0) ----
    for (int preset = 0; preset <= 5; preset++) {
        setCensus(m, preset);
        printf("PRESET %d\n", preset);
        for (int t = 1; t <= 255; t++) {
            if ((t & 3) == 0) continue;
            m.cityTime = t;
            m.sendMessages();
        }
        dumpCensus(m);
    }

    // ---- doScenarioScore for every scenario and outcome ----
    for (int sc = SC_DULLSVILLE; sc <= SC_RIO; sc++)
        for (int cls = 0; cls <= 5; cls++)
            for (int traffic : {79, 80})
                for (int crime : {59, 60})
                    for (int score : {500, 501}) {
                        m.cityClass = (CityClass)cls;
                        m.trafficAverage = traffic;
                        m.crimeAverage = crime;
                        m.cityScore = score;
                        printf("SCORE sc=%d cls=%d traf=%d crime=%d score=%d\n", sc, cls, traffic, crime, score);
                        m.doScenarioScore((Scenario)sc);
                    }

    // ---- doMakeSound (draws from the generator) ----
    m.enableSound = true;
    int msgs[] = {1, 12, 11, 20, 21, 22, 23, 24, 25, 26, 27, 30, 43, 44, 40};
    for (int seed : {1, 777, 123456}) {
        for (int msg : msgs) {
            m.nextRandom = seed;
            printf("MSND seed=%d msg=%d\n", seed, msg);
            m.doMakeSound(msg, 5, -1);
        }
    }
    return 0;
}
