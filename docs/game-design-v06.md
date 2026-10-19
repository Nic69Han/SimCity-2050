# Conception du jeu : jalon v0.6 « trains et métro animés »

Troisième jalon du plan docs/plan-sc3000.md (étape C de docs/ia-simulation.md). S'appuie sur les voitures (v0.3),
les bâtiments (v0.4), les bus et taxis (v0.5) et le réseau de métro (v0.2 : tunnels et stations du calque souterrain).
Règles du projet : désactivé par défaut, moteur classique identique au C++, entiers, déterminisme, boucles bornées.

## Ce que voit le joueur
* **Gare** (nouveau bâtiment, 2×2) posée le long des rails classiques. Deux gares reliées par des rails forment une
  ligne ; des **trains** de voyageurs roulent sur les rails d'une gare à l'autre.
* Le **métro** (tunnels et stations du v0.2) prend vie : des **rames** roulent dans les tunnels entre les stations
  d'une ligne en service.
* Les habitants sans voiture choisissent le **mode le moins coûteux** (temps de marche + temps d'attente + temps de
  trajet, et prix) entre bus, train, métro et taxi ; les correspondances ne sont pas encore gérées (un seul mode par
  trajet, documenté).
* Trains et rames sont visibles en 2D et en 3D (les rames sous le sol, visibles en vue « Sous-sol »).

## Contrat (fixé avant les chantiers)
Actif seulement si les règles `agents` et `structures` sont actives ; le métro demande en plus `transit_rules`.
Rien de nouveau n'est sauvegardé hormis les gares (bâtiments v0.4).

* Catalogue : genre 13 **gare** (2×2), règle de pose : au moins une tuile de rail classique voisine de l'empreinte.
* `vehicles(max)` inclut les trains (genre 3) et les rames de métro (genre 4), mêmes enregistrements de 5 ;
  une rame est sous terre (la page le sait par son genre).
* Nouvelle méthode wasm `rail_stats()` → `Int32Array [trains, rames, voyageurs_train_du_mois,
  voyageurs_métro_du_mois, recettes_rail_du_mois, lignes_train, lignes_métro]` (zéros si inactif).
* `transport_stats()` (v0.5) inchangé ; les recettes du rail sont ajoutées au bilan mensuel (`ext_monthly_balance`).

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur rail et métro** | Sonnet | `crates/micropolis-core/src/agents/transport/` (graphe des rails à partir des tuiles classiques, lignes entre gares, trains ; lignes et rames du métro à partir de `TransitNetwork` ; choix du mode), catalogue (genre 13), wasm (`rail_stats`), tests |
| **Page** | Haiku | nom « Gare » (`web/structures-model.js`), lignes du panneau (« Trains », « Rames de métro », « Voyageurs en train ce mois », « Voyageurs en métro ce mois », « Recettes du rail »), conseiller (lignes de train ou de métro sans voyageurs → conseil), faux moteur, tests |
| **Rames en 3D et 2D** | Haiku | 3D : rames (genre 4) dessinées à la profondeur des tunnels (même règle que `view3d-underground`) ; 2D : rames dessinées seulement quand le plan du métro est affiché, trains toujours ; tests |

## Critères d'acceptation
Comparaisons C++ identiques ; déterminisme ; conservation des voyageurs étendue aux nouveaux modes ; plafonds
(trains par ligne, rames par ligne, capacité, lignes) testés ; choix du mode testé (le moins cher gagne, égalité
départagée de façon fixe) ; e2e : deux gares reliées par des rails, un train qui roule ; tous les tests verts ;
relecture.

## Cœur rail et métro (chantier livré)
Code : `crates/micropolis-core/src/agents/transport/rail/` (`grid` : grille de tuiles ouvertes + A* borné ;
`lines` : lignes de train et de métro ; `shuttle` : le véhicule qui fait la navette ; `step` : un tick) et
`transport/choice.rs` (choix du mode). Le rail fait partie du `Transport` (v0.5) : mêmes règles d'activation, mêmes
compteurs, même audit de conservation. Le métro demande en plus `transit_rules`.

* **Gare (genre 13, 2×2, 800 $, entretien 30 $)** : `Kind::needs_rail` ; la pose exige une tuile de rail classique
  parmi les 8 tuiles voisines des côtés de l'empreinte. « Rail classique » = `is_rail` : `RAILBASE..=LASTRAIL`
  (rails, passages à niveau) plus `RAILHPOWERV` et `RAILVPOWERH`, comme `do_train_sprite` du moteur classique.
