#!/usr/bin/env bash
# Differential test of the player messages and front-end callbacks (sendMessage, makeSound,
# autoGoto, earthquakes, win/lose, new game): the ORIGINAL C++ engine (reference/oracle_events.cpp)
# and the Rust port (examples/fingerprint_events.rs) run the same cities with disasters on, and
# their per-tick event streams must be identical. Prints how many events of each kind were compared.
# Usage: scripts/compare-events.sh [ticks]   (default 3000)
# Cases: each .cty city and a generated city (`gen`), seeds 1 and 5, with no script and with each
# assets/scripts/events_*.tools scenario; gen seed 1 also with starter_1.tools; and three extra
# seeds that produce fires and crashes.
set -euo pipefail
cd "$(dirname "$0")/.."
TICKS="${1:-3000}"
reference/build-oracle-events.sh >/dev/null
cargo build --release -p micropolis-core --example fingerprint_events >/dev/null 2>&1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SCRIPTS=(assets/scripts/events_power.tools assets/scripts/events_services.tools \
         assets/scripts/events_money.tools assets/scripts/events_traffic.tools)

# run_case <label> <city.cty|gen> <seed> [script]: prints OK/DIFF and appends the oracle stream
run_case() {
  local label="$1" city="$2" seed="$3" script="${4:-}"
  local env_script=()
  if [ -n "$script" ]; then env_script=(ORACLE_SCRIPT="$script"); fi
  env ORACLE_DISASTERS=1 "${env_script[@]}" reference/build/oracle_events "$city" "$seed" "$TICKS" > "$WORK/oracle.out"
  env ORACLE_DISASTERS=1 "${env_script[@]}" target/release/examples/fingerprint_events "$city" "$seed" "$TICKS" > "$WORK/rust.out"
  grep -E "$UNPORTED_SOUND_RE" "$WORK/oracle.out" > "$WORK/excl.out" || true
  excluded=$((excluded + $(wc -l < "$WORK/excl.out")))
  grep -v -E "$UNPORTED_SOUND_RE" "$WORK/oracle.out" > "$WORK/oracle.cmp" || true
  grep -v -E "$UNPORTED_SOUND_RE" "$WORK/rust.out" > "$WORK/rust.cmp" || true
  if cmp -s "$WORK/oracle.cmp" "$WORK/rust.cmp"; then
    echo "OK   $label seed=$seed script=${script:-none}"
    grep -v '^act ' "$WORK/oracle.cmp" >> "$WORK/all.out" || true
  else
    echo "DIFF $label seed=$seed script=${script:-none}: first mismatches:"
    diff "$WORK/oracle.cmp" "$WORK/rust.cmp" | head -6 || true
    fail=1
  fi
  return 0
}

# Sounds the Rust port does not emit, by design or pending another owner, and that are excluded
# from BOTH streams (the count of excluded lines is printed):
#  - sprite.cpp sounds (HeavyTraffic, FogHornLow, HonkHonkLow, Monster, ExplosionHigh): sprite.rs
#    documents that makeSound is front-end only and not ported;
#  - tool.cpp bulldozer sounds (Explosion-High, Explosion-Low): not in tool.rs yet (reported).
UNPORTED_SOUND_RE=' S (city|interface) (HeavyTraffic|FogHornLow|HonkHonkLow|Monster|ExplosionHigh|Explosion-High|Explosion-Low) '
excluded=0

fail=0
touch "$WORK/all.out"
for city in assets/cities/*.cty; do
  for seed in 1 5; do
    run_case "$(basename "$city")" "$city" "$seed"
    for sc in "${SCRIPTS[@]}"; do run_case "$(basename "$city")" "$city" "$seed" "$sc"; done
  done
done
for seed in 1 5; do
  run_case "gen" gen "$seed"
  for sc in "${SCRIPTS[@]}"; do run_case "gen" gen "$seed" "$sc"; done
done
run_case "gen" gen 1 assets/scripts/starter_1.tools
# Seeds found (by a wider probe) to produce fires, crashes and other rare messages.
run_case haight.cty assets/cities/haight.cty 20
run_case kyoto.cty assets/cities/kyoto.cty 6
run_case yokohama.cty assets/cities/yokohama.cty 35

echo
echo "events compared (identical in C++ and Rust, all cases):"
for kind in M S G QUAKE LOSE WIN NEW; do
  printf '  %-6s %s\n' "$kind" "$(awk -v k="$kind" '$2 == k' "$WORK/all.out" | wc -l)"
done
echo "  excluded (unported sounds, see above): $excluded"
echo "  message numbers seen (count of M events per MESSAGE_* number):"
awk '$2 == "M" { c[$3]++ } END { for (n in c) printf "%s %d\n", n, c[n] }' "$WORK/all.out" \
  | sort -n | awk '{ printf "    %3d : %d\n", $1, $2 }'
exit $fail
