# Contribuer à SimCity 2050

Ce document explique comment le projet est découpé, quelles règles s'appliquent au code, comment un jalon est
organisé et quelles vérifications lancer avant de proposer un changement. Le plan des jalons est dans
`docs/plan-sc3000.md`, la conception de chaque jalon dans `docs/game-design-<jalon>.md`.

## 1. Organisation du dépôt

| Chemin | Rôle |
|---|---|
| `crates/micropolis-core` | le moteur : règles, carte, simulation, formats de fichiers, événements. Pur et déterministe : aucune dépendance, pas d'E/S, pas d'horloge, pas d'aléa hors du générateur `Rng`. |
| `crates/micropolis-wasm` | l'adaptateur WebAssembly (`wasm-bindgen`) : il convertit les types et expose les opérations du moteur à JavaScript. Aucune règle de jeu ici. |
| `web/` | la page : rendu 2D (canvas) et 3D (Three.js), saisie, panneaux, son, musique, traduction. Elle lit l'état exposé par l'adaptateur et le dessine ; elle ne décide rien de la simulation. |
| `web/test/` | tests `node:test` de la page (modèles purs, faux moteur, adaptateur wasm). |
| `web/e2e/` | tests de bout en bout dans Chromium (Playwright) sur le moteur wasm réel. |
| `scripts/` | construction (`build-web.sh`), tests (`test-wasm.sh`, `e2e.sh`) et comparaisons avec le moteur C++ (`compare-*.sh`). |
| `reference/` | le moteur C++ d'origine, utilisé comme oracle par les comparaisons. |
| `assets/` | données d'exemple (villes, scripts d'outils). |
| `docs/` | plan, conception des jalons, règles de code. |

Les dépendances vont vers l'intérieur : `web` → `micropolis-wasm` → `micropolis-core`. Le détail est dans
`ARCHITECTURE.md`.

## 2. Règles de code

Les règles complètes sont dans [`docs/regles-de-code.md`](docs/regles-de-code.md) ; elles complètent
`ARCHITECTURE.md`. Les plus souvent rappelées :

* **Une responsabilité par module.** Un fichier dépasse rarement 400 lignes ; au-delà, on le découpe.
* **Fonctions courtes et pures d'abord.** La logique (règles, calculs, choix) est testée seule ; le code qui
  touche au DOM, à WebGL ou au son reste une couche mince.
* **Ouvert à l'extension.** On branche une fonctionnalité sur un point d'extension (`features` de `web/main.js`,
  calques de la vue 3D, `web/extra-tools.js`) au lieu de modifier le cœur d'un autre module.
* **Toute boucle est bornée** par une constante nommée, et un test vérifie la borne.
* **Échouer tôt et clairement.** Une entrée invalide donne une erreur nommée ; on n'écrit jamais de `catch` vide.
* **Mode classique intact.** Toute règle nouvelle du moteur est désactivée par défaut ; les comparaisons avec le
  moteur C++ restent identiques.
* **Stockage du navigateur** (`localStorage`) : chaque accès est dans un `try/catch`, et la page fonctionne sans.

## 3. Comment un jalon est organisé

Un jalon (par exemple `v0.13` ou `v1.0`) suit la même méthode :

1. **Conception.** La relecture écrit `docs/game-design-<jalon>.md` : ce que voit le joueur, le **contrat**
   (interrupteurs, morceaux de sauvegarde, signatures des méthodes wasm, constantes, messages), la table des
   **chantiers** (qui fait quoi, quels fichiers), et les **critères d'acceptation**. Le contrat est fixé avant
   que les chantiers commencent.
2. **Chantiers.** Chaque chantier livre dans sa copie de travail, sur des fichiers listés. Le moteur et les
   concepts complexes (algorithmes de simulation, format de sauvegarde, performance, rendu 3D avancé) sont confiés
   à un développeur senior ; la page et les tâches petites et fermées à un développeur cadré. Une tâche qui
   exige un fichier hors de la liste s'arrête et le signale.
3. **Relecture.** La relecture lit le diff, relance les vérifications, refuse ou corrige, puis intègre. Rien
   n'arrive dans la branche principale sans cette relecture.
4. **Intégration.** Le jalon est fusionné seulement quand tous les tests sont verts. Le document de conception
   reçoit une section « Livré » qui dit ce qui a été fait et les choix retenus.

## 4. Vérifications à lancer

