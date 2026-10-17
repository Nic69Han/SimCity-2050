# Conception du jeu : jalon v0.2 « profond »

But : donner au joueur de vraies décisions de gestion à la SimCity 3000, sans casser le mode classique.
Toutes les règles de ce jalon sont des **règles étendues**, désactivées par défaut : désactivées, le moteur
reste identique au moteur C++ (les scripts `compare-*.sh` restent identiques). Règles de code :
docs/regles-de-code.md.

## Contenu

| Chantier | Ce que fait le joueur | Effet dans le moteur (règle activée) |
|---|---|---|
| **Ordonnances** | Active ou retire des ordonnances (coût mensuel) | Modulent criminalité, pollution, valeur du terrain, demande |
| **Réseau d'eau** | Pose des pompes et des canalisations souterraines | Une zone sans eau ne se développe pas au-delà d'une densité plafond |
| **Métro** | Pose des stations et des tunnels | Le trafic baisse autour des stations reliées ; la valeur du terrain monte |
| **Finition visuelle** | — | Bâtiments orientés vers la route, couleurs et lumière réglées, son de construction |

Hors jalon : accords avec les voisins (jalon suivant, s'appuiera sur l'eau et l'électricité), agents
individuels (v0.3, docs/ia-simulation.md).

## Phase A : la plateforme (un agent, avant les chantiers)

### Moteur (`micropolis-core`)
* `extensions.rs` : `Extensions` (ordonnances actives, `water_rules`, `transit_rules`), tout à faux par
  défaut ; `Simulation::extensions()`, `extensions_mut()`, `extensions_active()`.
* **Points d'accroche** (méthodes de `Simulation` dans `extensions.rs`, sans effet ni tirage aléatoire quand
  rien n'est actif), appelés à un seul endroit chacun :
  `ext_monthly_balance` (à la collecte : coûts et recettes des règles étendues), `ext_crime(x, y, z)`,
  `ext_pollution(x, y, p)`, `ext_land_value(x, y, v)`, `ext_traffic(x, y, t)`, `ext_valves()` (fin de
  `set_valves`), `ext_zone_can_grow(position, sorte) -> bool` (croissance des zones).
  Chaque accroche délègue à un module de chantier (`ordinances.rs`, `water.rs`, `transit.rs`), livré vide
  par la plateforme et rempli par le chantier.
* **Couches souterraines** : `UndergroundLayer` (un octet par tuile, ordre des tuiles), utilisée par l'eau
  et le métro.
* **Sauvegarde** : format `MCTY` version 3 = version 2 + un bloc « extensions » fait de morceaux étiquetés
  (étiquette, longueur, octets) ; chaque module encode et décode son morceau. Fichiers `.cty` et `MCTY` v1/v2
  inchangés au chargement ; code d'erreur stable `cty_bad_extension`.
* **wasm** : un fichier par chantier (`ordinances.rs`, `water.rs`, `transit.rs`), livrés vides.

### Page (`web/`)
* **Outils supplémentaires** : `web/extra-tools.js` liste des modules d'outils (`tools-relief.js`,
  `tools-water.js`, `tools-transit.js`) qui exportent `catalog(city)`, `calls(city, entry)`,
  `label(preview)` et `blockedReason(city, { in3d })`. `tools.js` ne connaît plus le relief en dur : il
  passe par ce registre (le relief devient le premier module, comportement inchangé).
* **Calques de la carte 2D** : `render.js` dessine, après les tuiles, les calques enregistrés dans
  `web/map-layers.js` (chacun : `visible(city)`, `draw(ctx2d, city, scale)`).
* **Règles** : conteneur `#rules-controls` où chaque chantier ajoute sa case à cocher.

## Phase B : les chantiers (en parallèle, un agent chacun)
Chaque chantier ne modifie que ses propres fichiers : module moteur, module wasm, module d'outils,
calque 2D, fonctionnalité de page, tests. Il documente ses constantes (coûts, rayons, plafonds) et
ajoute des tests : règle désactivée = moteur identique ; règle activée = effet mesuré ; déterminisme ;
sauvegarde et rechargement ; boucles bornées (propagation de l'eau, recherche de lignes de métro).

## Critères d'acceptation
* Comparaisons C++ identiques, tous les tests verts (Rust, page, wasm, e2e).
* Chaque règle s'active et se désactive en jeu, se sauvegarde, et son effet est visible (conseillers,
  calques, coûts).
* Relecture Opus de chaque livraison (diff lu, vérifications relancées) avant intégration.
