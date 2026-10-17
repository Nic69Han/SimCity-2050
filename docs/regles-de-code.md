# Règles de code

S'ajoutent à ARCHITECTURE.md. Elles s'appliquent à tout le code, humain ou agent. Une PR qui ne les respecte pas
est refusée à la relecture.

## Simplicité (SOLID appliqué sans cérémonie)
1. **Une responsabilité par module** : un fichier = un rôle (`advisors.js` produit des conseils, il ne dessine
   pas de 3D). Un fichier qui dépasse ~400 lignes se découpe.
2. **Fonctions courtes et pures d'abord** : la logique (règles, calculs, choix) est dans des fonctions pures,
   testées seules ; le code qui touche au DOM, à WebGL ou au son est une couche mince autour.
3. **Ouvert à l'extension, fermé à la modification** : on ajoute une fonctionnalité en branchant un module sur un
   point d'extension existant (`features` de `main.js`, calques de la vue 3D `view3d-layers.js`), pas en modifiant
   le cœur d'un autre module.
4. **Dépendre des interfaces, pas des détails** : un module reçoit ce dont il a besoin (`api`, `ctx`) au lieu de
   l'aller chercher dans une variable globale. Pas d'état global mutable hors du module qui le possède.
5. **Pas de code mort, pas d'abstraction spéculative** : on écrit ce qui sert maintenant.

## Sûreté
6. **Toute boucle est bornée** : chaque `while`/`loop` a une borne explicite (compteur maximal, taille de la
   donnée). Une cascade, une propagation ou une recherche de chemin a un plafond d'itérations nommé (constante)
   et un test qui le vérifie. Pas de récursion sans profondeur maximale.
7. **Pas de boucle d'animation sans fin propre** : une boucle `requestAnimationFrame` s'arrête au `dispose()` et
   ne tourne que si un calque animé l'a demandé ; le pas de temps est borné (pas de rattrapage infini).
8. **Échouer tôt et clairement** : entrée invalide → erreur nommée (code d'erreur stable côté moteur) ; jamais de
   `catch` vide qui masque un bug.
9. **Déterminisme du moteur** : pas d'horloge, pas d'aléa hors du générateur prévu, pas d'entrée-sortie dans
   `micropolis-core` (test `architecture.rs`).
10. **Mode classique intact** : toute règle nouvelle du moteur est derrière un réglage désactivé par défaut ;
    les comparaisons avec le moteur C++ restent identiques.

## Tests et relecture
11. Chaque changement arrive avec ses tests (unitaires pour la logique pure, e2e pour le parcours joueur).
12. Avant de rendre son travail : `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`,
    `node --test web/test/*.test.mjs`, et selon le cas `./scripts/test-wasm.sh`, `./scripts/e2e.sh`, les
    scripts `compare-*.sh`. Le rapport dit exactement ce qui a tourné et ce qui n'a pas pu tourner.
13. **Organisation** : les agents de développement (Sonnet, Haiku) livrent dans leur copie de travail ; la
    relecture (Opus) lit le diff, relance les vérifications, refuse ou corrige, puis intègre. Rien n'arrive dans
    `main` sans cette relecture.
