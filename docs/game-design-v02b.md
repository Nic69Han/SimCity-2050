# Conception du jeu : jalon v0.2b « relié »

Suite du v0.2 (docs/game-design-v02.md). Mêmes règles : règles étendues désactivées par défaut, mode
classique identique au moteur C++, règles de code (docs/regles-de-code.md), développement par des agents
Sonnet, relecture et intégration par Opus.

## Chantiers (un agent chacun, fichiers propres)

| Chantier | Fichiers | Résultat |
|---|---|---|
| **Sous-sol en 3D** | `web/view3d-underground.js`, `web/view3d-underground-model.js`, enregistrement dans `web/view3d-layers.js` | Canalisations, pompes, tunnels et stations visibles en 3D ; bouton « Sous-sol » dans la barre de la vue 3D ; terrain translucide en vue souterraine |
| **Accords avec les voisins** | `crates/micropolis-core/src/deals.rs` (+ `extensions.rs` : champ et morceau 5 du bloc de sauvegarde), `crates/micropolis-wasm/src/deals.rs`, `web/deals-ui.js`, `web/css/deals.css` | Vendre de l'électricité et de l'eau excédentaires aux villes voisines contre une recette annuelle ; rupture et pénalité si la ville ne peut plus fournir |
| **Conseillers et sons** | `web/advisors-model.js`, `web/advisors.js`, `web/sound*.js`, petit point d'écoute dans `web/tools.js` | Les conseillers parlent de l'eau, du métro, des ordonnances et des accords ; son de construction réussie |

## Critères d'acceptation
* Comparaisons C++ identiques, tous les tests verts (Rust, page, wasm, e2e).
* Chaque nouveauté se voit, se sauvegarde quand elle a un état, et se teste (règle désactivée = moteur
  identique ; règle activée = effet mesuré ; boucles bornées).
* Relecture Opus de chaque livraison (diff lu, vérifications relancées) avant intégration.
