# Conception du jeu : jalon v0.5 « bus et taxis »

Deuxième jalon du plan docs/plan-sc3000.md (étape B de docs/ia-simulation.md). S'appuie sur la circulation simulée
(v0.3, v0.3b) et sur la plateforme de bâtiments (v0.4). Règles du projet : désactivé par défaut, moteur classique
identique au C++, entiers, déterminisme, boucles bornées.

## Ce que voit le joueur
Trois nouveaux bâtiments : **arrêt de bus** (1×1, à côté d'une route), **dépôt de bus** (2×2) et **dépôt de taxis**
(2×2). Les habitants sans voiture qui ont un arrêt près de chez eux et un arrêt près de leur travail attendent à
l'arrêt ; les bus partent du dépôt, font la tournée des arrêts, prennent et déposent les voyageurs. Les autres
habitants sans voiture appellent un taxi. Les billets et les courses rapportent de l'argent, les dépôts coûtent un
entretien. Bus et taxis roulent en 2D et en 3D ; le panneau « Circulation simulée » affiche les voyageurs.

## Contrat (fixé avant les chantiers)
Actif seulement si **les deux** règles « Circulation simulée » (`agents`) et « Bâtiments étendus » (`structures`)
sont actives. Rien de nouveau n'est sauvegardé hormis les bâtiments (déjà sauvegardés par v0.4) : bus, taxis et
voyageurs repartent de la ville au chargement.

* Catalogue : genres 10 arrêt de bus (1×1), 11 dépôt de bus (2×2), 12 dépôt de taxis (2×2), effet 0 ; règle de pose
  propre à l'arrêt : au moins une route voisine (4 voisins).
* `vehicles(max)` inclut les bus (genre 1) et les taxis (genre 2), mêmes enregistrements de 5.
* Nouvelle méthode wasm `transport_stats()` → `Int32Array [bus_en_service, taxis_en_service, voyageurs_en_attente,
  voyages_bus_du_mois, courses_taxi_du_mois, recettes_du_mois]` (zéros si inactif).
* Recettes ajoutées au bilan mensuel (crochet `ext_monthly_balance`).

## Contrainte technique relevée à la relecture du v0.4
Le v0.4 donne à chaque genre sa propre tuile de surface (`SURFACE_BASE + genre - 1`, caractères 1019-1021) ; il ne
reste que les caractères 1022 et 1023 sous `LOMASK`. Le cœur v0.5 doit donc **découpler la tuile de surface du
genre** : une seule tuile de surface (ou une par grande famille, au plus 5 caractères 1019-1023) partagée par tous
les genres, l'appartenance d'une tuile à un bâtiment se lisant dans la liste des bâtiments ; `is_surface` et les
règles de cohérence du v0.4 restent vraies, et les fichiers v0.4 se rechargent à l'identique (tests). Les jalons
suivants ajouteront des dizaines de genres sans nouvelle tuile.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur bus et taxis** | Sonnet | `crates/micropolis-core/src/agents/` (nouveaux modules bus et taxis), catalogue des bâtiments (genres 10-12), wasm (`agents.rs` : `transport_stats`), tests |
| **Page** | Haiku | noms des genres 10-12 (`web/structures-model.js`), lignes « Bus » / « Taxis » / « Voyageurs en attente » / « Recettes » dans le panneau (`web/agents-ui.js`, `web/agents-model.js`), faux moteur, conseiller (beaucoup de voyageurs en attente → plus de bus), tests |
| **Véhicules 2D/3D** | Haiku | formes par genre : bus = boîte longue, taxi = petite boîte jaune (`web/view3d-vehicles*.js`, `web/map-layer-vehicles*.js`), tests |

## Critères d'acceptation
Comparaisons C++ identiques ; déterminisme ; conservation des voyageurs (attendant + à bord + arrivés + abandonnés
= créés) ; plafonds (bus par dépôt, taxis par dépôt, voyageurs par arrêt, capacité d'un bus) testés ; e2e : poser un
dépôt et deux arrêts, voir un bus rouler ; tous les tests verts ; relecture.

## Cœur bus et taxis (chantier livré)
Code : `crates/micropolis-core/src/agents/transport/` (`mod.rs` constantes, état et rafraîchissement, `net.rs` arrêts et
dépôts lus dans la liste des bâtiments, `route.rs` tournées des bus, `bus.rs`, `taxi.rs`, `demand.rs` création des
voyageurs et envoi des taxis, `step.rs` un pas, `riders.rs` voyageurs et compteurs, `api.rs` réponses de `Simulation`,
`tests.rs` plafonds) ; catalogue dans `structures/catalog.rs` ; adaptateur `crates/micropolis-wasm/src/agents.rs`
(`transport_stats()`) ; tests d'intégration `tests/agents_transport.rs`, `tests/structures_surface.rs`,
`web/test/wasm-transport.test.mjs`.

**Tuile de surface commune (refactor demandé).** Tous les genres posent la même tuile `SURFACE_TILE` = 1019 (bits
brûlable, bulldozable, conducteur). À qui appartient une tuile : la liste des bâtiments le dit, jamais le caractère.
`is_surface` accepte 1019..=1021 : les fichiers v0.4 (un caractère par genre, 1019 / 1020 / 1021) se rechargent
**tels quels** (la carte n'est pas réécrite ; test `a_v04_file_with_one_tile_per_genre_loads_and_behaves_as_before` :
liste, entretien, valeur du terrain, bulldozer, outils classiques, alimentation identiques). Les caractères 1022 et 1023
restent libres ; les jalons suivants n'ont besoin d'aucune nouvelle tuile. Cohérence (« intact » = toutes les tuiles de
l'empreinte sont une tuile de surface), réparation et nettoyage des tuiles orphelines : inchangés. Trois tests du v0.4
ont dû être adaptés car ils codaient l'ancienne disposition (`structures_save.rs` : la tuile lue après chargement ;
`structures_rules.rs` : l'entretien de « tout le catalogue » devient celui des trois genres posés ;
`wasm-structures.test.mjs` : le catalogue compte six genres, rayon ≥ 0).

**Catalogue.**

| Genre | Taille | Coût | Entretien/mois | Besoins | Rayon | Effet |
|---|---|---|---|---|---|---|
| 10 arrêt de bus | 1×1 | 50 | 1 | aucun | `WALK_RADIUS` (6) | aucun ; pose : une route sur un des 4 côtés (sinon refus 0) |
| 11 dépôt de bus | 2×2 | 600 | 25 | aucun | 0 | aucun |
| 12 dépôt de taxis | 2×2 | 400 | 15 | aucun | 0 | aucun |

La règle de pose de l'arrêt est un champ `needs_road` du catalogue (non exporté par `structure_catalog()`, qui garde
ses 8 nombres) : refus `Failed` (0) sans route voisine, vérifié après l'eau et avant « à déblayer ». Un dépôt sans route
voisine se pose (aucune règle de pose) mais ne fait rien : il n'est pas dans le réseau.

**Activation.** Seulement si `agents` **et** `structures` sont actives ; sinon `Run::transport` n'existe pas
(désactiver `structures` la supprime avec ses voyageurs), `transport_stats()` rend six zéros et aucun bus ni taxi n'est
dans `vehicles()`. Le générateur du transport est **propre** (graine : taille de la carte, `city_time`, sel
`0x5452414E`) : les voitures sont les mêmes avec ou sans bâtiments de transport (test).

**Réseau et tournées.** À chaque rafraîchissement (au démarrage, puis tous les `REFRESH_INTERVAL` ticks) le réseau est
relu : arrêts et dépôts intacts de la liste, chacun avec sa route d'accès (première route touchant l'empreinte :
lignes de haut en bas, voisins nord, est, sud, ouest). S'il diffère du réseau en service, ou si l'ensemble des routes
a changé, les **tournées sont reconstruites** : de chaque dépôt de bus une boucle fermée par plus proche voisin borné
(`MAX_ROUTE_STOPS` = 24 arrêts, `MAX_ROUTE_SEARCHES` = 48 essais, chacun un A* borné ; un arrêt sans chemin est
sauté ; pas de boucle de moins de deux tuiles). **Les bus et taxis en route sont alors retirés et leurs voyageurs
comptés abandonnés ; les voyageurs qui attendent à un arrêt qui existe encore continuent d'attendre**, ceux d'un arrêt
disparu sont abandonnés. Choix de simplicité : pas de réaffectation en cours de route.

