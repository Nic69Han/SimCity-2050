#!/usr/bin/env bash
# Build the reference C++ engine + oracle into reference/build/oracle
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
SRC=$(cd micropolis-cpp && ls *.cpp | grep -v '^map.cpp$' | sed 's|^|micropolis-cpp/|')
g++ -std=c++11 -w -O1 -Imicropolis-cpp -o build/oracle $SRC oracle.cpp
echo "built reference/build/oracle"
