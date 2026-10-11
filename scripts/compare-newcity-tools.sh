#!/usr/bin/env bash
# Differential test for "generate a new city, then build and grow it": for each seed, the
# ORIGINAL C++ engine (reference/oracle_gen, generateSomeCity(seed) + ORACLE_SCRIPT) and the
# Rust port (examples/fingerprint_gen, same script) must print identical output: a per-tick
# fingerprint (time, funds, populations, valves, averages, tile-map hash) and one "act" line
# per applied player action. The script assets/scripts/starter_<seed>.tools is a plausible
# first city (power plant, roads, power lines, zones, services, park, stadium) spread over
# the first 3000 ticks, made by scripts/gen-tool-script.py --starter.
# Runs with disasters off and on. Also reports numbers showing that the city really grows.
# Usage: scripts/compare-newcity-tools.sh [ticks]   (default 1500; actions after that tick are not applied)
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-1500}"
reference/build-oracle-gen.sh >/dev/null
cargo build --release -p micropolis-core --example fingerprint_gen >/dev/null 2>&1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SEEDS="1 2 3 7 42"
fail=0
runs=0
actions=0
declare -A tally=()
zones_built=0
pop_min= pop_max= funds_min= funds_max=
for seed in $SEEDS; do
  script="assets/scripts/starter_${seed}.tools"
  # Actions the run will apply: those whose tick is within the simulated range.
  expected=$(awk -v t="$TICKS" '!/^#/ && NF>=5 && $1+0 <= t+0 {n++} END {print n+0}' "$script")
  for dis in 0 1; do
    if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
    export ORACLE_SCRIPT="$script"
    reference/build/oracle_gen "$seed" "$TICKS" some > "$WORK/oracle.out"
    target/release/examples/fingerprint_gen "$seed" "$TICKS" some > "$WORK/rust.out"
    unset ORACLE_SCRIPT
    runs=$((runs + 1))
    applied=$(grep -c '^act ' "$WORK/oracle.out" || true)
    label="seed=$seed disasters=$dis"
    last=$(grep '^tick ' "$WORK/oracle.out" | tail -1)
    pop=$(sed -n 's/.* pop=\([0-9]*\).*/\1/p' <<< "$last")
    funds=$(sed -n 's/.* funds=\([-0-9]*\).*/\1/p' <<< "$last")
    # Peak population over the whole run: the final value can transiently be 0 between censuses.
    peak=$(awk '/^tick / { for (i = 1; i <= NF; i++) if ($i ~ /^pop=/) { v = substr($i, 5) + 0; if (v > m) m = v } } END { print m + 0 }' "$WORK/oracle.out")
    zones=$(awk '
        FNR == NR { if (!/^#/ && NF >= 5 && $1 + 0 <= t + 0) { tool[n] = $3; kind[n] = $2; n++ }; next }
        /^act / { r = $4; sub("result=", "", r) }
        /^act / && kind[$3] == "down" && tool[$3] <= 2 && r == 1 { z++ }
        END { print z + 0 }' t="$TICKS" "$script" "$WORK/oracle.out")
    zones_built=$((zones_built + zones))
    if [ "$applied" != "$expected" ]; then
      echo "FAIL $label: oracle applied $applied actions, expected $expected"
      fail=1
    elif cmp -s "$WORK/oracle.out" "$WORK/rust.out"; then
      echo "OK   $label ($TICKS ticks, $applied actions, zones built $zones, final pop=$pop funds=$funds)"
      actions=$((actions + applied))
      # Tally the ToolResult of each applied click (drags print result=0 and are not counted).
      while read -r kind code; do
        if [ "$kind" = down ]; then tally[$code]=$(( ${tally[$code]:-0} + 1 )); fi
      done < <(awk -v t="$TICKS" -v n=0 '
          FNR == NR { if (!/^#/ && NF >= 5 && $1 + 0 <= t + 0) kind[n++] = $2; next }
          /^act / { r = $4; sub("result=", "", r); print kind[$3], r }' "$script" "$WORK/oracle.out")
      if [ -z "$pop_min" ] || [ "$pop" -lt "$pop_min" ]; then pop_min=$pop; fi
      if [ -z "$pop_max" ] || [ "$pop" -gt "$pop_max" ]; then pop_max=$pop; fi
      if [ -z "$funds_min" ] || [ "$funds" -lt "$funds_min" ]; then funds_min=$funds; fi
      if [ -z "$funds_max" ] || [ "$funds" -gt "$funds_max" ]; then funds_max=$funds; fi
      # Growth is only expected over long runs: a young city has almost no population yet.
      if [ "$zones" -eq 0 ] || { [ "$TICKS" -ge 1500 ] && [ "$peak" -le 1 ]; }; then
        echo "FAIL $label: the city did not grow (peak pop=$peak, zones built=$zones)"
        fail=1
      fi
    else
      echo "DIFF $label: first mismatch:"
      diff "$WORK/oracle.out" "$WORK/rust.out" | head -4
      fail=1
    fi
  done
done
unset ORACLE_DISASTERS
echo "runs=$runs actions_applied=$actions zones_built=$zones_built"
echo "final population over the runs: $pop_min..$pop_max; final funds: $funds_min..$funds_max"
echo "ToolResult codes of the down clicks over all runs:"
for k in -2 -1 0 1; do echo "  result=$k: ${tally[$k]:-0}"; done
if [ "$fail" = 0 ]; then echo "all $runs runs identical"; fi
exit $fail
