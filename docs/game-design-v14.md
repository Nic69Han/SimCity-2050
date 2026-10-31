# Conception du jeu : jalon v0.14 « rendu 3D final »

Onzième jalon du plan docs/plan-sc3000.md. La vue 3D montre enfin toute la ville comme SimCity 3000 : des bâtiments
dont l'aspect suit la **valeur du terrain** et la **densité de zonage**, une vraie **nuit** (fenêtres allumées,
réverbères le long des routes, bâtiments étendus éclairés), et une **vue fluide** sur les grandes cartes et les
appareils modestes. Jalon de la page seulement : aucun changement du moteur ni de la sauvegarde (le moteur expose
déjà la valeur du terrain par `overlay(1)` et les densités par `density_layer()`).

## Ce que voit le joueur
* **Variantes par valeur du terrain** : dans un même niveau de densité, un quartier modeste prend les modèles les
  plus simples, un quartier aisé les plus soignés (ordre fixe des variantes du catalogue, du plus simple au plus
  soigné). Le hasard d'aujourd'hui (hachage de la tuile) ne départage plus que les égalités.
* **Densités en 3D** : avec la règle des densités (v0.7), une zone légère ne montre jamais de tour, une zone moyenne
  jamais de gratte-ciel ; les fermes gardent leurs champs (v0.7).
* **Nuit** : quand `scene.userData.daylight` (écrit par la couche d'ambiance) descend, les fenêtres des bâtiments
  s'allument (petites plaques émissives jaunes sur les volumes, plus nombreuses dans les zones denses), des
  réverbères brillent le long des routes (un toutes les `LAMP_SPACING` tuiles de route) et les bâtiments étendus ont
  leurs fenêtres allumées. Intensité = `1 - daylight`, rien en plein jour.
* **Fluidité** : la vue mesure la durée de ses images et baisse la résolution de rendu (rapport de pixels, de
  `PIXEL_RATIO_MAX` à `PIXEL_RATIO_MIN` par pas de `PIXEL_RATIO_STEP`) quand elle dépasse `FRAME_BUDGET_MS`, puis la
  remonte quand elle a de la marge (hystérésis, au plus un changement par `ADAPT_INTERVAL_MS`). Une case « Qualité
  automatique » (cochée par défaut) la coupe.
* **Palette compacte** : les groupes d'outils de la palette se replient (un titre cliquable par groupe, le groupe de
  l'outil choisi reste ouvert, l'état est gardé dans `localStorage` avec repli sans stockage) ; la palette ne pousse
  plus la carte hors de l'écran.

## Contrat (fixé avant les chantiers)
* Valeur du terrain par tuile : `overlay(1)` avec `overlay_layout(1)` = `[bloc, colonnes, lignes]` (ordre colonne par
  colonne) ; palier modeste `< LV_MID` (= 60), moyen `< LV_HIGH` (= 120), aisé sinon (mêmes seuils que v0.11).
* Densité : `density_layer()` (v0.7) quand `density_rules()` est vraie : 1 légère → niveau maximal 0, 2 moyenne →
  niveau maximal 1, 3 dense ou absent → pas de plafond.
* Nuit : chaque couche lit `ctx.scene.userData.daylight` (0..1, absent = 1) dans `frame()` ; aucune lumière
  dynamique ajoutée (matériaux émissifs et instances seulement), capacités nommées, rien de dessiné au-delà.
* Performance : un module pur décide du rapport de pixels à partir des durées d'image (fenêtre glissante bornée),
  la couche l'applique par `ctx.renderer.setPixelRatio` ; crochet de test `canvas.perfStats()` →
  `{ pixelRatio, frameMs, auto }`.
* Tout reste déterministe et testé avec `node:test` (parties pures) ; les e2e existants restent verts.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Modèles** | Sonnet | `web/view3d-models-model.js` et `web/view3d-models.js` (variantes par valeur du terrain, plafond par densité, mise à jour quand la valeur du terrain ou les densités changent), tests |
| **Nuit** | Haiku | nouvelle couche `web/view3d-night.js` (+ `web/view3d-night-model.js` : fenêtres des volumes et des bâtiments étendus, réverbères des routes), enregistrée dans `web/view3d-layers.js`, tests |
| **Fluidité et palette** | Haiku | nouvelle couche `web/view3d-perf.js` (+ `web/view3d-perf-model.js`, case « Qualité automatique »), enregistrée dans `web/view3d-layers.js` ; palette repliable (`web/tools.js` ou un module `web/palette-groups.js` + modèle, `web/css/` de la palette), tests |

## Critères d'acceptation
Comparaisons C++ inchangées (aucun fichier du moteur touché) ; choix des modèles testé (paliers, plafonds, égalités),
nuit testée (intensité, nombre de fenêtres et de réverbères, capacités), adaptation de la résolution testée
(hystérésis, bornes, intervalle) ; e2e : la vue 3D de nuit allume des fenêtres (`canvas.nightStats()`), la palette se
replie ; tous les tests verts ; relecture.

## Livré (intégration)
* **Modèles** (Sonnet) : `web/view3d-models-landvalue.js` (paliers de valeur du terrain lus dans `overlay(1)`,
  plafonds de densité, clé par morceau) ; `chooseModel(catalog, v, facing, site)` prend un tiers de la liste des
  variantes selon le palier (le hachage ne départage plus qu'à l'intérieur), plafonne le niveau selon la densité ; la
  couche redessine les morceaux dont la clé change. L'ordre des variantes du catalogue suit l'ordre des lettres des
  kits Kenney (du plus simple au plus soigné), à revoir par un œil d'artiste.
* **Nuit** (Haiku) : `web/view3d-night.js` + modèle : fenêtres des volumes (selon la hauteur), fenêtres des bâtiments
  étendus alimentés, réverbères toutes les `LAMP_SPACING` tuiles de route (dans l'ordre des tuiles, pas le long des
  routes : limite connue), intensité `1 - daylight` ; crochet `canvas.nightStats()`.
* **Fluidité** (Haiku) : `web/view3d-perf.js` + modèle (fenêtre glissante, hystérésis, bornes) ; case « Auto »
  (nom complet « Qualité automatique » en info-bulle et nom accessible, pour garder la bande de la caméra étroite sur
  un téléphone). **Écart au contrat** : la couche fait partie des couches lourdes, absente de la vue simple
  (`?lite=1`) ; changer la résolution sur un rendu logiciel lent bloquait la vue simple, qui sert aux appareils
  modestes et aux tests.
* **Palette** (Haiku) : `web/palette-groups.js` + modèle ; titres de groupes repliables, groupe de l'outil choisi
  ouvert et non repliable, état gardé dans `localStorage` (repli sans stockage), tout ouvert par défaut.
* e2e : `web/e2e/render-final.test.mjs`.
