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