**Voyageurs.** Habitants non motorisés d'une zone : `pop - pop × MOTORISED_PCT / 100`. À chaque tick, une tentative
(`RIDER_SPAWNS_PER_TICK` = 1) : zone résidentielle tirée, destination = la plus proche de `DEST_SAMPLES` zones
d'emploi tirées, puis
* **bus** si un arrêt est à moins de `WALK_RADIUS` (6, distance de Manhattan depuis le centre de la zone) du domicile
  et un autre de l'emploi, tous deux sur une même tournée : le voyageur attend à l'arrêt du domicile ;
* sinon **taxi** s'il y a un dépôt de taxis et que les routes d'accès du domicile et de l'emploi diffèrent : il
  appelle un taxi (file d'appels) ; sinon pas de trajet.
Part d'une zone : `zone_rider_cap(pop)` = non motorisés / `RESIDENTS_PER_RIDER` (2), au moins 1, 0 s'il n'y en a pas.
Un voyageur attend au plus `MAX_WAIT_TICKS` (1200), sinon il abandonne.

**Bus.** `MAX_BUSES_PER_DEPOT` (3) par dépôt, un départ tous les `BUS_SPAWN_INTERVAL` (40) ticks tant que la tournée
existe (les bus roulent même à vide). Ils font la boucle sans fin, s'arrêtent `BUS_DWELL_TICKS` (4) à chaque arrêt de
leur tournée : descendent les voyageurs dont c'est l'arrêt (`BUS_FARE` = 3 $ chacun), montent ceux qui attendent
dont l'arrêt d'arrivée est sur la tournée, jusqu'à `BUS_CAPACITY` (12). Même vitesse que les voitures (ralentie par la
charge) ; leurs tuiles comptent dans la charge mesurée.

