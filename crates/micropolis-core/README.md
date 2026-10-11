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

## Avancement
Tous les modules de simulation du C++ sont portés et validés contre le moteur d'origine
(voir `PORTING.md`) : rng, position, map, tile, simulation (état), fileio (`.cty`),
power, connect, scan, zone, traffic, disasters, evaluate, budget, tool, sprite,
simulate (boucle `simTick`), generate (terrain), animate, message, update, utilities, graph.

**Preuve de fidélité** : `scripts/compare-oracle.sh` fait tourner le moteur C++ d'origine et le
port Rust sur les mêmes villes (Haight, Kyoto, Yokohama), graines et options de catastrophes, et
exige des empreintes identiques à chaque tick (temps, fonds, populations, valves, moyennes,
hash de toute la carte). Résultat : 0 écart sur 3 000 ticks (12 combinaisons).
Chaque module a en plus ses tests « golden » écrits contre le C++ (`reference/gold/`).

Non portés (interface seulement) : `map.cpp` (mini-cartes), `resource.cpp`, `loadScenario`
(fichiers de scénario absents), glue Tcl/Python de `main.cpp`.

À faire : outils de construction dans la page web, génération d'une nouvelle ville dans la page,
graphismes de tuiles, validation sur des cartes plus grandes que 120x100.

## Divergences volontaires par rapport au C++
- `Position::move` : `NORTH_EAST` ne retombe plus dans `EAST` ; `SOUTH_WEST` teste les bornes.
- `Rng::random(i16::MAX)` ne déborde plus.
