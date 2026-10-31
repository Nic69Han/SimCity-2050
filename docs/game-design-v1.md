# Conception du jeu : jalon v1.0 « finition »

Dernier jalon du plan docs/plan-sc3000.md : le jeu complet. Toutes les fonctionnalités de SimCity 3000 sont dans le
moteur (v0.2 à v0.13) et dans la vue 3D (v0.14) ; v1.0 ajoute ce qui fait un jeu fini : des **défis**, de la
**musique**, le jeu sur **mobile**, l'**accessibilité**, une **traduction anglaise**, le **partage d'une ville par un
lien** et la **documentation de contribution**. Jalon de la page seulement : aucun changement du moteur ni du format
de sauvegarde ; comparaisons C++ inchangées.

## Ce que voit le joueur
* **Défis** (à la place des scénarios du jeu d'origine, dont les fichiers ne sont pas dans le dépôt) : un menu
  « Défis » propose des objectifs datés sur une ville d'exemple ou une nouvelle ville : « 50 000 habitants avant
  1960 », « Trésorerie positive pendant 20 ans », « Pollution moyenne sous 30 », « Toutes les récompenses
  débloquées », « Aucun bâtiment sans électricité », etc. (au moins 6). Un défi se gagne ou se perd ; le
  résultat est annoncé et gardé (meilleurs résultats dans `localStorage`, avec repli sans stockage).
* **Musique** : une musique d'ambiance générée dans le navigateur (Web Audio, sans fichier, accords lents et
  doux), qui suit l'heure du jour de la vue 3D quand elle est visible ; bouton « Musique » (coupée par défaut), volume.
* **Mobile** : la carte 2D se déplace au doigt (glisser), se zoome à deux doigts, un appui pose l'outil ; la page
  se range en une colonne sous 700 px (panneaux repliés sous la carte, palette en bandeau défilant).
* **Accessibilité** : la carte se parcourt au clavier (flèches : curseur de tuile, Entrée : appliquer l'outil,
  annonce de la tuile pour les lecteurs d'écran), tous les panneaux ont des titres et des rôles, contraste suffisant,
  respect de `prefers-reduced-motion` (pas d'animation de l'eau ni du cycle jour/nuit).
* **Traduction** : un sélecteur « Langue : Français / English » traduit l'interface fixe (en-tête, palette,
  titres des panneaux, boutons, menus) ; les textes générés restent en français dans ce jalon (limite documentée).
