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

## Phase A : la plateforme (un agent, avant les chantiers) : livrée

### Moteur (`micropolis-core`)
* `extensions.rs` : `Extensions { ordinances: u32, water_rules: bool, transit_rules: bool }`, tout à faux
  par défaut ; `Simulation::extensions()`, `extensions_mut()`, `extensions_active()`. Les réseaux sont
  `Simulation::water()` / `water_mut()` (`WaterNetwork`) et `transit()` / `transit_mut()`
  (`TransitNetwork`) ; un nouveau plan de ville les vide, les interrupteurs restent.
* **Points d'accroche** (méthodes publiques de `Simulation` dans `extensions.rs`). Chacun rend son entrée
  inchangée, répond `true` ou ne fait rien quand `extensions_active()` est faux ; sans tirage aléatoire, sans
  allocation. Un seul appel chacun :

  | Accroche | Appelée par |
  |---|---|
  | `ext_monthly_balance(&mut self)` : coûts et recettes, payés par `spend` (net négatif = recette) | `collect_tax`, `simulate.rs`, juste après `do_budget()` d'une ville peuplée (une fois par collecte, `TAX_FREQUENCY`) |
  | `ext_crime(x, y, z) -> i32` (0..=250) | `crime_scan`, `scan.rs`, après le calcul d'origine ; coordonnées monde |
  | `ext_pollution(x, y, p) -> i32` (0..=255) | `pollution_terrain_land_value_scan`, `scan.rs`, où la pollution lissée est rangée |
  | `ext_land_value(x, y, v) -> i32` (1..=250) | même scan, après le calcul d'origine de la valeur du terrain |
  | `ext_traffic(x, y, t) -> i32` (0..=255) | `dec_traffic_map`, `simulate.rs` : l'érosion du trafic, une fois par cycle et par bloc, après l'érosion |
  | `ext_valves(&mut self)` | fin de `set_valves`, `simulate.rs` |
  | `ext_zone_can_grow(pos, ZoneType) -> bool` | début de `do_res_in`, `do_com_in`, `do_ind_in`, `zone.rs` (les trois entrées de croissance) |

  Chaque accroche délègue, quand les extensions sont actives, à `ordinances.rs`, `water.rs`, `transit.rs`
  (fonctions `pub(crate)` à la signature de l'accroche, prenant `&Simulation`, livrées vides). Le résultat
  des valeurs est borné à nouveau par le site d'appel (`clamp`) : une règle ne peut pas sortir des cartes.
* **Couches souterraines** : `underground.rs`, `UndergroundLayer` (un octet par tuile, ordre des tuiles, 0 =
  rien ; allouée à la première écriture non nulle). `WaterNetwork::pipes` et
  `TransitNetwork::underground` en sont. `encode()` / `decode()` de chaque module de chantier.
* **Sauvegarde** : `MCTY` version 3 = version 2 (bloc de relief toujours présent) + bloc « extensions » :
  longueur (u32 BE) puis morceaux `étiquette u8, longueur u32 BE, octets`, étiquettes strictement croissantes
  (1 règles d'eau et de métro, 2 ordonnances, 3 eau, 4 métro ; un morceau vide n'est pas écrit). Écrit
  seulement si une règle est active ou si un réseau n'est pas vide (`needs_extension_block()`) : tous les
  autres fichiers restent identiques octet pour octet. `.cty` et `MCTY` v1/v2 se chargent comme avant. Bloc
  invalide (étiquette inconnue, répétée, hors ordre, morceau tronqué ou refusé par son module) :
  `cty_bad_extension`, moteur intact. Taille du fichier incohérente : `cty_truncated` / `cty_bad_size`.
* **wasm** : `ordinances.rs`, `water.rs`, `transit.rs`, un bloc `#[wasm_bindgen] impl City {}` vide chacun ;
  `save_cty` refuse (`extensions_not_saveable`) une ville qui a besoin du bloc, comme pour le relief.

### Page (`web/`)
* **Outils supplémentaires** : `web/extra-tools.js` liste `tools-relief.js`, `tools-water.js`,
  `tools-transit.js`. Chaque module exporte `KIND`, `catalog(city)`, `calls(city, entry)` (null pour l'entrée
  d'un autre module), `label(preview)` (undefined : libellé par défaut) et
  `blockedReason(city, { in3d, flags })` (`flags` : drapeaux du moteur lus par la page, p. ex.
  `flags.relief` ; `""` si l'outil est utilisable). Une entrée porte `kind`, et au besoin `costText` et
  `idleHint`. `tools.js` n'utilise que ce registre ; `setupTools` renvoie `{ render, useSurface,
  setFlag(nom, actif) }`. Le relief est le premier module, comportement inchangé (U / D, « selon pente »).
* **Calques de la carte 2D** : `render.js` dessine, après les tuiles, les calques de `web/map-layers.js`
  (`MAP_LAYERS`, vide ; chacun `{ name, visible(city), draw(ctx2d, city, scale) }`). Tant qu'un calque est
  visible, les tuiles sont repeintes en entier avant lui.
* **Règles** : conteneur `#rules-controls` (la case « Règles de relief » y est) où chaque chantier ajoute
  sa case à cocher.

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

## Réseau d'eau (chantier livré)

Règle `water_rules` (case « Réseau d'eau » dans `#rules-controls`, désactivée par défaut). Module moteur
`water.rs`, adaptateur `micropolis-wasm/src/water.rs`, page `tools-water.js`, `map-layer-water.js`,
`water-ui.js`, `water-model.js` (partie pure).

* **Constantes** (`water.rs`) : `PIPE_COST` 5 $, `PUMP_COST` 300 $, `MAX_PUMPS` 64, `PUMP_RANGE` 64 pas de
  canalisation depuis une pompe, `WATER_REACH` 3 (distance de Manhattan entre une tuile et la canalisation
  alimentée la plus proche), `WATER_FREE_DENSITY` 2.
* **Canalisations** : sous n'importe quelle tuile (y compris bâtie ou sous l'eau), octet `PIPE` (1) de
  `WaterNetwork::pipes`. Poser coûte `PIPE_COST`, retirer est gratuit. **Pompes** : octet `PUMP` (3) dans la
  même couche (une pompe conduit comme une canalisation) ; sur une tuile de terre qui touche l'eau (8 voisines),
  sans condition d'électricité (simplification documentée) ; une canalisation déjà posée est remplacée. Le
  fichier est la couche telle quelle (morceau 3), la liste des pompes en est déduite au chargement (refusé
  au-delà de `MAX_PUMPS`).
* **Couverture** : recalculée à chaque changement du réseau (jamais pendant un tick, donc sans allocation dans
  l'accroche). Parcours en largeur depuis les pompes à travers les tuiles de canalisation (chaque tuile une seule
  fois, au plus `PUMP_RANGE` pas), puis second parcours depuis les canalisations alimentées sur `WATER_REACH` pas.
  Une zone est alimentée quand sa tuile centrale est couverte.
* **Croissance** (`ext_zone_can_grow`) : refusée pour une zone à sec dont le niveau de densité vaut
  `WATER_FREE_DENSITY` ou plus. Niveau 0 = zone vide (résidentiel : maisons comprises), n = n-ième palier de
  bâtiment (résidentiel 1 à 4, commercial 1 à 5, industriel 1 à 4). Les petites villes grandissent donc sans eau
  jusqu'au deuxième palier, puis stagnent. Pas de bonus de valeur du terrain ni de coût d'entretien.
* **API** (règle désactivée : tout est refusé, `Failed`, coût 0) : `set_water_rules`, `water_rules`,
  `place_pipe` / `pipe_preview`, `remove_pipe`, `place_pump` / `pump_preview`, `remove_pump`, `watered(x, y)`,
  `water_stats()` (pompes, canalisations, zones alimentées, zones à sec), `dry_zones()`, `water_layer()`
  (0 rien, 1 canalisation à sec, 2 canalisation alimentée, 3 pompe), `water_piece(x, y)`. Les coûts passent par
  `spend` : `NoMoney` si les fonds ne suffisent pas.
* **Page** : outils « Canalisation » (glisser pose une ligne), « Pompe à eau » et « Retirer canalisation ou
  pompe » dans le groupe « Réseaux », bloqués avec une raison en français règle désactivée ou en vue 3D. Le
  calque 2D (canalisations bleues, pompes, voile rouge sur les zones à sec) s'affiche quand la règle est active et
  qu'un outil d'eau est choisi ou que « Voir le réseau » est coché. La case se relit du moteur après chaque
  chargement ou nouvelle ville (jamais poussée dans une ville neuve), avec la ligne de statistiques.
* **Limites** : l'eau ne dépend pas de l'électricité ; une pompe posée sur un bâtiment ou une route est
  permise (le réseau est souterrain) ; le calque et les outils n'existent qu'en vue 2D.
