# Conception du jeu : jalon v0.2b « relié »

Suite du v0.2 (docs/game-design-v02.md). Mêmes règles : règles étendues désactivées par défaut, mode
classique identique au moteur C++, règles de code (docs/regles-de-code.md), développement par des agents
Sonnet, relecture et intégration par Opus.

## Chantiers (un agent chacun, fichiers propres)

| Chantier | Fichiers | Résultat |
|---|---|---|
| **Sous-sol en 3D** | `web/view3d-underground.js`, `web/view3d-underground-model.js`, enregistrement dans `web/view3d-layers.js` | Canalisations, pompes, tunnels et stations visibles en 3D ; bouton « Sous-sol » dans la barre de la vue 3D ; terrain translucide en vue souterraine |
| **Accords avec les voisins** | `crates/micropolis-core/src/deals.rs` (+ `extensions.rs` : champ et morceau 5 du bloc de sauvegarde), `crates/micropolis-wasm/src/deals.rs`, `web/deals-ui.js`, `web/css/deals.css` | Vendre de l'électricité et de l'eau excédentaires aux villes voisines contre une recette annuelle ; rupture et pénalité si la ville ne peut plus fournir |
| **Conseillers et sons** | `web/advisors-model.js`, `web/advisors.js`, `web/sound*.js`, petit point d'écoute dans `web/tools.js` | Les conseillers parlent de l'eau, du métro, des ordonnances et des accords ; son de construction réussie |

## Critères d'acceptation
* Comparaisons C++ identiques, tous les tests verts (Rust, page, wasm, e2e).
* Chaque nouveauté se voit, se sauvegarde quand elle a un état, et se teste (règle désactivée = moteur
  identique ; règle activée = effet mesuré ; boucles bornées).
* Relecture Opus de chaque livraison (diff lu, vérifications relancées) avant intégration.

## Sous-sol en 3D (chantier livré)

Calque `web/view3d-underground.js` (partie pure : `web/view3d-underground-model.js`), lit le moteur par `ctx.city()`
(lecture seule) et ne dessine rien si `water_layer()` / `transit_layer()` manquent ou si la règle est désactivée.

* **Formes** : canalisations = boîtes bleues fines sous le sol (grises-bleues à sec), pompes = petites tours
  cyan sur le sol, tunnels = boîtes plus épaisses et plus profondes (grises, orange sur une ligne en service),
  stations = petits bâtiments sur le sol (couleur plus forte en service). Un noeud par tuile et un segment par
  voisin relié (droite et bas) ; hauteurs depuis `tileCentreY`.
* **Capacités** (`CAPACITY`, une `InstancedMesh` par genre) : canalisations 12288, pompes 64 (`MAX_PUMPS`),
  tunnels 12288, stations 64 (`MAX_STATIONS`). Au-delà, les placements sont abandonnés et comptés (`dropped`).
* **Mises à jour** : `update()` tourne à chaque image ; l'empreinte (FNV-1a) des deux couches, les drapeaux de
  règle et le tableau des coins du terrain sont comparés, et les instances ne sont reconstruites que s'ils changent.
* **Bouton « Sous-sol »** dans `#view3d-controls` : les matériaux Lambert opaques trouvés dans `ctx.scene`
  (terrain, volumes des bâtiments) deviennent translucides (opacité 0,3, sans écriture de profondeur) ; état
  d'origine restauré au relâchement et au `dispose()`. Les réseaux sont dessinés dès que leur règle est active,
  le bouton ne change que la transparence. Les canalisations et tunnels enterrés sont donc cachés par le terrain
  opaque ; les pompes et stations, posées sur le sol, restent visibles.
* **Crochet de test** : `canvas.undergroundStats()` → `{ pipeTiles, pumpTiles, tunnelTiles, stationTiles,
  instances: {pipe, pump, tunnel, station}, dropped, seeThrough, rebuilds }` (retiré au `dispose()`).
* **Tests** : `web/test/view3d-underground*.test.mjs` (placement, capacité, détection de changement),
  `web/e2e/underground.test.mjs` (eau, vue 3D simple `?lite=1`, bascule).
