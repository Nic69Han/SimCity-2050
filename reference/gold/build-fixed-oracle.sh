#!/usr/bin/env bash
# Build a C++ harness against a SCRATCH copy of the original engine in which
# cityEvaluation's problemTable has one extra, zeroed slot.
#
# Why: voteProblems() reads problemTable[PROBNUM] (one past the end; undefined
# value in the original). The Rust port treats that slot as 0. This script makes
# the oracle well defined in the same way, so golden values can be compared
# exactly. The original tree under reference/micropolis-cpp is NOT modified.
#
# Usage: reference/gold/build-fixed-oracle.sh my_harness.cpp out_binary
# Set TMPDIR to choose the scratch location (default /tmp).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"   # reference/
work="$(mktemp -d "${TMPDIR:-/tmp}/micropolis-fixed-XXXXXX")"
cp -r "$here/micropolis-cpp" "$work/micropolis-cpp"
# Only cityEvaluation declares `short problemTable[PROBNUM];` with a semicolon.
sed -i 's/short problemTable\[PROBNUM\];/short problemTable[PROBNUM + 1] = {0}; \/\/ slot PROBNUM is UB in the original/' \
    "$work/micropolis-cpp/evaluate.cpp"
grep -q 'PROBNUM + 1' "$work/micropolis-cpp/evaluate.cpp"
SRC=$(cd "$work/micropolis-cpp" && ls *.cpp | grep -v '^map.cpp$' | sed "s|^|$work/micropolis-cpp/|")
g++ -std=c++11 -w -O1 -I"$work/micropolis-cpp" -o "$2" $SRC "$1"
rm -rf "$work"
echo "built $2 (evaluate.cpp: problemTable has a zeroed slot PROBNUM)"
