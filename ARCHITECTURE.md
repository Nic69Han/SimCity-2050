# Architecture

Principle: **hexagonal architecture (ports & adapters) around a functional core.**
Every change to this repository must respect the rules below. They are checked
by `crates/micropolis-core/tests/architecture.rs`; a rule that cannot be
checked automatically is still a rule.

```
        web/ (HTML, JS, canvas)                 <- adapter: presentation
                 |
        crates/micropolis-wasm                  <- adapter: translation only
                 |
        crates/micropolis-core                  <- the hexagon: domain, no I/O
```

## Rules

1. **Dependencies point inward.** `web` -> `micropolis-wasm` -> `micropolis-core`.
   The core knows nothing of the crates or the page that use it.
2. **The core is pure and deterministic.** No dependencies at all in
   `micropolis-core/Cargo.toml`; no file, network, clock, OS randomness,
   threads, `wasm_bindgen` or `web_sys`. Same input + same seed = same city.
   Randomness comes only from `Rng`, seeded explicitly by the caller.
3. **Data in, data out (ports).** The core receives plain data (`&[u8]` of a
   `.cty` file, commands, a seed) and returns plain data (`Vec<u8>`, slices,
   numbers, `Event`s). It never calls out. The C++ `callback(...)` mechanism
   becomes an event queue the adapter drains (`Simulation::drain_events`).
4. **Adapters only translate.** `micropolis-wasm` converts types and exposes
   core operations to JavaScript. No game rule lives there. If a rule is
   needed by the UI, add it to the core and expose it.
5. **The UI holds no game state.** `web/` reads the state exposed by the
   adapter and draws it; it decides nothing about the simulation.
6. **Port first, then adapt.** A C++ module is converted into a core module
   and validated against the original C++ (golden values) before any adapter
   uses it.
7. **Divergences from the C++ are deliberate and documented** in the core
   README (e.g. runtime world size, bug fixes).

## Layout

| Path | Role |
|---|---|
| `crates/micropolis-core` | domain: RNG, maps, tiles, `Simulation`, file formats, events |
| `crates/micropolis-wasm` | WebAssembly adapter (`wasm-bindgen`) |
| `web/` | browser adapter: page, canvas rendering, user input |
| `assets/` | sample data (cities from the original, GPL) |
| `scripts/build-web.sh` | builds the wasm package and assembles `web/` |
