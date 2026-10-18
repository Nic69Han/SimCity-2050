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
| `vehicles(max)` | `Int32Array` d'enregistrements de 5 entiers `[id, genre, x16, y16, direction]`, au plus `max` ; `x16`, `y16` = position en seizièmes de tuile ; `genre` 0 voiture (1 bus, 2 taxi, 3 train, 4 métro : étapes suivantes) ; `direction` 0 nord, 1 est, 2 sud, 3 ouest |
| `traffic_load()` | `Uint8Array` une valeur par tuile (ordre des tuiles), charge mesurée 0..=255 |

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
