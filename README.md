# SimCity 2050 — jouable dans le navigateur (moteur Micropolis en Rust)

SimCity 2050 est un port en Rust du moteur de **MicropolisCore** (SimCity Classic, GPL), compilé en
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
tourner la simulation, « Enregistrer » exporte la ville, « Nouvelle ville » génère un terrain (graine
visible, rejouable). La palette d'outils permet de construire (routes, lignes, zones, services,
centrales, parcs, bulldozer, requête) à la souris ou au doigt, avec aperçu du coût et de la validité.
Cartes de 80×67 jusqu'à 512×512 (taille au choix pour une nouvelle ville ; fichiers `.cty` pour 120×100, `.mcty`
au-delà), sauvegarde automatique et 3 emplacements dans le navigateur avec reprise de la partie, journal des messages de la ville, impôts et budget, évaluation et courbes d'historique,
vues de carte (densité, valeur du terrain, criminalité, pollution, trafic, électricité, pompiers, police),
tuiles et objets mobiles dessinés par programme (aucune image d'origine n'est utilisée).

## Tests
`cargo test --workspace`

Tests différentiels contre le moteur C++ d'origine (identité tick par tick, nécessitent `g++`) :
- `scripts/compare-oracle.sh [ticks]` : villes d'exemple ;
- `scripts/compare-tools.sh [ticks]` : actions du joueur (outils de construction) pendant la simulation ;
- `scripts/compare-newcity.sh [ticks]` : génération d'une nouvelle ville aléatoire ;
- `scripts/compare-newcity-tools.sh [ticks]` : nouvelle ville construite par le joueur, qui grandit ;
- `scripts/compare-budget.sh [ticks]` : impôts et budgets modifiés pendant la partie ;
- `scripts/compare-events.sh` : messages et sons du jeu, identiques au C++ ;
- `scripts/compare-bigmap.sh [ticks]` : cartes de tailles différentes (le C++ est recompilé à ces tailles).

Page web : `node --test web/test/*.test.mjs` (sans navigateur), `scripts/test-wasm.sh` (contrat de
l'adaptateur sur le vrai wasm), `scripts/e2e.sh` (navigateur Chromium, vrai moteur).

## Avancement du port
Voir [crates/micropolis-core/README.md](crates/micropolis-core/README.md).

## Licence et marques
GPL v3 : le moteur est dérivé de Micropolis / MicropolisCore, le code de SimCity publié sous GPL v3 ; l'attribution
à Micropolis est conservée (pied de page de la page web, `LICENSE`). Ce code a été publié sous le nom « Micropolis »
parce que « SimCity » reste une marque d'Electronic Arts ; ce projet n'est affilié ni à Electronic Arts ni aux
auteurs d'origine.

## Déploiement
Le site est publié sur Netlify après chaque fusion dans `main` (voir `docs/deploiement.md`).
