# micropolis-core (Rust)

Conversion en Rust du moteur de simulation de **MicropolisCore** (SimCity Classic, GPL).
Moteur indépendant de l'interface, déterministe, avec **dimensions de carte configurables**
(l'original est figé à 120x100).

> Dérivé de code GPL : ce projet est donc sous GPL. Si vous gardez le nom « Micropolis »,
> la *Micropolis Public Name License* impose une attribution.

## Méthode
Chaque module est converti puis **validé contre le code C++ d'origine** :
- valeurs de référence produites par le C++ (`tests/gold.cpp`) et figées dans les tests ;
- constantes de tuiles générées par `tools/gen_tiles.py` avec les valeurs réelles du compilateur C++.

## Avancement (≈ 1 000 lignes C++ sur 21 000)
| Module C++ | Rust | État |
|---|---|---|
| random.cpp | rng.rs | fait, identique bit à bit |
| position.* | position.rs | fait (2 bugs C++ corrigés, voir doc) |
| map_type.h | map.rs | fait, tailles dynamiques |
| MapTileBits / Characters | tile.rs, tile_chars.rs | fait (généré) |
| micropolis.h/.cpp, allocate, initialize | simulation.rs | état de `Simulation`, `new_city`, `init_graph_max` fait (sans callbacks/sprites) |
| fileio.cpp | fileio.rs | `.cty` lecture/écriture (+ `simLoadInit` partiel), testé sur Haight |
| callback() | events.rs | file d'événements (port de sortie) |
| power, scan, zone, simulate, traffic, ... | | à faire |

## Ordre conseillé pour la suite
1. ~~`Simulation` (struct d'état, remplace `class Micropolis`) + `initialize`, `allocate`~~ (fait, reste `doPowerScan`/`evalInit` qui arrivent avec `power` et `evaluate`)
2. ~~`fileio`~~ (fait; reste la comparaison avec une sortie C++ de référence)
3. `power`, `scan`, `zone`, `simulate`, `traffic`, `budget`, `evaluate`
4. `generate` (génération de terrain), `tool` (outils de construction), `disasters`, `sprite`
5. Test de non-régression : même ville + même graine, N ticks, comparaison de la carte avec le C++

> Architecture: voir `../../ARCHITECTURE.md`. Ce crate ne doit avoir aucune dépendance ni E/S.

## Divergences volontaires par rapport au C++
- `Position::move` : `NORTH_EAST` ne retombe plus dans `EAST` ; `SOUTH_WEST` teste les bornes.
- `Rng::random(i16::MAX)` ne déborde plus.
