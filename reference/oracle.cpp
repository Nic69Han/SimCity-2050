// Reference oracle: runs the ORIGINAL C++ engine and prints state fingerprints.
// Usage: [ORACLE_DISASTERS=1] [ORACLE_SCRIPT=actions.tools] oracle <city.cty> <seed> <ticks> [dump_dir]
// Prints one line per tick: "tick N key=value ..." so Rust can be diffed line by line.
// With dump_dir, also writes <dump_dir>/map_<N>.txt (12000 tile values, column-major).
// With ORACLE_SCRIPT, player actions are applied before the tick they name, and each
// one prints "act <tick> <index> result=<ToolResult or 0 for drag> funds=<totalFunds>".
// Script lines: "<tick> down <tool> <x> <y>" or "<tick> drag <tool> <x0> <y0> <x1> <y1>";
// '#' starts a comment. Actions with tick N run before simulating tick N (tick 0 = after load).
#define private public
#include "micropolis.h"
#include "text.h"
#undef private
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <vector>

static uint64_t fnv(const unsigned short* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) { h ^= p[i] & 0xff; h *= 1099511628211ULL; h ^= p[i] >> 8; h *= 1099511628211ULL; }
    return h;
}

struct Action {
    int tick;
    bool drag;
    int tool;
    int x0, y0, x1, y1;
};

// Reads the script; exits on a malformed line so a bad script cannot silently pass.
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

// Applies one click. The original toolDown() (tool.cpp) is doTool() followed by
// the UI-only message/sound calls, simPass = 0 and invalidateMaps(). doTool() returns
// the ToolResult, which toolDown() discards, so this mirrors toolDown() line for line
// to obtain that result. The message/sound/invalidate callbacks are no-ops here
// (callbackHook is NULL), so the simulation state matches toolDown() exactly.
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
    if (argc < 4) { fprintf(stderr, "usage: oracle city.cty seed ticks [dump_dir]\n"); return 2; }
    setenv("MICROPOLIS_SEED", argv[2], 1); // read by randomlySeedRandom() (oracle patch)
    Micropolis m;
    if (!m.loadFile(argv[1])) { printf("load fail\n"); return 1; }
    m.setEnableDisasters(getenv("ORACLE_DISASTERS") != NULL); // env ORACLE_DISASTERS=1 enables them
    m.setSpeed(3);
    m.setPasses(1);
    int ticks = atoi(argv[3]);
    const char* dump = argc > 4 ? argv[4] : NULL;
    std::vector<Action> acts;
    if (getenv("ORACLE_SCRIPT")) acts = load_script(getenv("ORACLE_SCRIPT"));
    size_t next = 0;
    for (int t = 0; t <= ticks; t++) {
        for (; next < acts.size() && acts[next].tick == t; next++) apply_action(m, acts[next], (int)next);
        if (t > 0) m.simTick();
        printf("tick %d time=%ld funds=%ld pop=%d res=%d com=%d ind=%d resV=%d comV=%d indV=%d crime=%d poll=%d lv=%d traf=%d maphash=%016llx\n",
               t, (long)m.cityTime, (long)m.totalFunds, (int)m.totalPop, (int)m.resPop, (int)m.comPop, (int)m.indPop,
               (int)m.resValve, (int)m.comValve, (int)m.indValve, (int)m.crimeAverage, (int)m.pollutionAverage,
               (int)m.landValueAverage, (int)m.trafficAverage, (unsigned long long)fnv(&m.map[0][0], WORLD_W * WORLD_H));
        if (dump) {
            char path[512]; snprintf(path, sizeof path, "%s/map_%d.txt", dump, t);
            FILE* f = fopen(path, "w");
            for (int i = 0; i < WORLD_W * WORLD_H; i++) fprintf(f, "%u\n", (&m.map[0][0])[i]);
            fclose(f);
        }
    }
    return 0;
}