**Taxis.** `MAX_TAXIS_PER_DEPOT` (3) en route par dépôt ; un taxi n'existe que pendant une course : le plus ancien appel
est servi (un par tick au plus) depuis le dépôt libre le plus proche, trajet dépôt → route du domicile → route de
l'emploi → dépôt (trois A* bornés, `MAX_TRANSPORT_SEARCHES_PER_TICK` = 3). Sans chemin, le voyageur repasse au bout de
la file, puis abandonne après `MAX_TAXI_FAILURES` (3). Course payée à la dépose : `TAXI_FARE_PER_TILE` (2 $) × tuiles
parcourues avec le voyageur. File d'appels : `MAX_TAXI_REQUESTS` (64).

**Plafonds.** `MAX_RIDERS` = 512 voyageurs dans la ville, `MAX_WAITING_PER_STOP` = 24 par arrêt, part par zone,
`MAX_TAXI_REQUESTS`, `BUS_CAPACITY`, `MAX_BUSES_PER_DEPOT`, `MAX_TAXIS_PER_DEPOT`, `MAX_ROUTE_STOPS`, recherches par
tick : chacun testé (`agents/transport/tests.rs`). Un voyage refusé pour plafond est compté dans `refused`, il n'est
pas « créé ». Toutes les boucles sont bornées par ces constantes ou par la taille des listes (≤ `MAX_STRUCTURES`,
≤ `MAX_RIDERS`).

**Conservation.** `Audit::balanced()` : `créés = en attente (arrêts + appels + taxi pas encore monté) + à bord (bus +
taxi) + arrivés + abandonnés`, testé à chaque tick dans tous les scénarios (`agents_transport.rs`, `tests.rs`), y compris
à travers des ajouts et retraits d'arrêts et de dépôts et une route coupée.

**Recettes.** Les billets et les courses s'accumulent dans les compteurs du mois ; `ext_monthly_balance` les prélève
(`take_transport_income`, négatif = recette) avec les entretiens puis remet les compteurs du mois à zéro.
`transport_stats()` = `[bus, taxis, voyageurs_en_attente, voyages_bus_du_mois, courses_taxi_du_mois, recettes_du_mois]`
(depuis le dernier bilan mensuel). `vehicles(max)` : voitures, puis bus (genre 1), puis taxis (genre 2) ; identifiants
des bus et taxis à partir de `VEHICLE_ID_BASE` = 2^30 (jamais ceux des voitures) ; direction d'un bus : la tuile
suivante de sa boucle.

**Déterminisme.** Entiers, ordres fixes, générateur propre ; `agent_fingerprint` inclut bus, taxis, files et voyageurs
(deux exécutions identiques, test ; l'empreinte change à chaque tick d'un transport actif). Règle éteinte : moteur
d'origine ; avec la règle des bâtiments allumée et aucun bâtiment, les voitures et la ville sont identiques bit à bit
(test). Rien de nouveau n'est sauvegardé.

**Performance** (Haight 120×100, 3 000 ticks après 500 de chauffe, `cargo test --release -p micropolis-core --test
agents_transport -- --ignored --nocapture`, 20 arrêts, 3 dépôts de bus, 3 dépôts de taxis) : 0,057 ms/tick voitures
seules, 0,056 ms/tick avec le transport (dans la marge de mesure) ; `agents_rules` : 0,014 à 0,019 ms règle éteinte,
0,050 à 0,053 ms règle active (inchangé).
