# Conception du jeu : jalon v0.3 « vivant » (étape A : voitures)

Première étape de l'IA de simulation (docs/ia-simulation.md, étape A ; recommandations de
docs/etude-egregoria.md). Les règles du projet s'appliquent : règle étendue désactivée par défaut (moteur
identique au C++), entiers et déterminisme, boucles bornées, développeur senior (Sonnet) pour le cœur,
développeurs cadrés (Haiku) pour l'affichage et la page, relecture Opus avant intégration.

## Ce que voit le joueur
Avec « Circulation simulée » activée, des voitures roulent sur les routes entre les quartiers résidentiels et
les zones d'emploi ; les bouchons apparaissent là où le réseau est saturé ; la carte du trafic devient le trafic
mesuré ; les conseillers en parlent.

## Contrat moteur ↔ page (fixé avant les chantiers)
Interrupteur `Extensions::agents` (règle « Circulation simulée »), désactivé par défaut. Les agents ne sont pas
sauvegardés : au chargement, ils repartent de la ville (seul l'interrupteur est sauvegardé).

API wasm (`crates/micropolis-wasm/src/agents.rs`) :

| Méthode | Retour |
|---|---|
| `agent_rules()` / `set_agent_rules(on)` | interrupteur |
| `agent_stats()` | `Int32Array [voitures_actives, trajets_terminés, durée_moyenne_ticks, tuiles_saturées, habitants_motorisés]` |
| `vehicles(max)` | `Int32Array` d'enregistrements de 5 entiers `[id, genre, x16, y16, direction]`, au plus `max` ; `x16`, `y16` = position du centre du véhicule en seizièmes de tuile depuis le coin haut-gauche de la carte (au milieu de la tuile `(tx, ty)` : `tx*16+8`, `ty*16+8`) ; `genre` 0 voiture (1 bus, 2 taxi, 3 train, 4 métro : étapes suivantes) ; `direction` 0 nord, 1 est, 2 sud, 3 ouest |
| `traffic_load()` | `Uint8Array` une valeur par tuile (ordre des tuiles du moteur, comme `tiles()` : indice `x * hauteur + y`), charge mesurée 0..=255 |

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur des agents** | Sonnet (senior) | `crates/micropolis-core/src/agents/` (graphe, A* borné, générateur propre, véhicules), branchement à `ext_traffic`, interrupteur dans `extensions.rs`, `crates/micropolis-wasm/src/agents.rs` |
| **Voitures en 2D** | Haiku (cadré) | `web/map-layer-vehicles.js` (+ partie pure), tests |
| **Voitures en 3D** | Haiku (cadré) | `web/view3d-vehicles.js` (+ partie pure), tests |
| **Panneau et faux moteur** | Haiku (cadré) | `web/agents-ui.js`, `web/css/agents.css`, `vehicles()`/`agent_stats()` dans `web/test/mock-engine.mjs`, tests |

## Critères d'acceptation
Comparaisons C++ identiques ; déterminisme (deux exécutions identiques, empreinte d'état) ; conservation (aucun
véhicule perdu ni dupliqué) ; plafonds respectés (véhicules, chemins par tick, expansions A*) ; performance :
la simulation d'une ville de 120×100 avec la règle active reste fluide (mesure dans le rapport) ; tous les
tests verts ; relecture Opus.

## Cœur des agents (chantier livré)
Module `crates/micropolis-core/src/agents/` (graph, path, rng, vehicles, load, mod) ; interrupteur
`Extensions::agents` ; adaptateur `crates/micropolis-wasm/src/agents.rs`. Règle désactivée : aucun code des
agents ne s'exécute, le moteur reste identique au C++ (comparaisons inchangées).

**Principe.** Le graphe est la carte classée : une tuile route (`ROADBASE..POWERBASE`) est un nœud, ses voisines
routes N/E/S/O sont ses arêtes ; chaque centre de zone (bit `ZONEBIT`) résidentielle, commerciale ou industrielle
a une route d'accès (première route de l'anneau de 12 tuiles du moteur classique). Le graphe est relu tous les
`REFRESH_INTERVAL` ticks et remplacé seulement s'il diffère ; les voitures dont une tuile de chemin n'est plus une
route sont retirées (compteur `abandoned`). À chaque tick de simulation (début de `simulate`, hook
`ext_agents_tick`, un seul appel) : au plus `MAX_PATH_SEARCHES_PER_TICK` trajets sont lancés (zone résidentielle
tirée au hasard, si elle a de la place ; destination = la plus proche de `DEST_SAMPLES` zones d'emploi tirées au
hasard ; A* borné), toutes les voitures avancent, puis la charge est mesurée. Trajet aller simple : la voiture
arrive à la route d'accès de la destination, est comptée dans `finished_trips` et disparaît.

