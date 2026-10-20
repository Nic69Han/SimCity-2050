# Conception du jeu : jalon v0.10 « énergie »

Septième jalon du plan docs/plan-sc3000.md. Comme SimCity 3000 : un choix de centrales (gaz, pétrole, éolienne,
solaire, hydroélectrique, micro-ondes, fusion) qui diffèrent par le prix, la puissance, la pollution et la durée de vie ;
les centrales **vieillissent** et doivent être remplacées ; on peut **acheter de l'électricité** aux voisins. Règle
« Énergie étendue » désactivée par défaut ; moteur classique identique au C++ ; entiers, déterminisme, boucles bornées ;
centrales = genres du catalogue v0.4 (aucune tuile nouvelle), branchées sur le réseau électrique classique.

## Ce que voit le joueur
* Sept centrales nouvelles (genres 40-46) : **gaz** (3×3), **pétrole** (3×3), **éolienne** (1×1, faible puissance,
  aucune pollution), **solaire** (3×3), **hydroélectrique** (2×2, posée au bord de l'eau), **micro-ondes** (3×3, très
  puissante, rare risque d'accident), **fusion** (4×4, très chère, très puissante, propre).
* Chaque centrale a une **durée de vie** (années) ; à 80 % elle perd de la puissance ; en fin de vie elle s'arrête
  (et la centrale classique à charbon ou nucléaire aussi, avec la règle active) : le conseiller prévient avant.
* **Achat d'électricité** aux voisins : la ressource « électricité » des accords v0.2b peut s'acheter (prix négatif),
  comme l'export de déchets du v0.8.
* Panneau « Énergie » : production, consommation, centrales et leur âge ; couche « Pollution de l'air » existante.

## Contrat (fixé avant les chantiers)
Interrupteur `Extensions::energy` (bit 1 du **second octet** des règles, créé par le v0.9), sauvegardé ; l'âge des
centrales est sauvegardé (nouveau morceau 10). Actif seulement si `structures` est aussi active.

* Catalogue : genres 40 gaz, 41 pétrole, 42 éolienne, 43 solaire, 44 hydroélectrique (règle de pose : une tuile d'eau
  voisine), 45 micro-ondes, 46 fusion ; tous conducteurs ; chacun ajoute sa puissance au réseau (comme le v0.8 pour
  l'usine de valorisation : même crochet dans `power.rs`).
* API wasm (`crates/micropolis-wasm/src/energy.rs`) :

| Méthode | Retour |
|---|---|
| `energy_rules()` / `set_energy_rules(on)` | interrupteur |
| `energy_stats()` | `Int32Array [production, consommation, achetée, centrales, centrales_en_fin_de_vie, pollution_de_l_air_produite]` |
| `power_plants()` | `Int32Array` d'enregistrements de 6 `[genre, x, y, âge_mois, durée_de_vie_mois, puissance_actuelle]` (genre 0 et 1 pour les centrales classiques charbon et nucléaire) |

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur de l'énergie** | Sonnet | `crates/micropolis-core/src/energy.rs` (+ sous-modules), catalogue (genres 40-46), crochet de puissance dans `power.rs`, vieillissement, pollution (`ext_pollution`), achat via `deals.rs`, `crates/micropolis-wasm/src/energy.rs`, tests, section livrée |
| **Page** | Haiku | noms des genres 40-46, panneau « Énergie » (`web/energy-ui.js`, `web/energy-model.js`, `web/css/energy.css`), conseiller (déficit, centrales en fin de vie), achat d'électricité dans le panneau des accords, faux moteur, tests |
| **3D** | Haiku | formes 3D des genres 40-46 dans `web/view3d-structures-model.js` (éolienne = mât et pales, solaire = panneaux inclinés bleus, hydro = barrage, fusion = dôme), tests |

## Critères d'acceptation
Comparaisons C++ identiques ; puissance ajoutée et retirée testée ; vieillissement (perte à 80 %, arrêt en fin de vie)
testé ; pollution par genre testée ; achat aux voisins testé (conservation de l'électricité) ; sauvegarde aller-retour ;
e2e : activer l'énergie, poser une éolienne, voir la production monter ; tous les tests verts ; relecture.
