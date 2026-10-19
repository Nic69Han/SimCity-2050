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
