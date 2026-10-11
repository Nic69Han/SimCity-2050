#!/usr/bin/env bash
# Differential test for player actions (building tools) during a running simulation.
# For each city, each assets/scripts/*.tools script and disasters off/on, runs the ORIGINAL
# C++ oracle (ORACLE_SCRIPT) and the Rust fingerprint example, and requires identical output:
# per-tick fingerprints plus one "act" line per applied action.
# Usage: scripts/compare-tools.sh [ticks]   (default 600; actions after that tick are not applied)
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-600}"
reference/build-oracle.sh >/dev/null
cargo build --release -p micropolis-core --example fingerprint >/dev/null 2>&1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail=0
runs=0
actions=0
declare -A tally=()
for city in assets/cities/*.cty; do
  for script in assets/scripts/*.tools; do
    case "$(basename "$script")" in budget_*) continue ;; esac # money scripts: scripts/compare-budget.sh
    # Actions the run will apply: those whose tick is within the simulated range.
    expected=$(awk -v t="$TICKS" '!/^#/ && NF>=5 && $1+0 <= t+0 {n++} END {print n+0}' "$script")
    for dis in 0 1; do
      for seed in 1 5; do
        if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
        export ORACLE_SCRIPT="$script"
        reference/build/oracle "$city" "$seed" "$TICKS" > "$WORK/oracle.out"
        target/release/examples/fingerprint "$city" "$seed" "$TICKS" > "$WORK/rust.out"
        unset ORACLE_SCRIPT
        runs=$((runs + 1))
        applied=$(grep -c '^act ' "$WORK/oracle.out" || true)
        label="$(basename "$city") $(basename "$script") disasters=$dis seed=$seed"
        if [ "$applied" != "$expected" ]; then
          echo "FAIL $label: oracle applied $applied actions, expected $expected"
          fail=1
        elif cmp -s "$WORK/oracle.out" "$WORK/rust.out"; then
          echo "OK   $label ($TICKS ticks, $applied actions)"
          actions=$((actions + applied))
          # Tally the ToolResult of each applied click (drags print result=0 and are not counted).
          while read -r kind code; do
            if [ "$kind" = down ]; then tally[$code]=$(( ${tally[$code]:-0} + 1 )); fi
          done < <(awk -v t="$TICKS" -v n=0 '
              FNR == NR { if (!/^#/ && NF >= 5 && $1 + 0 <= t + 0) kind[n++] = $2; next }
              /^act / { r = $4; sub("result=", "", r); print kind[$3], r }' "$script" "$WORK/oracle.out")
        else
          echo "DIFF $label: first mismatch:"
          diff "$WORK/oracle.out" "$WORK/rust.out" | head -4
          fail=1
        fi
      done
    done
  done
done
unset ORACLE_DISASTERS
echo "runs=$runs actions_applied=$actions"
echo "ToolResult codes of the down clicks over all runs:"
for k in -2 -1 0 1; do echo "  result=$k: ${tally[$k]:-0}"; done
exit $fail
