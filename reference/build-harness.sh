#!/usr/bin/env bash
# Build a C++ test harness against the ORIGINAL engine (private members exposed).
# Usage: reference/build-harness.sh my_harness.cpp out_binary
# In the harness: `#define private public` / `#include "micropolis.h"` / `#undef private`,
# create `Micropolis m;`, `m.loadFile("assets/cities/haight.cty")`, call the function under test,
# print results. Set env MICROPOLIS_SEED=<n> before constructing for reproducible randomness.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SRC=$(cd "$here/micropolis-cpp" && ls *.cpp | grep -v '^map.cpp$' | sed "s|^|$here/micropolis-cpp/|")
g++ -std=c++11 -w -O1 -I"$here/micropolis-cpp" -o "$2" $SRC "$1"
