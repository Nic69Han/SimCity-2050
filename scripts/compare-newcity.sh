#!/usr/bin/env bash
# Differential test for "start a new random city": the ORIGINAL C++ engine's
# generateSomeCity(seed) (generateMap() too; reference/oracle_gen.cpp) and the Rust port
# (Simulation::new_random_city / generate_map, examples/fingerprint_gen) must give
# identical per-tick fingerprints for several seeds, with disasters off and on.
# Usage: scripts/compare-newcity.sh [ticks]   (default 600)
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-600}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
reference/build-oracle-gen.sh >/dev/null
cargo build --release -p micropolis-core --example fingerprint_gen >/dev/null 2>&1
fail=0
total=0
for entry in some map; do
  for dis in 0 1; do
    for seed in 1 2 3 7 42 1234; do
      if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
      reference/build/oracle_gen "$seed" "$TICKS" "$entry" > "$OUT/oracle.out"
      target/release/examples/fingerprint_gen "$seed" "$TICKS" "$entry" > "$OUT/rust.out"
      total=$((total + 1))
      if cmp -s "$OUT/oracle.out" "$OUT/rust.out"; then
        echo "OK   entry=$entry seed=$seed disasters=$dis ($TICKS ticks, $(wc -l < "$OUT/oracle.out") lines)"
      else
        echo "DIFF entry=$entry seed=$seed disasters=$dis: first mismatch:"
        diff "$OUT/oracle.out" "$OUT/rust.out" | head -4
        fail=1
      fi
    done
  done
done
unset ORACLE_DISASTERS
if [ "$fail" = 0 ]; then echo "all $total runs identical"; fi
exit $fail
