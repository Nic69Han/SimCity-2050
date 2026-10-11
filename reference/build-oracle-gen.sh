#!/usr/bin/env bash
# Build the reference C++ engine + the new-city oracle into reference/build/oracle_gen
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
SRC=$(cd micropolis-cpp && ls *.cpp | grep -v '^map.cpp$' | sed 's|^|micropolis-cpp/|')
g++ -std=c++11 -w -O1 -Imicropolis-cpp -o build/oracle_gen $SRC oracle_gen.cpp
echo "built reference/build/oracle_gen"
