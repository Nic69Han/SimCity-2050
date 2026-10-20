# Conception du jeu : jalon v0.9 « éducation, santé, justice »

Sixième jalon du plan docs/plan-sc3000.md. Comme SimCity 3000 : des écoles, collèges, bibliothèques et musées qui
élèvent le **niveau d'éducation** (EQ) de la ville ; des cliniques et hôpitaux qui allongent l'**espérance de vie** ;
une prison qui fait baisser la criminalité. Règle « Services publics » désactivée par défaut ; moteur classique
identique au C++ ; entiers, déterminisme, boucles bornées ; bâtiments = genres du catalogue v0.4.

## Ce que voit le joueur
* Bâtiments : **école** (2×2), **collège** (3×3), **bibliothèque** (2×2), **musée** (3×3), **clinique** (1×1),
  **hôpital** (3×3), **prison** (3×3). Chacun a un coût, un entretien mensuel, un rayon de couverture et une
  **capacité** (élèves, patients, détenus).
* Deux grandeurs de la ville : **EQ** (0..=150) et **espérance de vie** (années, 40..=90). Elles changent lentement
  (chaque mois, vers la cible donnée par la couverture des quartiers résidentiels).
* Effets : un EQ élevé attire l'industrie propre (moins de pollution industrielle) et le commerce ; une bonne
  espérance de vie augmente l'attrait résidentiel ; la prison baisse la criminalité dans un grand rayon mais baisse
  la valeur du terrain autour d'elle.
* Couches de carte « Éducation » et « Santé » (couverture), panneau « Services publics », conseillers.

## Contrat (fixé avant les chantiers)
Interrupteur `Extensions::services` (bit libre suivant), sauvegardé ; EQ et espérance de vie sauvegardés (nouveau
morceau). Actif seulement si `structures` est aussi active. Fichier sans service et règle éteinte = identique.

* Catalogue : genres 30 école (2×2), 31 collège (3×3), 32 bibliothèque (2×2), 33 musée (3×3), 34 clinique (1×1),
  35 hôpital (3×3), 36 prison (3×3) ; électricité exigée pour tous.
* API wasm (`crates/micropolis-wasm/src/services.rs`) :

| Méthode | Retour |
|---|---|
| `service_rules()` / `set_service_rules(on)` | interrupteur |
| `service_stats()` | `Int32Array [eq, espérance_de_vie, élèves, places_scolaires, patients, places_soins, détenus, places_prison, couverture_éducation_pct, couverture_santé_pct]` |
| `coverage_layer(kind)` | `Uint8Array` une valeur par tuile (ordre `x * hauteur + y`) : couverture 0..=255 ; `kind` 0 éducation, 1 santé, 2 sécurité (prison) |

* Crochets : `ext_valves` (demande R/C/I selon EQ et espérance de vie, bornée), `ext_pollution` (moins de pollution
  industrielle avec un EQ élevé), `ext_crime` (prison), `ext_land_value` (prison), `ext_monthly_balance` (entretien).

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur des services** | Sonnet | `crates/micropolis-core/src/services.rs` (+ sous-modules), catalogue (genres 30-36), crochets, sauvegarde, `crates/micropolis-wasm/src/services.rs`, tests, section livrée |
| **Page** | Haiku | noms des genres 30-36, panneau « Services publics » (`web/services-ui.js`, `web/services-model.js`, `web/css/services.css`), conseillers (EQ bas → écoles ; espérance de vie basse → hôpitaux ; places saturées), faux moteur, tests |
| **Couches et 3D** | Haiku | `web/map-layer-coverage.js` (+ modèle : couches éducation, santé, sécurité choisies dans le panneau), formes 3D des genres 30-36 dans `web/view3d-structures-model.js`, tests |

## Critères d'acceptation
Comparaisons C++ identiques ; EQ et espérance de vie bornés et testés (montée, descente, cible) ; capacités et
couvertures testées ; effets sur la demande, la pollution, la criminalité et la valeur du terrain mesurés ; sauvegarde
aller-retour ; e2e : activer les services, poser une école, voir la couche éducation ; tous les tests verts ; relecture.
