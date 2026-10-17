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

## Métro (chantier livré)

Règle étendue `transit_rules`, désactivée par défaut. Activée, le joueur creuse des tunnels et pose des
stations ; deux stations reliées par des tunnels forment une **ligne en service**, autour de laquelle le
trafic baisse et la valeur du terrain monte.

### Modèle de données (simple, réutilisable par les agents de la v0.3)
* Tout le réseau est la couche souterraine `TransitNetwork::underground`, un octet par tuile : `1` tunnel,
  `2` station, `0` rien (tout autre octet est ignoré). Une station **n'est pas une tuile de surface** : elle ne
  modifie jamais la carte des tuiles (pas de bâtiment, rien à raser). Elle se pose sur toute tuile qui n'est pas
  de l'eau (terrain nu, route, bâtiment : le métro est sous terre) et remplace un tunnel s'il y en a un. La
  vue 2D (`map-layer-transit.js`) la dessine depuis `transit_layer()` ; la vue 3D pourra faire de même.
* Une **ligne** est un ensemble connexe (voisinage à 4) de tunnels et de stations ; elle est **en service**
  avec au moins `MIN_STATIONS_PER_LINE` = 2 stations. `TransitNetwork::refresh()` calcule les composantes par
  remplissage borné (chaque tuile entre une fois dans la file : au plus `largeur × hauteur` pas) après chaque
  modification et chaque chargement ; les accroches ne font que lire le résultat.
* Une tuile est **desservie** si elle est à moins de `STATION_RADIUS` d'une station d'une ligne en service
  (distance euclidienne, comparaison de carrés entiers).

### Constantes (`micropolis-core/src/transit.rs`, lues par la page via `transit_params()`)
| Constante | Valeur | Rôle |
|---|---|---|
| `TUNNEL_COST` | 50 $ | par tuile de tunnel |
| `STATION_COST` | 500 $ | par station |
| `STATION_RADIUS` | 8 tuiles | portée d'une station d'une ligne en service |
| `TRAFFIC_CUT_PCT` | 40 % | part de la densité de trafic retirée sur une tuile desservie (`ext_traffic`, arrondi vers le bas) |
| `LAND_BONUS` | +12 | ajouté à la valeur du terrain d'une tuile desservie (`ext_land_value`, borné ensuite à 1..=250) |
| `MAX_STATIONS` | 64 | stations maximum (un fichier qui en contient plus est refusé) |

Pas de coût d'entretien (`monthly_balance` reste nul). Entiers, déterminisme, aucun tirage aléatoire. Les
coordonnées des accroches sont celles du bloc de la carte de trafic ou de valeur du terrain (coin monde).

### Interface moteur
Règle désactivée, tout est refusé (`Failed`, coût 0) et les accroches ne changent rien.
`Simulation::{set_transit_rules, transit_rules, place_tunnel, tunnel_preview, remove_tunnel, place_station,
station_preview, remove_station, transit_stats, transit_layer}` ; retirer est gratuit et ne rembourse rien.
wasm : mêmes noms ; `transit_layer()` → `Uint8Array` (0 rien, 1 tunnel, 2 tunnel d'une ligne en service,
3 station, 4 station d'une ligne en service, ordre de `tiles()`), `transit_stats()` → `Int32Array`
`[stations, tunnels, lignes, tuiles desservies]`, `transit_params()` → les constantes ci-dessus. Le réseau est
enregistré dans le morceau 4 du bloc d'extensions (les octets de la couche).

### Page
* Outils « Tunnel de métro » (J, un glisser creuse une ligne par les côtés) et « Station de métro » (K) dans le
  groupe Réseaux ; bloqués avec une raison en français règle désactivée, et en vue 3D (le plan n'y est pas
  dessiné).
* Case « Métro » dans `#rules-controls` (aide en infobulle), relue du moteur après chaque rendu (jamais poussée
  dans une ville neuve), case « Plan du métro » et ligne de statistiques. Le calque 2D est visible règle activée
  et outil de métro choisi ou plan coché ; les lignes en service sont d'une couleur plus forte, la portée des
  stations est dessinée en transparence.

### Limites connues
* Pas de vue 3D du réseau. Pas d'entretien mensuel. Pas de dépôt de voyageurs ni de trains : le réseau ne sert
  qu'aux deux effets ci-dessus (la v0.3 s'y appuiera).
