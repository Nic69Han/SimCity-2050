# Conception du jeu : jalon v0.7 « densités de zonage et fermes »

Quatrième jalon du plan docs/plan-sc3000.md. Comme SimCity 3000 : chaque zone résidentielle, commerciale ou
industrielle est **légère, moyenne ou dense**, et l'industrie légère loin de la ville devient des **fermes**. Règles du
projet : règle « Densités de zonage » désactivée par défaut, moteur classique identique au C++, entiers, déterminisme.

## Ce que voit le joueur
* Neuf outils de zonage (Résidentiel / Commercial / Industriel × léger / moyen / dense) dans un groupe « Zonage » ;
  le prix d'une zone dépend de sa densité (léger moins cher).
* Une zone ne grandit pas au-delà de sa densité : une zone légère reste en petits bâtiments, une zone dense peut
  atteindre les tours. Le zonage classique (outils d'origine) compte comme **dense** (aucun plafond).
* **Fermes** : une zone industrielle légère dont la valeur du terrain est basse et loin de la pollution devient une
  ferme : emplois industriels sans pollution, champs dessinés en 2D et en 3D.
* Une couche de carte « Densités » colore les zones par densité ; les fermes ont leur couleur.

## Contrat (fixé avant les chantiers)
Interrupteur `Extensions::densities` (bit libre suivant du morceau 1 des règles), sauvegardé ; la densité de chaque
zone est sauvegardée dans un nouveau morceau du bloc d'extensions (numéro libre suivant), un octet par centre de zone
(compact : liste `[x, y, densité]` des zones non denses). Fichier sans densité et règle éteinte = identique octet pour
octet.

API wasm (`crates/micropolis-wasm/src/densities.rs`) :

| Méthode | Retour |
|---|---|
| `density_rules()` / `set_density_rules(on)` | interrupteur ; l'éteindre rend toutes les zones denses (plafond levé) |
| `zone_preview(genre, densité, x, y)` | `Int32Array [code, coût]` (codes des outils) ; `genre` 1 R, 2 C, 3 I ; `densité` 1 légère, 2 moyenne, 3 dense |
| `place_zone(genre, densité, x, y)` | code ; (x, y) = **centre** de la zone 3×3, comme l'outil classique |
| `density_layer()` | `Uint8Array` une valeur par tuile (ordre `x * hauteur + y`) : 0 rien, 1-3 densité sur les 9 tuiles d'une zone, 4 ferme |
| `density_stats()` | `Int32Array [zones_légères, zones_moyennes, zones_denses, fermes, emplois_agricoles]` |

## Règles du moteur (chantier cœur, Sonnet)
* La pose réutilise l'outil de zone classique (même règles de terrain, d'eau, de bulldozer) puis enregistre la
  densité ; le coût = coût classique × `DENSITY_COST_PCT[densité]` / 100 (constantes nommées).
* Plafond par densité dans `ext_zone_can_grow` : la croissance d'une zone est refusée quand sa population de zone
  (`get_res_zone_pop` / `get_com_zone_pop` / `get_ind_zone_pop`) atteint `DENSITY_CAP[genre][densité]`.
* Ferme : zone industrielle légère, valeur du terrain < `FARM_LAND_VALUE_MAX`, pollution du bloc <
  `FARM_POLLUTION_MAX` ; recalculée au passage mensuel ; une ferme ne produit pas de pollution (`ext_pollution`).
* Une zone démolie (bulldozer, feu, catastrophe) perd son entrée ; réparation de cohérence au chargement et chaque
  mois (comme les bâtiments v0.4).

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur des densités** | Sonnet | `crates/micropolis-core/src/densities.rs` (+ sous-modules), branchements dans `extensions.rs`, `crates/micropolis-wasm/src/densities.rs`, tests, section livrée |
| **Outils et panneau** | Haiku | `web/tools-zoning.js` (outil supplémentaire, enregistré dans `extra-tools.js` par la relecture), `web/zoning-model.js`, `web/zoning-ui.js` + `web/css/zoning.css` (interrupteur et statistiques), faux moteur, tests |
| **Carte et 3D** | Haiku | `web/map-layer-densities.js` (+ modèle) ; `web/view3d-farms.js` (+ modèle) : champs des fermes ; tests |

## Critères d'acceptation
Comparaisons C++ identiques ; règle éteinte = moteur d'origine ; plafonds de croissance testés pour les 9
combinaisons ; fermes testées (apparition, disparition quand la valeur monte, pollution nulle) ; sauvegarde aller-
retour ; e2e : poser une zone résidentielle légère, la voir dans la couche « Densités » ; tous les tests verts ; relecture.
