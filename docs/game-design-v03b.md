# Conception du jeu : jalon v0.3b « vivant » (aller-retour et conseiller de la circulation)

Suite du v0.3 (docs/game-design-v03.md). Mêmes règles (docs/regles-de-code.md) : règle « Circulation simulée »
désactivée par défaut, moteur classique identique au C++, entiers et déterminisme, boucles bornées ;
développeur senior (Sonnet) pour le cœur, développeur cadré (Haiku) pour la page, relecture Opus avant
intégration.

## Ce que voit le joueur
Les voitures font l'aller-retour : le matin elles vont au travail, elles y restent un moment (garées, invisibles),
puis rentrent à la maison par le chemin le moins chargé. Les rues se chargent dans les deux sens. Le conseiller
d'urbanisme parle des bouchons mesurés et propose un remède (métro si la règle est active, sinon des routes
parallèles).

## Contrat (inchangé côté page)
L'API wasm du v0.3 ne change pas : `agent_rules`, `set_agent_rules`, `agent_stats` (5 entiers, même ordre),
`vehicles(max)`, `traffic_load()`. Un trajet terminé = une étape (aller **ou** retour) arrivée. Les voitures garées
ne sont ni dans `vehicles()` ni dans `voitures_actives`. Rien de nouveau n'est sauvegardé.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Aller-retour et scénario de bouchons** | Sonnet (senior) | `crates/micropolis-core/src/agents/` (voitures garées au travail `WORK_TICKS`, recherche du retour prioritaire dans le budget de recherches par tick, plafond commun voitures roulantes + garées = `MAX_VEHICLES`), `crates/micropolis-core/tests/agents_*.rs`, section livrée de ce document |
| **Conseiller de la circulation** | Haiku (cadré) | `web/advisors-model.js`, `web/advisors.js` (lecture de `agent_stats` seulement si `agent_rules()` est vrai), `web/test/advisors*.test.mjs` |

## Critères d'acceptation
Comparaisons C++ identiques ; déterminisme ; conservation étendue (`lancées = roulantes + garées + terminées
définitivement + abandonnées`, à préciser par le cœur) ; plafonds respectés ; un scénario de test où des tuiles
saturent réellement et où la durée moyenne d'un trajet augmente avec la charge ; conseiller testé (règle éteinte →
rien, bouchons → attention puis urgent, remède selon la règle du métro) ; tous les tests verts ; relecture Opus.

## Aller-retour (chantier livré)
Code : `crates/micropolis-core/src/agents/` (`run.rs` flotte en marche, `trips.rs` départs, retours et arrivées,
`vehicles.rs` voitures roulantes `Car` et garées `Parked`, `trips_tests.rs` plafonds et priorités) ; tests
d'intégration `crates/micropolis-core/tests/agents_trips.rs`. L'adaptateur wasm n'a pas changé.

**Principe.** Une voiture qui arrive à la route d'accès de sa zone d'emploi (étape `Out`) se gare `WORK_TICKS`
ticks de flotte : elle n'est plus sur la route (ni dans `agent_vehicles`, ni dans `agent_stats()[0]`, aucune
charge), puis rentre par une nouvelle recherche A* bornée, de la route d'accès de l'emploi à celle du domicile
(étape `Back`). À l'arrivée à la maison elle disparaît. Chaque tick : d'abord les retours des voitures garées dont
le temps est écoulé (dans l'ordre d'arrivée), puis les nouveaux départs avec ce qui reste de
`MAX_PATH_SEARCHES_PER_TICK`. Une recherche de retour sans chemin laisse la voiture garée et recommence aux ticks
suivants ; après `MAX_RETURN_FAILURES` échecs elle est abandonnée. Si l'emploi et le domicile partagent la même route
d'accès, la voiture est déjà rentrée (aller-retour terminé sur-le-champ). Au rafraîchissement du graphe, une voiture
(roulante ou garée) dont la zone de domicile ou d'emploi n'existe plus (ou n'a plus de route d'accès), ou dont une
tuile du chemin n'est plus une route, est abandonnée.

**Constantes.** `WORK_TICKS` = 120 ; `MAX_RETURN_FAILURES` = 8 ; `MAX_VEHICLES` = 1024 s'applique maintenant aux
voitures roulantes **et** garées ensemble ; le plafond par domicile (`zone_car_cap`) compte aussi les garées ;
les autres plafonds du v0.3 sont inchangés.

**Compteurs et invariant** (`Counters`, `Simulation::agent_counters`).
* `spawned` : allers-retours commencés (une voiture créée) ; `finished` : **étapes** arrivées, aller ou retour
  (c'est `agent_stats()[1]`) ; `round_trips` : allers-retours terminés (voiture rentrée) ; `abandoned` : voitures
  retirées (route, zone de domicile ou d'emploi disparue, échecs de retour) ; `parked` et `returning` : instantanés
  (garées, roulantes en retour).
* **Invariant de conservation** : `spawned = roulantes + garées + round_trips + abandoned`, avec
  `roulantes = agent_stats()[0]`. Les étapes comptent à part : toute voiture non abandonnée a fait
  `finished = 2 × round_trips + garées + roulantes_en_retour` étapes (les voitures abandonnées ont pu en faire 0, 1
  ou 2 de plus : `finished + abandoned ≥ 2 × round_trips + garées + en_retour`). Testé à chaque tick
  (`agents_trips.rs::conservation_holds_every_tick_and_legs_add_up`, `agents_rules.rs::no_car_is_lost_or_duplicated`,
  `a_cut_road_removes_the_cars_that_needed_it`).
* `trip_ticks` additionne la durée de chaque étape (hors temps de stationnement) ; la durée moyenne de
  `agent_stats()[2]` est `trip_ticks / finished`.

**Déterminisme.** L'empreinte `agent_fingerprint` inclut maintenant les voitures garées (identifiant, domicile,
emploi, échecs, instant de départ), l'étape de chaque voiture roulante et `round_trips`. Générateur propre
inchangé (jamais celui de la simulation). Règle désactivée : moteur d'origine ; seul l'interrupteur est sauvegardé.

**Scénario de bouchons** (`agents_trips.rs::a_crowded_corridor_saturates_and_trips_take_longer_than_when_free`,
< 0,1 s en debug). Une route unique de 60 tuiles, 16 zones résidentielles au bord de la route, 8 zones d'emploi à
l'autre bout, tuiles construites à la main, flotte pilotée par `ext_agents_tick` seul, 700 ticks. Mêmes tuiles
de route et mêmes emplacements ; seule la densité des zones résidentielles change (densité 0 : 2 voitures par zone,
densité 3 : 6). Mesures : version fluide `[19 voitures, 139 étapes, durée moyenne 83, pic de 1 tuile saturée]` ;
version dense `[61, 296, durée moyenne 136, pic de 12 tuiles saturées]` : durée moyenne ×1,6. Le test exige au
moins 8 tuiles saturées (`agent_stats()[3] > 0`) en version dense, au plus 2 en version fluide, et au moins +25 % de
durée.

**Performance** (`cargo test --release -p micropolis-core --test agents_rules -- --ignored --nocapture`, Haight
120×100, 3 000 ticks après 500 de chauffe). Avant : 0,023 ms/tick règle éteinte, 0,063 ms/tick règle active
(179 voitures roulantes). Après : 0,019 à 0,027 ms règle éteinte, 0,060 à 0,066 ms règle active (182 roulantes,
113 garées, 86 en retour, 2 868 allers-retours terminés, 316 présentes au plus) : surcoût inchangé à la marge
de mesure (≈ 0,04 ms par tick).
