#!/usr/bin/env bash
# Build the ORIGINAL C++ engine with a different world size, as the oracle for that size.
#
# Usage: scripts/build-oracle-size.sh <W> <H>
# Output: reference/build/oracle_gen_<W>x<H>  (same program and output as reference/build/oracle_gen)
#
# The committed reference/micropolis-cpp tree is NOT modified: it is copied to a scratch
# directory, WORLD_W / WORLD_H are patched there (map_type.h, the only place they are
# defined; micropolis.h derives WORLD_W_2/4/8 and POWER_STACK_SIZE from them), and the
# same determinism patches already in the tree are kept as they are. The scratch copy is
# removed afterwards. Set TMPDIR to choose where the scratch copy goes.
set -euo pipefail
if [ $# -ne 2 ]; then echo "usage: $0 <W> <H>" >&2; exit 2; fi
W="$1"
H="$2"
case "$W$H" in
  *[!0-9]*|"") echo "W and H must be positive integers" >&2; exit 2 ;;
esac
if [ "$W" -lt 80 ] || [ "$H" -lt 67 ] || [ "$W" -gt 512 ] || [ "$H" -gt 512 ]; then
  echo "size ${W}x${H} outside the oracle range (80x67 .. 512x512)" >&2
  exit 2
fi
here="$(cd "$(dirname "$0")/.." && pwd)"   # repository root
ref="$here/reference"
work="$(mktemp -d "${TMPDIR:-/tmp}/micropolis-size-${W}x${H}-XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp -r "$ref/micropolis-cpp" "$work/micropolis-cpp"
map_type="$work/micropolis-cpp/map_type.h"
sed -i -e "s/static const int WORLD_W = 120;/static const int WORLD_W = ${W};/" \
       -e "s/static const int WORLD_H = 100;/static const int WORLD_H = ${H};/" "$map_type"
grep -q "static const int WORLD_W = ${W};" "$map_type"
grep -q "static const int WORLD_H = ${H};" "$map_type"

# Oracle patch (sizes only). The 2x2 scans of the C++ engine (pollutionTerrainLandValueScan
# and friends) read map[x+1][y+1] one past the world when W or H is odd, and block scans can
# reach the next multiple of 8: undefined behaviour in the original. Here the map gets PAD
# zeroed columns and rows beyond the world (column stride WORLD_H+PAD), so every out-of-world
# read sees an empty tile (0), which is what the Rust core returns for out-of-world reads
# (Simulation::tile -> None -> 0). Inside the world nothing changes; where no read leaves the
# world the result is identical to the unpatched engine.
PAD=8
S="$work/micropolis-cpp"
sed -i "s/unsigned short \*map\[WORLD_W\];/unsigned short *map[WORLD_W + ${PAD}];/" "$S/micropolis.h"
sed -i -e "s/sizeof(short \*) \* WORLD_W);/sizeof(short *) * (WORLD_W + ${PAD}));/" "$S/micropolis.cpp"
sed -i -e "s/sizeof(short \*) \* WORLD_W);/sizeof(short *) * (WORLD_W + ${PAD}));/" \
       -e "s/for (i = 0; i < WORLD_W; i++) {/for (i = 0; i < WORLD_W + ${PAD}; i++) {/" \
       -e "s/map\[i\] = (unsigned short \*)(mapBase + (i \* WORLD_H));/map[i] = (unsigned short *)(mapBase + (i * (WORLD_H + ${PAD})));/" \
       -e "s/^            WORLD_W \* WORLD_H);/            (WORLD_W + ${PAD}) * (WORLD_H + ${PAD}));/" "$S/allocate.cpp"
# animateTiles walks the flat array; with padding it must walk the world tile by tile.
sed -i "s|for (i = WORLD_W \* WORLD_H; i > 0; i--) {|for (i = 0; i < WORLD_W * WORLD_H; i++) { tMapPtr = \&map[i / WORLD_H][i % WORLD_H];|" "$S/animate.cpp"
grep -q "map\[WORLD_W + ${PAD}\]" "$S/micropolis.h"
grep -q "(WORLD_W + ${PAD}) \* (WORLD_H + ${PAD})" "$S/allocate.cpp"
grep -q "i / WORLD_H\]" "$S/animate.cpp"
grep -q "mapBase + (i \* (WORLD_H + ${PAD}))" "$S/allocate.cpp"

SRC=$(cd "$work/micropolis-cpp" && ls *.cpp | grep -v '^map.cpp$' | sed "s|^|$work/micropolis-cpp/|")
mkdir -p "$ref/build"
out="$ref/build/oracle_gen_${W}x${H}"
g++ -std=c++11 -w -O1 -I"$work/micropolis-cpp" -o "$out" $SRC "$ref/oracle_gen.cpp"
echo "built reference/build/oracle_gen_${W}x${H}"
