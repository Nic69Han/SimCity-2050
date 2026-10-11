#!/usr/bin/env bash
# Build reference/gold/zone_gold.cpp against the ORIGINAL engine.
# traffic.cpp is another module's code: it is compiled with makeTraffic renamed
# (so its own definitions and internal calls stay consistent but no longer provide
# the symbol zone.cpp uses), and the harness supplies the makeTraffic stub.
# Output: reference/build/zone_gold
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p reference/build/zone_obj
SRC=$(cd reference/micropolis-cpp && ls *.cpp | grep -v '^map.cpp$' | grep -v '^traffic.cpp$' | sed 's|^|reference/micropolis-cpp/|')
g++ -std=c++11 -w -O1 -Ireference/micropolis-cpp -DmakeTraffic=unusedMakeTraffic \
    -c reference/micropolis-cpp/traffic.cpp -o reference/build/zone_obj/traffic.o
g++ -std=c++11 -w -O1 -Ireference/micropolis-cpp -o reference/build/zone_gold $SRC \
    reference/build/zone_obj/traffic.o reference/gold/zone_gold.cpp
echo "built reference/build/zone_gold"