* **Partager** : « Partager la ville » produit un lien qui contient la ville (sauvegarde compressée dans l'ancre de
  l'adresse) ; ouvrir ce lien charge la ville. Taille bornée (`MAX_SHARE_BYTES`), refus clair au-delà.
* **Contribuer** : `CONTRIBUTING.md` (règles de code, organisation des jalons et des chantiers, vérifications,
  comment ajouter une règle étendue de bout en bout).

## Contrat (fixé avant les chantiers)
* Défis : module pur `web/challenges-model.js` : une table de défis `{ id, title, start: { sample | seed },
  goal(snapshot) -> "won" | "lost" | "running", deadline }` ; `snapshot` lu du moteur par des méthodes existantes
  (population, date, fonds, évaluation, statistiques des règles étendues quand elles existent). Évaluation une fois
  par mois de jeu, bornée.
* Partage : `web/share-model.js` encode la sauvegarde (`City.save_cty()` ou la méthode de sauvegarde existante, voir
  `web/saves.js`) avec `CompressionStream("deflate-raw")` puis base64url dans `#ville=` ; décodage symétrique ;
  `MAX_SHARE_BYTES` = 60 000 octets compressés ; toute erreur → message et ville inchangée.
* Traduction : `web/i18n.js` (+ `web/i18n-en.js`) : `t(key)` et `applyLanguage(root)` sur des éléments marqués
  `data-i18n` ; langue gardée dans `localStorage` ; `lang` du document mis à jour.
* Musique : `web/music-model.js` (pur : suite d'accords, durées, enveloppes, choix selon l'heure) et
  `web/music.js` (Web Audio, créé seulement après un geste du joueur).
* Mobile et clavier : `web/touch.js` (+ modèle pur des gestes), `web/keyboard-map.js` (+ modèle pur du curseur),
  CSS `@media (max-width: 700px)`.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Défis et partage** | Sonnet | `web/challenges-model.js`, `web/challenges-ui.js`, `web/css/challenges.css`, `web/share-model.js`, `web/share-ui.js`, panneaux dans `web/index.html` et `web/main.js` (features), tests |
| **Musique et accessibilité** | Haiku | `web/music-model.js`, `web/music.js`, `web/keyboard-map.js` (+ modèle), réglages `prefers-reduced-motion` (couches d'ambiance), tests |
| **Mobile, traduction, contribution** | Haiku | `web/touch.js` (+ modèle), CSS mobile, `web/i18n.js`, `web/i18n-en.js`, attributs `data-i18n` dans `web/index.html`, `CONTRIBUTING.md`, tests |

## Critères d'acceptation
Comparaisons C++ inchangées ; chaque défi testé (gagné, perdu, en cours) ; partage aller-retour testé (ville
identique, refus au-delà de la taille) ; gestes et curseur clavier testés (modèles purs) ; traduction testée (toutes
les clés présentes dans les deux langues) ; musique testée (modèle pur, rien avant un geste) ; e2e : gagner un défi
simple, partager puis rouvrir une ville, passer en anglais, parcourir la carte au clavier ; tous les tests verts ;
relecture.

## Livré (intégration)
* **Défis et partage** (Sonnet) : `web/challenges-model.js` (8 défis décrits par des données : conditions
  `{ metric, op, target }`, genre « atteindre » ou « tenir », échéance en années ; **écart au contrat** : pas de
  fonction `goal()`, pour afficher l'objectif en texte et tester chaque défi), `web/challenges-ui.js` (démarrage par
  les chemins de la page, évaluation une fois par mois de jeu, meilleurs résultats gardés) ; `web/share-model.js` et
  `web/share-ui.js` (lien `#ville=` : deflate-raw + base64url des octets de la sauvegarde, 60 000 octets compressés au
  plus, garde contre les décompressions géantes, erreurs en français, ville inchangée). Limite : certains objectifs
  (pollution, satisfaction, récompenses) sont des estimations à ajuster en jouant.
* **Musique et accessibilité** (Haiku) : `web/music-model.js` + `web/music.js` (accords lents, rien avant un geste,
  arrêt qui ferme le contexte audio ; limite : toujours les accords du jour, la page n'expose pas la lumière de la
  vue 3D) ; `web/keyboard-map-model.js` + `web/keyboard-map.js` (curseur au clavier, Maj + flèche par 8 tuiles,
  Entrée = clic, annonce polie) ; `prefers-reduced-motion` fige le jour et l'eau.
* **Mobile, traduction, contribution** (Haiku) : `web/touch-model.js` + `web/touch.js` (zoom à deux doigts et
  déplacement par transformation CSS de la carte 2D, qui n'avait ni zoom ni déplacement) ; `web/css/mobile.css`
  (une colonne sous 700 px, panneaux repliables d'un appui sur leur titre ; **écart au contrat**, décidé à l'intégration :
  les panneaux restent ouverts par défaut, pour que les conseils urgents restent visibles, et la palette garde ses
  lignes, tous les outils restant à l'écran, ses groupes repliables (v0.14) la raccourcissant) ; `web/i18n.js` +
  dictionnaires français et anglais (interface fixe ; limite : noms des outils et textes générés restent en
  français) ; `CONTRIBUTING.md`.
* e2e : `web/e2e/challenges.test.mjs`, `web/e2e/share.test.mjs`, `web/e2e/finish.test.mjs` (anglais, clavier).
