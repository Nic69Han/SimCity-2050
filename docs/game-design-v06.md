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
