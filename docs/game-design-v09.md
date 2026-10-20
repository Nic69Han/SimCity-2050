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

## Cœur des services (chantier livré)
Code : `crates/micropolis-core/src/services.rs` (constantes, catalogue des services, état sauvegardé),
`services/rules.rs` (interrupteur, passe mensuelle, statistiques, couches), `services/report.rs` (mesure de la
couverture), `services/effects.rs` (les quatre crochets), `crates/micropolis-wasm/src/services.rs` (adaptateur).
Deux fichiers hors de la liste initiale, modifiés et **acceptés par le lead** (une dizaine de lignes) :
`structures/rules.rs` (`place_structure` refuse les genres 30-36 règle éteinte ; `repair_structures` retire les
bâtiments de service orphelins via `is_orphan_service`) et `densities/rules.rs` (`zone_population` passe de privé
à `pub(crate)`). `place_structure` étant l'unique chemin de pose, la barrière ne peut pas être ailleurs.
Tests : `tests/services_rules.rs`, `tests/services_save.rs`, tests unitaires des modules, tests wasm (`web/test/wasm-services.test.mjs`, `crates/micropolis-wasm/src/services.rs`).

* **Interrupteur** : `Extensions::services` = bit 0 du **second octet** du morceau de règles (tag 1), qui devient
  facultatif : un morceau d'un octet se lit comme avant ; deux octets ne s'écrivent que si un bit du second est
  allumé (un second octet nul ou un bit inconnu du second octet, tout bit inconnu du premier : refusés). Les
  fichiers sans services restent identiques à l'octet près. EQ et espérance de vie : morceau **9** (2 octets),
  écrit seulement s'ils diffèrent des valeurs de départ. `CHUNK_MAX_TAG` = 9 (le tag 8 appartient à un autre jalon).
* **Actif** seulement si `structures` est aussi active ; les genres 30-36 ne se posent que règle allumée. Éteindre
  la règle retire les bâtiments de service (sans remboursement) et oublie EQ/espérance de vie.
* **Catalogue** (coût, entretien, rayon de couverture Manhattan depuis l'empreinte, capacité, poids) : école 2×2
  (500, 20, 8, 150, EQ 60), collège 3×3 (1500, 60, 14, 300, EQ 40), bibliothèque 2×2 (400, 15, 10, 200, EQ 30),
  musée 3×3 (1200, 40, 14, 250, EQ 20), clinique 1×1 (200, 10, 8, 80, +15 ans), hôpital 3×3 (1800, 70, 16, 400,
  +25 ans), prison 3×3 (2500, 80, 20, 100 détenus). Tous exigent l'électricité.
* **Couverture** : chaque zone résidentielle (habitants = population classique de la zone) est servie par le
  bâtiment de service **en marche** le plus proche de chaque genre dans son rayon (égalité : le plus ancien). La
  capacité est partagée : un bâtiment sert `min(affectés, capacité)`. Couverture d'un genre = part des habitants
  servis. Cible EQ = somme des poids × couverture (0..=150) ; cible d'espérance de vie = 50 + somme des poids de
  santé × couverture (50..=90).
* **Évolution** : une fois par mois (premier appel après chargement : mesure seule), EQ de ±3 au plus
  (`EQ_STEP`) et espérance de vie de ±1 an (`LIFE_STEP`) vers la cible ; bornes 0..=150 et 40..=90 ; départ 0 et 50.
* **Crochets** : `ext_valves` pousse la demande commerciale de `EQ/50` et résidentielle de `(vie-50)/10`, jamais
  au-delà de 500 (`VALVE_PUSH_CEILING`), jamais si le plafond stade/aéroport est atteint, sans toucher une valeur
  déjà plus haute ; `ext_pollution` : jusqu'à −30 % à EQ 150 (linéaire) ; `ext_crime` : chaque prison en marche
  retire jusqu'à 40 % (décroissance linéaire jusqu'à son rayon), 60 % au total, proportionnellement à la part de la
  demande (habitants × criminalité moyenne / 1000) qu'elle a de places ; `ext_land_value` : −25 au pied d'une prison
  (rayon 6), −40 au plus. `ext_monthly_balance` : rien d'ajouté, l'entretien est déjà celui des structures
  (somme de tous les bâtiments intacts), donc rien n'est compté deux fois (testé).
* **API wasm** : `service_rules`, `set_service_rules`, `service_stats` (10 valeurs : EQ, espérance de vie, élèves,
  places scolaires, patients, places de soins, détenus, places de prison, couverture éducation %, couverture santé %,
  les deux derniers étant la cible en part de sa plage), `coverage_layer(kind)` (0 éducation, 1 santé, 2 sécurité ;
  255 au pied du bâtiment, décroissance linéaire jusqu'au rayon, pondérée par la part des habitants servis).
  Tout à 0 tant que les services n'agissent pas.
* **Boucles bornées** : cartes (largeur × hauteur), `MAX_STRUCTURES` bâtiments, 7 genres, rayons constants.
  Aucun tirage aléatoire.
