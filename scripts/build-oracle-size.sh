#!/usr/bin/env bash
# Build the ORIGINAL C++ engine with a different world size, as the oracle for that size.
#
# Usage: scripts/build-oracle-size.sh <W> <H> [--load]
# Output: reference/build/oracle_gen_<W>x<H>  (same program and output as reference/build/oracle_gen)
#         with --load: reference/build/oracle_load_<W>x<H> (reference/oracle_load.cpp, the
#         loadFile oracle of scripts/compare-saveload.sh; its loadFile also reads a W x H payload)
#
# The committed reference/micropolis-cpp tree is NOT modified: it is copied to a scratch
# directory, WORLD_W / WORLD_H are patched there (map_type.h, the only place they are
# defined; micropolis.h derives WORLD_W_2/4/8 and POWER_STACK_SIZE from them), and the
# same determinism patches already in the tree are kept as they are. The scratch copy is
# removed afterwards. Set TMPDIR to choose where the scratch copy goes.
set -euo pipefail
if [ $# -ne 2 ] && [ $# -ne 3 ]; then echo "usage: $0 <W> <H> [--load]" >&2; exit 2; fi
W="$1"
H="$2"
LOAD=0
if [ $# -eq 3 ]; then
  if [ "$3" != "--load" ]; then echo "unknown option: $3" >&2; exit 2; fi
  LOAD=1
fi
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

if [ "$LOAD" = 1 ]; then
  # Oracle patch (--load only): loadFile reads a city file of this size. The expected length is
  # the payload of the W x H city (the file without the extended header; for 120x100 the .cty
  # itself), and the map is read column by column, because the padded storage of the map has
  # WORLD_H + PAD shorts per column. Everything else in loadFile is the original.
  python3 - "$S/fileio.cpp" "$W" "$H" <<'PY'
import sys
path, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
src = open(path).read()
old_size = "(size == 27120) &&"
new_size = "(size == 2 * (6 * (HISTORY_LENGTH / 2) + MISC_HISTORY_LENGTH / 2 + WORLD_W * WORLD_H)) &&"
old_map = "load_short(((short *)&map[0][0]), WORLD_W * WORLD_H, f)"
new_map = ("([&]() { for (int x = 0; x < WORLD_W; x++) "
           "if (!load_short((short *)map[x], WORLD_H, f)) return false; return true; })()")
assert src.count(old_size) == 1 and src.count(old_map) == 1, "loadFile changed: patch by hand"
src = src.replace(old_size, new_size).replace(old_map, new_map)
open(path, "w").write(src)
PY
  grep -q "WORLD_W \* WORLD_H)) &&" "$S/fileio.cpp"
  grep -q "map\[x\], WORLD_H, f" "$S/fileio.cpp"
  SRC=$(cd "$work/micropolis-cpp" && ls *.cpp | grep -v '^map.cpp$' | sed "s|^|$work/micropolis-cpp/|")
  mkdir -p "$ref/build"
  out="$ref/build/oracle_load_${W}x${H}"
  g++ -std=c++11 -w -O1 -I"$work/micropolis-cpp" -o "$out" $SRC "$ref/oracle_load.cpp"
  echo "built reference/build/oracle_load_${W}x${H}"
  exit 0
fi

SRC=$(cd "$work/micropolis-cpp" && ls *.cpp | grep -v '^map.cpp$' | sed "s|^|$work/micropolis-cpp/|")
mkdir -p "$ref/build"
out="$ref/build/oracle_gen_${W}x${H}"
g++ -std=c++11 -w -O1 -I"$work/micropolis-cpp" -o "$out" $SRC "$ref/oracle_gen.cpp"
echo "built reference/build/oracle_gen_${W}x${H}"
