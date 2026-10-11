# SimCity 2050 — Micropolis en Rust, jouable dans le navigateur

Port en Rust du moteur de **MicropolisCore** (SimCity Classic, GPL), compilé en
WebAssembly, avec une page web qui affiche et charge des villes `.cty`.

Architecture: **hexagonale (ports & adapters)** autour d'un cœur fonctionnel — voir
[ARCHITECTURE.md](ARCHITECTURE.md). Les règles sont vérifiées par un test.

## Essayer
```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
./scripts/build-web.sh
python3 -m http.server -d web 8000   # puis http://localhost:8000
```
La page charge Haight-Ashbury (ou Kyoto, Yokohama, ou un `.cty` local); « Lecture » fait
tourner la simulation, « Enregistrer » exporte la ville.

## Tests
`cargo test --workspace`

Test différentiel contre le moteur C++ d'origine (identité tick par tick) :
`scripts/compare-oracle.sh [ticks]` (nécessite `g++`).

## Avancement du port
Voir [crates/micropolis-core/README.md](crates/micropolis-core/README.md).

## Licence
GPL v3 (dérivé de code GPL). Si le nom « Micropolis » est conservé, la
Micropolis Public Name License impose une attribution.
