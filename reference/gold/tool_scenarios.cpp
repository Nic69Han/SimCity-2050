// Golden values for tool.rs (port of tool.cpp), produced by the ORIGINAL engine.
//
// Runs a fixed sequence of tool actions on assets/cities/haight.cty and prints
// one line per action: result code, funds, FNV hash of the whole tile map, and
// for queries the zone status reported through the front-end callback.
// The sequence avoids the paths that need unported modules (connectTile,
// smoothTreesAt, isTree), so the Rust test can replay it today. The Rust test
// (crates/micropolis-core/tests/tool_scenarios.rs) replays the same steps and
// compares the text exactly; keep the two in sync.
//
// Build and run (from the repository root):
//   reference/build-harness.sh reference/gold/tool_scenarios.cpp <scratch>/tool_scenarios
//   <scratch>/tool_scenarios
#define private public
#include "micropolis.h"
#undef private
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>

static int gZoneSeen;
static int gZone[6]; // category, s0..s4 (x and y follow in the callback, ignored)

static void hook(Micropolis *, void *, const char *name, const char *,
                 va_list ap)
{
    if (strcmp(name, "showZoneStatus") == 0) {
        gZoneSeen = 1;
        for (int i = 0; i < 6; i++) {
            gZone[i] = va_arg(ap, int);
        }
    }
}

static uint64_t fnv(const unsigned short *p, int n)
{
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) {
        h ^= p[i] & 0xff;
        h *= 1099511628211ULL;
        h ^= p[i] >> 8;
        h *= 1099511628211ULL;
    }
    return h;
}

static Micropolis m;

static void state(void)
{
    printf(" funds=%ld hash=%016llx\n", (long)m.totalFunds,
           (unsigned long long)fnv(&m.map[0][0], WORLD_W * WORLD_H));
}

static void doit(const char *label, EditingTool t, int x, int y)
{
    gZoneSeen = 0;
    ToolResult r = m.doTool(t, x, y);
    printf("%s x=%d y=%d res=%d", label, x, y, (int)r);
    if (gZoneSeen) {
        printf(" zone=%d:%d,%d,%d,%d,%d", gZone[0], gZone[1], gZone[2],
               gZone[3], gZone[4], gZone[5]);
    }
    state();
}

static void drag(const char *label, EditingTool t, int fx, int fy, int tx,
                 int ty)
{
    m.toolDrag(t, fx, fy, tx, ty);
    printf("drag %s from=%d,%d to=%d,%d", label, fx, fy, tx, ty);
    state();
}

static void down(const char *label, EditingTool t, int x, int y)
{
    m.toolDown(t, x, y);
    printf("down %s x=%d y=%d", label, x, y);
    state();
}

static void bull2(int x, int y)
{
    ToolResult r = m.bulldozerTool(x, y);
    printf("bulldozer2 x=%d y=%d res=%d", x, y, (int)r);
    state();
}

static void window(const char *label, int x0, int y0, int w, int h)
{
    for (int y = y0; y < y0 + h; y++) {
        printf("%s y=%d:", label, y);
        for (int x = x0; x < x0 + w; x++) {
            printf(" %u", (unsigned)m.map[x][y]);
        }
        printf("\n");
    }
}

// The raw tile map of a .cty file: the last 24 000 bytes, big-endian shorts,
// column-major. `loadFile` is NOT used: its doSimInit (simLoadInit, mapScan,
// doPowerScan) rewrites about 800 tiles, which belongs to other modules. The
// tool module only sees the tile map, so the raw map is the input here.
static bool loadRawTiles(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) {
        return false;
    }
    unsigned char buf[24000];
    bool ok = fseek(f, -24000L, SEEK_END) == 0 && fread(buf, 1, 24000, f) == 24000;
    fclose(f);
    if (!ok) {
        return false;
    }
    unsigned short *p = &m.map[0][0];
    for (int i = 0; i < WORLD_W * WORLD_H; i++) {
        p[i] = (unsigned short)((buf[2 * i] << 8) | buf[2 * i + 1]);
    }
    return true;
}