**Mouvement et saturation.** Position en seizièmes de tuile ; vitesse `MAX_SPEED`=8 (route libre) à
`MIN_SPEED`=1 (tuile pleine) selon la charge de la tuile. Charge d'une tuile : voitures présentes × `LOAD_PER_CAR`
(64), lissée (1/4 de l'écart par tick), 0..=255 ; tuile saturée si ≥ `SATURATED_LOAD` (160). Le coût A* d'un pas =
10 + charge/8 : les conducteurs contournent les bouchons.

**Trafic mesuré (choix : remplacement).** Avec la règle active, la carte de densité du trafic est réécrite à chaque
tick avec le maximum de charge des routes de chaque bloc, et `ext_traffic` renvoie la charge mesurée du bloc : la
décroissance classique ne la baisse pas, et les +50 du trafic statistique sont écrasés au tick suivant.

**Plafonds.** `MAX_VEHICLES`=1024 ; `MAX_PATH_SEARCHES_PER_TICK`=2 ; `MAX_EXPANSIONS`=2048 pops d'A* ;
`MAX_PATH_LEN`=256 tuiles (au-delà : pas de trajet) ; `DEST_SAMPLES`=3 ; voitures simultanées par zone =
habitants × `MOTORISED_PCT`(60) % / `RESIDENTS_PER_CAR`(4), au moins 1. Toutes les boucles sont bornées par ces
constantes ou par la taille de la carte (tests `agents_rules.rs::caps_hold`, `a_search_stops_at_its_expansion_cap`).

**Déterminisme.** Générateur propre SplitMix64 (`agents/rng.rs`) initialisé par la taille de la carte et
`city_time` au démarrage de la flotte ; il ne touche jamais le générateur de la simulation (test). Entiers seuls,
ordres de parcours fixes, départages de l'A* fixes ; empreinte d'état `agent_fingerprint` identique sur deux
exécutions. Conservation : `spawned = actives + finished + abandoned`, identifiants uniques jamais réutilisés.

**Contrat wasm.** `vehicles(max)` : `x16`, `y16` = centre du véhicule en seizièmes de tuile depuis le coin haut
gauche (milieu de la tuile `(tx, ty)` = `tx*16+8`, `ty*16+8`) ; `traffic_load()` : une valeur par tuile dans
l'ordre des tuiles `x * hauteur + y` ; règle désactivée : statistiques à zéro, aucun véhicule, charge nulle.

**Sauvegarde.** Bit `0b1000` du bloc 1 (interrupteurs) : seul l'interrupteur est enregistré ; les voitures
repartent de la ville au chargement (`Fleet` vit dans `Extensions` mais est ignorée par la comparaison). Un
fichier avec la règle désactivée est identique à celui d'avant. Le bit « inconnu » des tests d'erreur de bloc est
passé de `0b1000` à `0b1_0000`.

**Performance** (`cargo test --release -p micropolis-core --test agents_rules -- --ignored --nocapture`, Haight
120×100, régime établi, ~190 voitures) : 0,022 ms/tick règle désactivée, 0,066 ms/tick règle active (≈ 15 000
ticks/s), soit un surcoût de ≈ 0,044 ms par tick.
