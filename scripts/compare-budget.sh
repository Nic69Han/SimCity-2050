#!/usr/bin/env bash
# Differential test for money management: taxes and budget percents (assets/scripts/budget_*.tools)
# applied during a running simulation. For each sample city (and for a new random city with a
# starter build), each script and disasters off/on, runs the ORIGINAL C++ oracle and the Rust
# fingerprint example and requires identical output: per-tick fingerprints, one "act" line and
# one "fin" line (funds, tax, cash flow, score, class, population, tax fund, spends, funds,
# percent bits, yes vote) per action and every 100 ticks.
# New random city: ORACLE_NEWCITY=1 with the starter build assets/scripts/starter_<seed>.tools
# merged with the budget script (sorted by tick).
# Usage: scripts/compare-budget.sh [ticks]   (default 3000)
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-3000}"
reference/build-oracle.sh >/dev/null
cargo build --release -p micropolis-core --example fingerprint >/dev/null 2>&1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail=0
runs=0
fins=0
for city in assets/cities/*.cty; do
  for script in assets/scripts/budget_*.tools; do
    for dis in 0 1; do
      for seed in 1 5; do
        if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
        export ORACLE_SCRIPT="$script"
        reference/build/oracle "$city" "$seed" "$TICKS" > "$WORK/oracle.out"
        target/release/examples/fingerprint "$city" "$seed" "$TICKS" > "$WORK/rust.out"
        unset ORACLE_SCRIPT
        runs=$((runs + 1))
        label="$(basename "$city") $(basename "$script") disasters=$dis seed=$seed"
        if cmp -s "$WORK/oracle.out" "$WORK/rust.out"; then
          fins=$((fins + $(grep -c '^fin ' "$WORK/oracle.out" || true)))
          echo "OK   $label ($TICKS ticks, $(grep -c '^act ' "$WORK/oracle.out") actions)"
        else
          echo "DIFF $label: first mismatch:"
          diff "$WORK/oracle.out" "$WORK/rust.out" | head -4
          fail=1
        fi
      done
    done
  done
done
# New random city with the starter build plus the budget script (same ticks, sorted).
for seed in 1 42; do
  for script in assets/scripts/budget_*.tools; do
    merged="$WORK/newcity_${seed}_$(basename "$script")"
    { awk 'NF >= 5 && $1 !~ /^#/' "assets/scripts/starter_${seed}.tools"; awk 'NF >= 3 && $1 !~ /^#/' "$script"; } \
      | sort -s -n -k1,1 > "$merged"
    for dis in 0 1; do
      if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
      export ORACLE_SCRIPT="$merged" ORACLE_NEWCITY=1
      reference/build/oracle none "$seed" "$TICKS" > "$WORK/oracle.out"
      target/release/examples/fingerprint none "$seed" "$TICKS" > "$WORK/rust.out"
      unset ORACLE_SCRIPT ORACLE_NEWCITY
      runs=$((runs + 1))
      label="newcity seed=$seed $(basename "$script") disasters=$dis"
      if cmp -s "$WORK/oracle.out" "$WORK/rust.out"; then
        fins=$((fins + $(grep -c '^fin ' "$WORK/oracle.out" || true)))
        echo "OK   $label ($TICKS ticks, $(grep -c '^act ' "$WORK/oracle.out") actions)"
      else
        echo "DIFF $label: first mismatch:"
        diff "$WORK/oracle.out" "$WORK/rust.out" | head -4
        fail=1
      fi
    done
  done
done
unset ORACLE_DISASTERS
echo "runs=$runs fin_lines_identical=$fins"
exit $fail
