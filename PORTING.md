# Porting guide (read together with ARCHITECTURE.md)

Goal: a faithful, testable Rust port of the Micropolis engine, in
`crates/micropolis-core`. "Faithful" is measured against the ORIGINAL C++
engine, which is built here as an oracle:

* `reference/micropolis-cpp/` — the original sources (`map.cpp`, which only
  draws mini-maps for a UI, is not built). Patched in ONE place: `random.cpp`
  reads env `MICROPOLIS_SEED` so runs are reproducible.
* `reference/build-oracle.sh` then
  `reference/build/oracle assets/cities/haight.cty <seed> <ticks> [dump_dir]`
  prints one fingerprint line per tick (time, funds, populations, valves,
  averages, hash of the whole tile map) and can dump the map each tick.
* `reference/build-harness.sh harness.cpp out` builds your own C++ harness
  against the original engine, with private members exposed, to produce
  golden values for any single function.

## Rules for every porting agent

1. **Architecture**: obey ARCHITECTURE.md. The core has no dependencies, no
   I/O, no clock, no `println!`. `cargo test -p micropolis-core` includes a test
   that enforces it. No `unsafe`.
2. **You own exactly these files**: `crates/micropolis-core/src/<your modules>.rs`
   and your shim file `crates/micropolis-core/src/shim_<your agent>.rs`.
   Do NOT edit `lib.rs`, other agents' files, `web/`, `reference/micropolis-cpp/`.
   You may add tests under `crates/micropolis-core/tests/<your module>_*.rs`
   and harnesses under `reference/gold/<your module>_*.cpp`.
3. **Engine state** lives in `Simulation` (`src/simulation.rs`). Every C++
   `Micropolis::fooBar(...)` member becomes `impl Simulation { pub fn foo_bar(&mut self, ...) }`
   in the Rust file named after the C++ file. If you need extra state fields,
   add them to `Simulation` ONLY at the marker lines `// @fields:<agent>` (struct)
   and `// @init:<agent>` (constructor) that carry your agent name, nowhere else.
4. **Names/types**: method name = snake_case of the C++ name. Keep field
   names from `simulation.rs`. Integer widths matter for fidelity: C++ `short`
   is `i16` (wrapping arithmetic where overflow can happen), `Quad` is `i64`,
   `int` is `i32`. Parameters/returns of public methods may use `i32` for
   convenience. Tiles are `u16` with the bits in `tile.rs`; constants in
   `tile_chars.rs`. Use `Map<T>` (`map.rs`) for the density maps and
   `Position`/`Direction` (`position.rs`).
5. **Determinism**: call the random generator exactly as often and in the same
   order as the C++ (`self.rng.sim_random()/random16()/random(n)/erandom(n)`).
   Evaluation order of C++ expressions with side effects must be preserved.
   No hash maps with random iteration order.
6. **Functions owned by other modules**: call them as `self.their_name(...)`.
   To compile alone, put a stub in YOUR shim file (`todo!()` body, same name,
   plausible signature, `pub(crate)`). Shims are deleted at integration, so
   they must contain no logic. Mention every shim in your report.
7. **UI plumbing**: C++ `callback(...)`, `sendMessage`, sprites' sound,
   `updateFunds`… that only notify a front-end become `self.push_event(Event::…)`
   (add variants to `events.rs` ONLY if truly needed — tell the integrator) or
   are dropped when purely cosmetic. Never print.
8. **Tests are the deliverable**. For each function/group you port:
   (a) write a C++ harness (`reference/gold/`) that runs the ORIGINAL code on
   `assets/cities/haight.cty` (and small hand-built states) and prints values;
   (b) embed the expected values in a Rust test that runs the Rust port on the
   same input and asserts equality (tile map, maps, counters). Keep harness
   source and a short note on how the values were produced next to the test.
   Pure functions: test many inputs. Stateful functions: compare full maps/hashes.
9. **Quality gates before you finish**: `cargo fmt --all`,
   `cargo clippy -p micropolis-core --all-targets -- -D warnings`,
   `cargo test -p micropolis-core` all green (other modules' unfinished code
   is behind `todo!()` shims; do not run code paths that hit them in tests).
10. **Git**: work in your own worktree/branch, commit with a clear message
    ending with:
    `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`
    Do not push, do not merge, do not open PRs. Do not touch other branches.
11. **Report** (your final message): branch name; list of ported C++ functions
    and their Rust names/signatures; shims you created; fields you added; tests
    and what they compare against; anything you could NOT port or are unsure
    about (be honest — never claim parity you did not test).