Depuis la racine du dépôt, avant de proposer un changement :

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
./scripts/test-wasm.sh                 # compile l'adaptateur wasm et lance web/test/wasm-*.test.mjs
node --test web/test/*.test.mjs        # tests de la page (Node 22 ou plus récent)
./scripts/compare-oracle.sh            # et les autres compare-*.sh : voir ci-dessous
./scripts/e2e.sh                       # navigateur réel, moteur wasm réel
```

* `test-wasm.sh` demande la cible `wasm32-unknown-unknown` et `wasm-bindgen-cli` (version 0.2.100).
* `compare-*.sh` comparent le moteur Rust au moteur C++ d'origine, ligne à ligne (empreintes par tour). Ils
  demandent l'oracle C++ compilé (`reference/`). Chaque script dit en en-tête ce qu'il compare : `compare-oracle`
  (villes et graines), `compare-tools` et `compare-budget` (actions du joueur), `compare-events` (messages et
  rappels), `compare-newcity` et `compare-newcity-tools` (nouvelle ville), `compare-saveload` (fichiers),
  `compare-bigmap` (tailles de carte).
* `e2e.sh` construit le paquet wasm et les villes d'exemple, sert `web/` en local, puis lance `web/e2e/*.test.mjs`.
  Le navigateur est celui de `E2E_CHROMIUM` s'il est défini, sinon celui que Playwright installe.

Le rapport d'une modification dit exactement ce qui a tourné et ce qui n'a pas pu tourner (outil absent, par
exemple), sans supposer le résultat.

## 5. Ajouter une règle étendue de bout en bout

Exemple : la règle « Autoroutes » du jalon v0.13. Chaque étape est un chantier distinct, dans l'ordre.

1. **Moteur (`crates/micropolis-core`).** Le code de la règle vit dans son propre module (`highways.rs` et son
   dossier `highways/` : `state`, `rules`, `effects`). L'interrupteur est un bit du second octet des règles
   (`RULES2_HIGHWAYS`, désactivé par défaut). Le hasard passe par `Rng` et seulement quand la règle est active.
   Les constantes sont publiques et nommées (`HIGHWAY_COST`, `MAX_HIGHWAY_TILES`…). Les crochets dans le moteur
   (circulation, valves, bilan mensuel) appellent la règle seulement si elle est active.
2. **Sauvegarde.** Les données de la règle vont dans un morceau numéroté du bloc d'extensions (`CHUNK_HIGHWAYS`) ;
   `CHUNK_MAX_TAG` est mis à jour. Règle éteinte et rien de stocké : le fichier est identique octet pour octet
   à celui du moteur d'origine. Un morceau invalide est refusé (`cty_bad_extension`).
3. **Adaptateur wasm (`crates/micropolis-wasm/src/highways.rs`).** Seulement la traduction : lecture et écriture
   de l'interrupteur, aperçu d'un outil (`highway_preview`), pose et retrait, couche (`highway_layer`), statistiques.
   Les méthodes sont documentées dans le tableau du contrat.
4. **Page (`web/`).** Un modèle pur (`web/highways-model.js`) ; le panneau (`web/disasters2-ui.js` pour le
   panneau « Catastrophes et autoroutes », à imiter), son style (`web/css/*.css`), la section dans `web/index.html`, et le module ajouté à `features` de
   `web/main.js` (`setup(api)` une fois, `update(api)` après chaque redessin). Le module vérifie que le moteur
   a les méthodes dont il a besoin et ne casse rien sinon. Les textes fixes de l'interface reçoivent un
   `data-i18n` et une clé dans `web/i18n-fr.js` et `web/i18n-en.js`.
5. **Outil et carte 2D.** L'outil est un module (`web/tools-highways.js`), enregistré dans `web/extra-tools.js` ; la
   couche 2D est `web/map-layer-highways.js` (+ modèle), enregistrée dans `web/map-layers.js`.
6. **Vue 3D.** Un module de calque (`web/view3d-highways.js` + modèle), branché dans `web/view3d-layers.js`. Les
   sprites des transports, par exemple, sont lus de l'adaptateur comme la 2D le fait.
7. **Tests.**
   * Rust : `crates/micropolis-core/tests/highways_rules.rs` (règle éteinte = moteur d'origine, chaque cas,
     plafonds) et `highways_save.rs` (aller-retour, morceaux refusés) ;
   * wasm : `web/test/wasm-highways.test.mjs` contre le paquet compilé ;
   * page : `web/test/highways-model.test.mjs`, `map-layer-highways.test.mjs`, et un faux moteur
     (`web/test/mock-highways.mjs`) ;
   * bout en bout : `web/e2e/*.test.mjs`, par exemple poser une autoroute et la voir dans la couche.
8. **Document.** La section « Livré » du document de conception reprend le contrat tel que réalisé, les
   constantes et les choix.

## 6. Limites connues (v1.0)

* Les **textes générés** restent en français : messages de la ville, noms des outils et des groupes de la
  palette, textes des panneaux construits par le code, sons et libellés du son. La traduction ne couvre que les
  textes fixes marqués dans `index.html`, et les libellés des boutons Lecture et Vue 3D.
* Un **nouveau texte fixe** doit avoir sa clé dans les deux dictionnaires ; le test `web/test/i18n-dict.test.mjs`
  échoue sinon.
* Le **zoom du mobile** est un zoom CSS de la carte 2D (`web/touch.js`) ; la vue 3D garde sa caméra.
