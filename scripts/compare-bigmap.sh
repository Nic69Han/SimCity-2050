#!/usr/bin/env bash
# Differential test across world sizes: the ORIGINAL C++ engine recompiled at each size
# (reference/build/oracle_gen_WxH via scripts/build-oracle-size.sh; 120x100 uses the committed
# reference/build/oracle_gen) and the Rust port at the same size (examples/fingerprint_gen with
# ORACLE_SIZE=WxH) must print identical per-tick fingerprints (time, funds, populations,
# valves, averages, hash of the whole tile map).
#
# Matrix:
#   * new random cities (generateSomeCity) on 120x100, 100x80, 97x83, 160x120, 240x200,
#     300x250 and 90x300, seeds 1, 2, 3, disasters off and on;
#   * starter city (scripts/gen-tool-script.py --starter --size) on 97x83 (seed 1),
#     240x200 (seed 2) and 300x250 (seed 3), disasters off and on: the player's actions are
#     applied by both engines at the same ticks.
# Usage: scripts/compare-bigmap.sh [ticks]   (default 300)
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-300}"
case "$TICKS" in ''|*[!0-9]*) echo "ticks must be a number" >&2; exit 2 ;; esac
SIZES="120x100 100x80 97x83 160x120 240x200 300x250 90x300"
STARTER="97x83:1 240x200:2 300x250:3"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Oracles: the committed 120x100 build, one patched build per other size (in parallel).
reference/build-oracle-gen.sh >/dev/null
for size in $SIZES; do
  if [ "$size" != 120x100 ]; then
    scripts/build-oracle-size.sh "${size%x*}" "${size#*x}" >/dev/null &
  fi
done
wait
cargo build --release -p micropolis-core --example fingerprint_gen >/dev/null 2>&1
oracle_for() { if [ "$1" = 120x100 ]; then echo reference/build/oracle_gen; else echo "reference/build/oracle_gen_$1"; fi; }

fail=0
runs=0
ok=0
# compare <label> <size> <oracle args...> -- runs both engines and compares the outputs
compare() {
  local label="$1" size="$2" script_env="$3"
  shift 3
  local dis="$1"; shift
  local name="$WORK/$label-$dis"
  if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
  if [ -n "$script_env" ]; then export ORACLE_SCRIPT="$script_env"; else unset ORACLE_SCRIPT; fi
  "$(oracle_for "$size")" "$@" > "$name.oracle"
  ORACLE_SIZE="$size" target/release/examples/fingerprint_gen "$@" > "$name.rust"
  unset ORACLE_SCRIPT ORACLE_DISASTERS
  runs=$((runs + 1))
  if cmp -s "$name.oracle" "$name.rust"; then
    ok=$((ok + 1))
    local last pop
    last=$(grep '^tick ' "$name.oracle" | tail -1)
    pop=$(sed -n 's/.* pop=\([0-9]*\).*/\1/p' <<< "$last")
    echo "OK   $label size=$size disasters=$dis ticks=$TICKS final_pop=$pop acts=$(grep -c '^act ' "$name.oracle" || true)"
  else
    echo "DIFF $label size=$size disasters=$dis: first mismatch:"
    diff "$name.oracle" "$name.rust" | head -4
    fail=1
  fi
}

for size in $SIZES; do
  for seed in 1 2 3; do
    for dis in 0 1; do
      compare "newcity seed=$seed" "$size" "" "$dis" "$seed" "$TICKS" some
    done
  done
done

for pair in $STARTER; do
  size="${pair%:*}"
  seed="${pair#*:}"
  script="$WORK/starter_${size}_${seed}.tools"
  dump="$WORK/dump_${size}_${seed}.txt"
  ORACLE_DUMP_MAP="$dump" "$(oracle_for "$size")" "$seed" 0 some > /dev/null
  python3 scripts/gen-tool-script.py --starter "$seed" --map "$dump" --size "$size" --ticks "$TICKS" > "$script"
  for dis in 0 1; do
    compare "starter seed=$seed" "$size" "$script" "$dis" "$seed" "$TICKS" some
  done
done

echo "runs=$runs identical=$ok"
if [ "$fail" = 0 ]; then echo "all $runs runs identical"; fi
exit $fail
