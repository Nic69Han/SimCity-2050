#!/usr/bin/env bash
# Differential test of city files (save and load across map sizes): a city is generated and
# saved by the Rust port (examples/save_gen: new_random_city, a starter-like build, N ticks,
# save_city), then loaded by the ORIGINAL C++ engine (loadFile, reference/oracle_load.cpp,
# recompiled at that size by scripts/build-oracle-size.sh W H --load) and by the Rust port
# (Simulation::load_city, examples/fingerprint_load). Both print one fingerprint per tick,
# tick 0 being the city right after loading; they must be identical for TICKS ticks.
#
# Matrix: sizes 97x83, 160x120, 240x200 and 300x250 (extended file, payload = the file without
# its 10-byte header) and 120x100 (plain .cty, the existing path), each generated and saved
# after 400 and after 2000 ticks; the 120x100 samples (assets/cities/*.cty, populated) loaded,
# run 400 and 2000 ticks and saved; load seeds 1 and 5; disasters off and on.
# (A generated city grows little in a few thousand ticks, in the original as in the port; the
# samples give the populated cities.)
# Usage: scripts/compare-saveload.sh [ticks]   (default 600)
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-600}"
case "$TICKS" in ''|*[!0-9]*) echo "ticks must be a number" >&2; exit 2 ;; esac
SIZES="97x83 160x120 240x200 300x250 120x100"
GEN_TICKS="400 2000"
GEN_SEED=3
WORK="$(mktemp -d "${TMPDIR:-/tmp}/saveload-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then echo "no work directory" >&2; exit 2; fi

cargo build --release -p micropolis-core --example save_gen --example fingerprint_load >/dev/null 2>&1
for size in $SIZES; do
  scripts/build-oracle-size.sh "${size%x*}" "${size#*x}" --load >/dev/null &
done
wait

# compare <label> <city file> <size>: the load of the file by both engines, for each seed and
# disasters setting; the payload is the file without its 10-byte header (a .cty is its own).
fail=0
runs=0
ok=0
compare() {
  local label="$1" file="$2" size="$3" payload
  if [ "$size" = 120x100 ]; then
    payload="$file"
  else
    payload="$file.payload"
    tail -c +11 "$file" > "$payload"
  fi
  local seed dis name lines last pop
  for seed in 1 5; do
    for dis in 0 1; do
      name="$WORK/run_${label}_${seed}_${dis}"
      if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
      reference/build/oracle_load_"$size" "$seed" "$TICKS" "$payload" > "$name.oracle"
      target/release/examples/fingerprint_load "$seed" "$TICKS" "$file" > "$name.rust"
      unset ORACLE_DISASTERS
      runs=$((runs + 1))
      lines=$((TICKS + 1))
      if [ "$(wc -l < "$name.oracle")" -ne "$lines" ] || [ "$(wc -l < "$name.rust")" -ne "$lines" ]; then
        echo "FAIL $label seed=$seed disasters=$dis: missing fingerprint lines"
        fail=1
      elif cmp -s "$name.oracle" "$name.rust"; then
        ok=$((ok + 1))
        last=$(tail -1 "$name.oracle")
        pop=$(sed -n 's/.* pop=\([0-9]*\).*/\1/p' <<< "$last")
        echo "OK   $label size=$size seed=$seed disasters=$dis ticks=$TICKS final_pop=$pop bytes=$(wc -c < "$file")"
      else
        echo "DIFF $label size=$size seed=$seed disasters=$dis: first mismatch:"
        diff "$name.oracle" "$name.rust" | head -4
        fail=1
      fi
    done
  done
}

for size in $SIZES; do
  for gen in $GEN_TICKS; do
    file="$WORK/city_${size}_${gen}.bin"
    target/release/examples/save_gen "${size%x*}" "${size#*x}" "$GEN_SEED" "$gen" > "$file" 2>/dev/null
    compare "generated after=$gen" "$file" "$size"
  done
done
for asset in assets/cities/*.cty; do
  for gen in $GEN_TICKS; do
    file="$WORK/sample_$(basename "$asset" .cty)_${gen}.bin"
    target/release/examples/save_gen --from "$asset" "$GEN_SEED" "$gen" > "$file" 2>/dev/null
    compare "sample $(basename "$asset" .cty) after=$gen" "$file" 120x100
  done
done

echo "runs=$runs identical=$ok"
if [ "$fail" = 0 ]; then echo "all $runs runs identical"; fi
exit $fail
