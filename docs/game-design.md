# Conception du jeu : jalon v0.1 « beau et clair »

But du jalon : qu'une personne qui ouvre le site ait l'impression de jouer à un vrai jeu de gestion de ville
dans l'esprit de SimCity 3000, sans changer les règles du moteur. Suite : v0.2 « profond » (eau, ordonnances,
voisins, transports en commun), v0.3 « vivant » (agents : docs/ia-simulation.md), v1.0 (docs/roadmap.md).

## Expérience visée
* On arrive sur une ville en 3D, en lumière de fin de journée, avec de vrais bâtiments, de l'eau qui bouge.
* On sait quoi faire : un tutoriel court guide les premières constructions ; des conseillers expliquent
  les problèmes de la ville en une phrase et proposent une action.
* La ville répond : sons d'interface et de construction, messages lisibles, alternance jour/nuit.

## Contenu du jalon (un chantier = un module = un agent)

| Chantier | Module(s) | Point d'extension | Résultat attendu |
|---|---|---|---|
| Modèles 3D | `web/view3d-models.js`, `web/models/` | calque de la vue 3D | Bâtiments Kenney (CC0) selon la zone et la densité, arbres ; volumes procéduraux en repli |
| Ambiance | `web/view3d-ambiance.js` | calque de la vue 3D | Cycle jour/nuit (lumières, ciel, fenêtres éclairées la nuit), eau animée |
| Caméra | `web/view3d-camera.js` | calque de la vue 3D | Rotation par quart de tour, niveaux de zoom, recentrage, boutons et raccourcis |
| Conseillers | `web/advisors.js` | `features` de `main.js` | 4 conseillers (finances, sécurité, urbanisme, environnement) : diagnostic + action conseillée |
| Tutoriel | `web/tutorial.js` | `features` de `main.js` | 6 à 8 étapes vérifiées sur l'état réel de la ville, reprise possible, désactivable |
| Sons | `web/sound.js`, `web/sounds/` | `features` de `main.js` | Sons CC0 sur les actions et les événements du moteur ; coupé par défaut jusqu'au premier geste, bouton muet |

Hors jalon : aucune règle de simulation nouvelle (le moteur n'est pas modifié dans v0.1).

## Points d'extension (posés par la relecture avant les chantiers)
* **Calques 3D** (`web/view3d-layers.js`) : chaque calque exporte `createLayer()` qui renvoie un objet aux
  méthodes facultatives `mount(ctx)`, `update(ctx, change)`, `frame(ctx, secondes)`, `dispose(ctx)`.
  `ctx` donne la scène, la caméra, les contrôles, les lumières, la grille, les volumes par bloc et
  `requestRender()`. Un calque qui définit `frame` démarre la boucle d'animation ; elle s'arrête au `dispose`.
* **Fonctionnalités de page** (`features` dans `main.js`) : chaque module exporte `setup(api)` et `update(api)`.
  Chaque fonctionnalité a son conteneur dans `index.html` et sa feuille de style `web/css/<nom>.css`.

## Ressources
Kenney (kenney.nl) : licence CC0 vérifiée sur la page de chaque pack au moment de l'import. Sources et
licences listées dans `docs/credits.md`. Budget de poids : ≤ 3 Mo de modèles, ≤ 1 Mo de sons, chargés seulement
quand la vue 3D ou le son est activé.

## Critères d'acceptation du jalon
* Tous les tests passent (Rust, page, wasm, e2e) ; comparaisons C++ identiques (moteur inchangé).
* Le site reste utilisable sans la 3D et sans le son (repli 2D, chargement à la demande).
* Aucune erreur en console ; pas de baisse sensible de fluidité sur la carte 120×100.
* Relecture Opus de chaque chantier (diff lu, vérifications relancées) avant intégration.
