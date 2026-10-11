#!/usr/bin/env bash
# Differential test: run the ORIGINAL C++ engine (oracle) and the Rust port on the same
# cities/seeds and require identical per-tick fingerprints (time, funds, populations,
# valves, averages, hash of the whole tile map).
# Usage: scripts/compare-oracle.sh [ticks]   (default 1500)
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-1500}"
reference/build-oracle.sh >/dev/null
cargo build --release -p micropolis-core --example fingerprint >/dev/null 2>&1
fail=0
for city in assets/cities/*.cty; do
  for dis in 0 1; do
    for seed in 1 5; do
      if [ "$dis" = 1 ]; then export ORACLE_DISASTERS=1; else unset ORACLE_DISASTERS; fi
      reference/build/oracle "$city" "$seed" "$TICKS" > /tmp/oracle.out
      target/release/examples/fingerprint "$city" "$seed" "$TICKS" > /tmp/rust.out
      if cmp -s /tmp/oracle.out /tmp/rust.out; then
        echo "OK   $(basename "$city") disasters=$dis seed=$seed ($TICKS ticks)"
      else
        echo "DIFF $(basename "$city") disasters=$dis seed=$seed: first mismatch:"
        diff /tmp/oracle.out /tmp/rust.out | head -4
        fail=1
      fi
    done
  done
done
exit $fail