* **Lignes de train** : grille des rails reconstruite au même rafraîchissement que le graphe routier
  (`REFRESH_INTERVAL`), seulement si les rails, les gares, les tunnels, les stations ou la règle ont changé. Une gare
  est reliée au rail par sa première tuile de rail voisine (ordre : tuiles de l'empreinte, puis N, E, S, O). Une ligne =
  une paire de gares (au plus `MAX_GARES` = 16 gares prises, `MAX_TRAIN_LINES` = 8 lignes, `MAX_TRAIN_SEARCHES` = 64
  recherches) dont les accès sont reliés par un A* (`MAX_RAIL_EXPANSIONS` = 4096 nœuds, `MAX_RAIL_PATH_LEN` = 512 tuiles).
* **Trains** : au plus `MAX_TRAINS_PER_LINE` = 2 par ligne, un nouveau toutes les `TRAIN_SPAWN_INTERVAL` = 60 ticks,
  `TRAIN_CAPACITY` = 40 voyageurs, `TRAIN_SPEED` = 12 seizièmes de tuile par tick, arrêt de `TRAIN_DWELL_TICKS` = 6 ;
  navette aller-retour sur le chemin ; tarif `TRAIN_FARE` = 4 $ à l'arrivée.
* **Métro** : les stations de `TransitNetwork` en service, parcourues de proche en proche (plus proche voisine,
  A* dans les tunnels en service) ; au plus `MAX_LINE_STOPS` = 24 arrêts par ligne, `MAX_LINE_SEARCHES` = 48 recherches,
  `MAX_LINE_PATH_LEN` = 1024 tuiles, `MAX_METRO_LINES` = 8 ; les stations non atteintes ouvrent la ligne suivante.
  `MAX_RAMES_PER_LINE` = 3 rames, `METRO_CAPACITY` = 60, `METRO_SPEED` = 12, arrêt `METRO_DWELL_TICKS` = 4, départ toutes
  les `METRO_SPAWN_INTERVAL` = 40 ticks, tarif `METRO_FARE` = 3 $. Sans `transit_rules` : aucune ligne.
* **Choix du mode** (`choice.rs`) : `coût = WALK_COST(2) × marche + WAIT_COST(20) + RIDE_COST(mode) × trajet + prix`,
  distances de Manhattan en tuiles, `RIDE_COST` = 2 (bus, taxi) ou 1 (train, métro) ; prix : bus 3, métro 3, train 4,
  taxi 2 $ par tuile. Candidats : bus (arrêt à moins de `WALK_RADIUS` des deux bouts, boucle commune), métro, train
  (une station / gare à moins de `WALK_RADIUS` de chaque bout, sur la même ligne), taxi (dépôt présent, accès différents).
  Le moins cher gagne ; à égalité l'ordre fixe est bus < métro < train < taxi. Un seul mode par trajet : pas de
  correspondance. Remarque : le bus n'est donc plus pris d'office quand il existe, il doit être moins cher que le taxi.
* **Voyageurs** : `Rider.stop` = identité de l'arrêt de descente (gare ou station) ; file d'attente par arrêt de ligne
  (`MAX_WAITING_PER_STOP`), abandon après `MAX_WAIT_TICKS`. Une ligne qui change retire ses véhicules et ses files :
  ces voyageurs comptent comme abandonnés ; une ligne inchangée garde tout. La conservation
  `créés = en attente + à bord + arrivés + abandonnés` inclut bus, taxis, trains et rames, testée à chaque tick.
* **Interface** : `vehicles(max)` ajoute les trains (genre 3) et les rames (genre 4), enregistrements de 5 comme avant ;
  wasm `rail_stats()` → `[trains, rames, voyageurs_train_mois, voyageurs_métro_mois, recettes_rail_mois, lignes_train,
  lignes_métro]` ; `transport_stats()` inchangé (ses recettes restent celles des bus et taxis) ; les recettes du rail
  s'ajoutent au bilan mensuel (`take_month`, via `ext_monthly_balance`) et repartent de zéro avec les compteurs du mois.
  L'empreinte déterministe (`agent_fingerprint`) couvre lignes, trains, rames, voyageurs et compteurs du rail.
* **Limites connues** : pas de correspondance ; un train ne s'arrête qu'aux gares de sa ligne (deux gares) ; les rails
  ne sont pas électrifiés ni signalés (les trains ne se gênent pas) ; la marche vers l'arrêt n'est pas animée.
* **Tests** : `rail/tests.rs`, `rail/tests_metro.rs` (plafonds : expansions, longueur de chemin, recherches, gares,
  lignes, arrêts, trains et rames par ligne, capacités ; choix du mode et égalités) et `tests/agents_rail.rs`
  (règle de pose, règles désactivées, tarifs et bilan mensuel, conservation à chaque tick à travers les changements de
  rails, tunnels, gares, règle, déterminisme, voitures inchangées avec ou sans rail) ; `web/test/wasm-rail.test.mjs`.
