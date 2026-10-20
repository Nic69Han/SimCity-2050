# Conception du jeu : jalon v0.8 « déchets »

Cinquième jalon du plan docs/plan-sc3000.md. Comme SimCity 3000 : la ville produit des déchets, il faut les ramasser
et les traiter, sinon les ordures s'accumulent, polluent et les habitants se plaignent. Règle « Déchets » désactivée
par défaut ; moteur classique identique au C++ ; entiers, déterminisme, boucles bornées. Les bâtiments sont des genres
du catalogue v0.4 (aucune nouvelle tuile de surface).

## Ce que voit le joueur
* Quatre bâtiments : **décharge** (3×3, bon marché, pollue autour, capacité limitée qui se remplit), **incinérateur**
  (2×2, brûle beaucoup, pollue l'air, a besoin d'électricité), **centre de recyclage** (2×2, réduit les déchets
  produits dans son rayon), **usine de valorisation** (3×3, brûle les déchets et produit de l'électricité).
* Chaque zone produit des déchets selon sa population ; la production non traitée devient des **ordures
  accumulées** sur la carte (une couche « Déchets » les montre), qui ajoutent de la pollution et font baisser la valeur
  du terrain.
* **Accord avec les voisins** : exporter les déchets contre paiement (accords v0.2b, nouvelle ressource « déchets »).
* Le conseiller de l'environnement parle des ordures accumulées et propose un remède.

## Contrat (fixé avant les chantiers)
Interrupteur `Extensions::waste` (bit libre suivant des règles), sauvegardé ; les ordures accumulées et le
remplissage des décharges sont sauvegardés dans un nouveau morceau du bloc d'extensions. Fichier sans déchet et règle
éteinte = identique octet pour octet. Actif seulement si `structures` est aussi active.

* Catalogue : genres 20 décharge (3×3), 21 incinérateur (2×2, électricité), 22 centre de recyclage (2×2),
  23 usine de valorisation (3×3, produit de l'électricité : capacité ajoutée au réseau comme une centrale).
* API wasm (`crates/micropolis-wasm/src/waste.rs`) :

| Méthode | Retour |
|---|---|
| `waste_rules()` / `set_waste_rules(on)` | interrupteur |
| `waste_stats()` | `Int32Array [produits_par_mois, traités_par_mois, recyclés_par_mois, exportés_par_mois, accumulés_total, capacité_décharges_restante, électricité_produite]` |
| `waste_layer()` | `Uint8Array` une valeur par tuile (ordre `x * hauteur + y`) : ordures accumulées 0..=255 |

* Accords v0.2b : nouvelle ressource « déchets » (indice 2) dans les offres et les accords ; un accord d'export
  coûte au lieu de rapporter (prix négatif documenté), et retire la quantité des déchets à traiter.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur des déchets** | Sonnet | `crates/micropolis-core/src/waste.rs` (+ sous-modules), catalogue (genres 20-23), crochets (`ext_monthly_balance`, `ext_pollution`, `ext_land_value`, électricité de l'usine de valorisation), ressource « déchets » dans `deals.rs`, `crates/micropolis-wasm/src/waste.rs`, tests, section livrée |
| **Page** | Haiku | noms des genres 20-23, panneau « Déchets » (`web/waste-ui.js` + `web/waste-model.js` + `web/css/waste.css` : interrupteur et statistiques), conseiller de l'environnement, ressource « déchets » dans le panneau des accords, faux moteur, tests |
| **Couche et 3D** | Haiku | `web/map-layer-waste.js` (+ modèle : ordures accumulées), formes 3D des genres 20-23 dans `web/view3d-structures-model.js` (décharge = tas brun, incinérateur = bâtiment avec cheminée, recyclage = hangar vert, valorisation = bâtiment avec cheminée et toit bleu), tests |

## Critères d'acceptation
Comparaisons C++ identiques ; conservation des déchets (produits = traités + recyclés + exportés + accumulés,
par mois) ; plafonds testés ; décharge pleine qui ne prend plus rien ; électricité de la valorisation comptée dans le
réseau ; sauvegarde aller-retour ; e2e : activer les déchets, poser une décharge, voir la couche ; tous les tests verts ;
relecture.

## Cœur des déchets (chantier livré)
Livré dans `crates/micropolis-core/src/waste.rs` (+ `waste/` : `production`, `treatment`, `spread`, `effects`,
`month`, `rules`), `crates/micropolis-wasm/src/waste.rs`, `deals.rs` (cœur et adaptateur), `extensions.rs`,
`power.rs`, le catalogue. Tests : `tests/waste_rules.rs`, `tests/waste_save.rs` et les tests unitaires des modules.

* **Interrupteur** `Extensions::waste`, bit 6 (`0b100_0000`) du morceau des règles ; l'ancien « drapeau inconnu » de
  test passe à `0b1000_0000`. Actif seulement avec `structures` (`waste_active`). Éteint : crochets inertes, appels
  vides, `waste_stats()` tout à 0, `waste_layer()` tout à 0 ; l'éteindre oublie les ordures, les remplissages et
  les accords de déchets (gratuitement).
* **Mois** = une collecte d'impôts (crochet `ext_monthly_balance`). Production d'une zone : `population × % / 100`
  avec 25 % (résidentiel), 40 % (commercial), 60 % (industriel) ; la population des zones commerciales et
  industrielles vaut `TIER_POPULATION` = 8 par palier.
* **Ordre du traitement** : recyclage (chaque centre à moins de `RECYCLING_RADIUS` = 8 tuiles de la zone retire
  `RECYCLING_PCT` = 30 % de sa production, au plus `RECYCLING_MAX_PCT` = 60 %) → incinérateurs (300 par mois chacun,
  électricité nécessaire) → usines de valorisation (500 par mois chacune, `WTE_POWER_STRENGTH` = 400 tuiles
  d'électricité ajoutées au réseau comme une centrale) → décharges (`LANDFILL_CAPACITY` = 20 000 unités, pleine
  ensuite, dans l'ordre de la liste) → accords d'export → le reste s'accumule autour des zones qui l'ont produit
  (neuf tuiles de la zone, puis carré de rayon `SPILL_RADIUS` = 3, puis n'importe où), au plus `TILE_CAP` = 255 par
  tuile. La capacité restante mange ensuite les ordures déjà accumulées : `BACKLOG_DECAY` = 4 par tuile et par mois.
* **Conservation** (testée chaque mois) : `produites = traitées + recyclées + exportées + (pile après − pile avant)
  + perdues` ; la première mois, `produites = traitées + recyclées + exportées + accumulées`. « Perdues » = ce
  qu'aucune tuile ne peut tenir (0 sauf carte pleine). « Traitées » comprend les ordures anciennes mangées.
* **Effets** : pollution + `pile_max_du_bloc / 8` et valeur du terrain − `pile_max_du_bloc / 6` ; décharge,
  incinérateur et usine de valorisation qui fonctionnent polluent autour d'eux (40/3, 60/4, 30/3 :
  intensité, rayon, décroissance linéaire).
* **Accords** : ressource 2 « déchets », offres 8 à 11 (nord, est, sud, ouest), seulement avec la règle des déchets.
  **Signe** : la ville *paie* le voisin. Le moteur garde `amount` (unités par mois) et `price` (dollars par unité
  réellement prise) positifs ; l'adaptateur affiche `price` et `yearly_income` **négatifs** pour la ressource 2
  (`cancel_penalty` reste le nombre positif de dollars payés). Un accord de déchets n'a pas de surplus à couvrir,
  ne se rompt jamais et ne part que par `cancel_deal` ou en éteignant la règle. `deal_offers()` renvoie 12
  enregistrements (au lieu de 8) quand la règle des déchets est active.
* **Sauvegarde** : morceau 8 (`CHUNK_WASTE`, `CHUNK_MAX_TAG` = 8) : nombre de décharges (2 octets), puis par
  décharge x, y (2+2), remplissage (4), puis par tuile non vide x, y (2+2), unités (1) ; ordre strictement
  croissant, refus de tout enregistrement coupé ou impossible. Règle éteinte et rien de stocké : fichier identique
  octet pour octet. Au chargement, les remplissages des décharges disparues sont oubliés.
* **API wasm** comme dans le tableau ci-dessus ; `waste_stats()` : `[produits, traités, recyclés, exportés,
  accumulés_total, capacité_restante, électricité]`, où l'électricité est la capacité en tuiles des usines de
  valorisation qui fonctionnent.