int main()
{
    if (!loadRawTiles("assets/cities/haight.cty")) {
        printf("load fail\n");
        return 1;
    }
    m.callbackHook = hook;
    m.autoBulldoze = true;
    m.doAnimation = true;
    m.totalFunds = 100000;
    m.seedRandom(12345);
    printf("load");
    state();

    // Query: zone status through the callback, out-of-bounds failures.
    doit("query", TOOL_QUERY, 2, 68);
    doit("query", TOOL_QUERY, 10, 2);
    doit("query", TOOL_QUERY, 7, 10);
    doit("query", TOOL_QUERY, 31, 88);
    doit("query", TOOL_QUERY, 0, 0);
    doit("query", TOOL_QUERY, 119, 99);
    doit("query", TOOL_QUERY, -1, 0);
    doit("query", TOOL_QUERY, 120, 0);
    doit("query", TOOL_QUERY, 50, 47);
    doit("query", TOOL_QUERY, 93, 2);
    doit("query", TOOL_QUERY, 0, 6);

    // Park: needs dirt, consumes random numbers before checking the tile.
    doit("park", TOOL_PARK, 7, 10);
    doit("park", TOOL_PARK, 7, 10);
    doit("park", TOOL_PARK, 31, 88);
    doit("park", TOOL_PARK, 0, 6);
    doit("park", TOOL_PARK, 0, 0);
    doit("park", TOOL_PARK, 83, 60);
    doit("park", TOOL_PARK, -1, 5);
    drag("park", TOOL_PARK, 101, 76, 98, 70);
    drag("park", TOOL_PARK, 115, 91, 115, 95);

    // Network: bulldozes auto-clearable tiles (trees) and lays telecom.
    doit("network", TOOL_NETWORK, 0, 6);
    doit("network", TOOL_NETWORK, 0, 6);
    doit("network", TOOL_NETWORK, 0, 7);
    doit("network", TOOL_NETWORK, 2, 68);
    drag("network", TOOL_NETWORK, 20, 20, 23, 25);
    m.totalFunds = 5;
    doit("network", TOOL_NETWORK, 0, 8); // NO_MONEY: cost 101
    m.totalFunds = 100000;

    // Bulldozer on zone centres (zone path: rubble, no connect).
    doit("bulldozer", TOOL_BULLDOZER, 10, 13);
    doit("bulldozer", TOOL_BULLDOZER, 2, 68);
    doit("bulldozer", TOOL_BULLDOZER, 6, 73);
    doit("bulldozer", TOOL_BULLDOZER, -1, 0);
    m.totalFunds = 0;
    doit("bulldozer", TOOL_BULLDOZER, 10, 43); // NO_MONEY
    bull2(10, 43); // bulldozerTool(x,y) applies without a funds check
    m.totalFunds = 100000;

    // Water and land on zone centres: bulldoze, then lay the terrain.
    doit("water", TOOL_WATER, 2, 87);
    doit("land", TOOL_LAND, 6, 77);

    // Buildings that fail before any connect: roads or off-map footprints.
    doit("residential", TOOL_RESIDENTIAL, 1, 1);
    doit("commercial", TOOL_COMMERCIAL, 0, 0);
    doit("industrial", TOOL_INDUSTRIAL, 119, 99);
    doit("firestation", TOOL_FIRESTATION, 1, 1);
    doit("policestation", TOOL_POLICESTATION, 2, 1);
    doit("stadium", TOOL_STADIUM, 1, 1);
    doit("seaport", TOOL_SEAPORT, 119, 0);
    doit("coalpower", TOOL_COALPOWER, 1, 99);
    doit("airport", TOOL_AIRPORT, 1, 1);

    // Auto-bulldoze switched off: trees need a bulldozer first.
    m.autoBulldoze = false;
    doit("residential", TOOL_RESIDENTIAL, 13, 28);
    drag("residential", TOOL_RESIDENTIAL, 1, 1, 13, 28);
    m.autoBulldoze = true;

    // toolDown reports NEED_BULLDOZE through a message; state is unchanged.
    down("residential", TOOL_RESIDENTIAL, 1, 1);
    down("park", TOOL_PARK, 0, 0);

    window("win-a", 0, 0, 6, 4);
    window("win-b", 9, 11, 6, 6);
    return 0;
}
