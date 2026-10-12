// Reference oracle for the player messages: runs the ORIGINAL C++ engine and prints,
// per tick, every front-end callback the page presents (messages, sounds, auto-goto,
// earthquakes, win/lose, new game), recorded through callbackHook (as in
// reference/gold/misc_events.cpp). Map updates, funds, dates and other display
// callbacks are not printed: the page reads those from the engine state.
//
// Usage: [ORACLE_DISASTERS=1] [ORACLE_SCRIPT=actions.tools] oracle_events <city.cty|gen> <seed> <ticks>
//   city.cty: loadFile(city) with the seed set as reference/oracle.cpp does.
//   gen:      generateSomeCity(seed) as reference/oracle_gen.cpp does.
// Sound is enabled (enableSound = true) so that makeSound callbacks are recorded.
// Output, in order of occurrence (tick N = the step before simTick of tick N, tick 0 = after load/generation):
//   act <tick> <index> result=<ToolResult or 0 for drag> funds=<totalFunds>   (as oracle.cpp)
//   <tick> M <num> <x> <y> <picture> <important>     sendMessage
//   <tick> S <channel> <sound> <x> <y>               makeSound (enableSound on)
//   <tick> G <x> <y>                                 autoGoto
//   <tick> QUAKE <strength>                          startEarthquake
//   <tick> LOSE | <tick> WIN | <tick> NEW            loseGame | winGame | newGame
// Build: reference/build-oracle-events.sh
#define private public
#include "micropolis.h"
#include "text.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <vector>

static int g_tick = 0;

static void hook(Micropolis*, void*, const char* name, const char* params, va_list ap) {
    if (!strcmp(name, "update")) {
        const char* what = va_arg(ap, const char*);
        if (!strcmp(params, "sdddbb") && !strcmp(what, "message")) {
            int num = va_arg(ap, int), x = va_arg(ap, int), y = va_arg(ap, int);
            int pic = va_arg(ap, int), imp = va_arg(ap, int);
            printf("%d M %d %d %d %d %d\n", g_tick, num, x, y, pic, imp);
        }
    } else if (!strcmp(name, "makeSound")) {
        const char* ch = va_arg(ap, const char*);
        const char* snd = va_arg(ap, const char*);
        int x = va_arg(ap, int), y = va_arg(ap, int);
        printf("%d S %s %s %d %d\n", g_tick, ch, snd, x, y);
    } else if (!strcmp(name, "autoGoto")) {
        int x = va_arg(ap, int), y = va_arg(ap, int);
        printf("%d G %d %d\n", g_tick, x, y);
    } else if (!strcmp(name, "startEarthquake")) {
        printf("%d QUAKE %d\n", g_tick, va_arg(ap, int));
    } else if (!strcmp(name, "loseGame")) {
        printf("%d LOSE\n", g_tick);
    } else if (!strcmp(name, "winGame")) {
        printf("%d WIN\n", g_tick);
    } else if (!strcmp(name, "newGame")) {
        printf("%d NEW\n", g_tick);
    }
}

struct Action {
    int tick;
    bool drag;
    int tool;
    int x0, y0, x1, y1;
};

// Reads the script (same syntax as reference/oracle.cpp); exits on a malformed line.
static std::vector<Action> load_script(const char* path) {
    std::vector<Action> acts;
    FILE* f = fopen(path, "r");
    if (!f) { fprintf(stderr, "cannot open script %s\n", path); exit(2); }
    char line[512];
    int lineno = 0;
    while (fgets(line, sizeof line, f)) {
        lineno++;
        char* hash = strchr(line, '#');
        if (hash) *hash = 0;
        char kind[16];
        Action a;
        if (strspn(line, " \t\r\n") == strlen(line)) continue; // blank or comment-only line
        if (sscanf(line, "%d %15s", &a.tick, kind) != 2) { fprintf(stderr, "%s:%d: bad action\n", path, lineno); exit(2); }
        if (strcmp(kind, "down") == 0 &&
            sscanf(line, "%*d %*s %d %d %d", &a.tool, &a.x0, &a.y0) == 3) {
            a.drag = false; a.x1 = a.x0; a.y1 = a.y0;
        } else if (strcmp(kind, "drag") == 0 &&
                   sscanf(line, "%*d %*s %d %d %d %d %d", &a.tool, &a.x0, &a.y0, &a.x1, &a.y1) == 5) {
            a.drag = true;
        } else {
            fprintf(stderr, "%s:%d: bad action\n", path, lineno); exit(2);
        }
        if (a.tool < 0 || a.tool >= TOOL_COUNT) { fprintf(stderr, "%s:%d: bad tool\n", path, lineno); exit(2); }
        acts.push_back(a);
    }
    fclose(f);
    return acts;
}

// toolDown() of tool.cpp, mirrored line for line so that the ToolResult of doTool()
// is visible (as in reference/oracle.cpp); its messages and sounds are recorded.
static int tool_down_result(Micropolis& m, EditingTool tool, short x, short y) {
    ToolResult result = m.doTool(tool, x, y);
    if (result == TOOLRESULT_NEED_BULLDOZE) {
        m.sendMessage(MESSAGE_BULLDOZE_AREA_FIRST, NOWHERE, NOWHERE, false, true);
        m.makeSound("interface", "UhUh", x * 16, y * 16);
    } else if (result == TOOLRESULT_NO_MONEY) {
        m.sendMessage(MESSAGE_NOT_ENOUGH_FUNDS, NOWHERE, NOWHERE, false, true);
        m.makeSound("interface", "Sorry", x * 16, y * 16);
    }
    m.simPass = 0;
    m.invalidateMaps();
    return (int)result;
}

static void apply_action(Micropolis& m, const Action& a, int index) {
    int result = 0;
    if (a.drag) {
        m.toolDrag((EditingTool)a.tool, (short)a.x0, (short)a.y0, (short)a.x1, (short)a.y1);
    } else {
        result = tool_down_result(m, (EditingTool)a.tool, (short)a.x0, (short)a.y0);
    }
    printf("act %d %d result=%d funds=%ld\n", a.tick, index, result, (long)m.totalFunds);
}

int main(int argc, char** argv) {
    if (argc < 4) { fprintf(stderr, "usage: oracle_events <city.cty|gen> seed ticks\n"); return 2; }
    bool gen = strcmp(argv[1], "gen") == 0;
    int seed = atoi(argv[2]);
    char buf[32];
    snprintf(buf, sizeof buf, "%d", seed);
    setenv("MICROPOLIS_SEED", buf, 1); // read by randomlySeedRandom() (oracle patch)
    Micropolis m;
    if (gen) {
        m.generateSomeCity(seed);
    } else if (!m.loadFile(argv[1])) {
        printf("load fail\n");
        return 1;
    }
    m.setEnableDisasters(getenv("ORACLE_DISASTERS") != NULL); // env ORACLE_DISASTERS=1 enables them
    m.setEnableSound(true);
    m.setSpeed(3);
    m.setPasses(1);
    // Recording starts after the city exists: generation/load callbacks are not part of the stream.
    m.callbackHook = hook;
    int ticks = atoi(argv[3]);
    std::vector<Action> acts;
    if (getenv("ORACLE_SCRIPT")) acts = load_script(getenv("ORACLE_SCRIPT"));
    size_t next = 0;
    for (int t = 0; t <= ticks; t++) {
        g_tick = t;
        for (; next < acts.size() && acts[next].tick == t; next++) apply_action(m, acts[next], (int)next);
        if (t > 0) m.simTick();
    }
    return 0;
}
