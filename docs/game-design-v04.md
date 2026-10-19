# Conception du jeu : jalon v0.4 « bâtiments étendus »

Premier jalon du plan docs/plan-sc3000.md. But : une **plateforme générique** de bâtiments que les jalons suivants
(bus, gares, déchets, écoles, hôpitaux, centrales, récompenses…) rempliront seulement en ajoutant des entrées au
catalogue et des effets. Règles du projet (docs/regles-de-code.md) : règle « Bâtiments étendus » désactivée par
défaut, moteur classique identique au C++, entiers, déterminisme, boucles bornées.

## Ce que voit le joueur
Un groupe d'outils « Bâtiments » : parc urbain (2×2), place publique (1×1), monument (3×3). On les pose sur un
terrain nu (sur la terre, hors eau), ils coûtent un prix de construction et un entretien mensuel, ils augmentent la
valeur du terrain autour d'eux ; le bulldozer les démolit. Ils sont dessinés en 2D (forme et couleur par genre) et
en 3D (volumes simples par genre). Ils sont sauvegardés.

## Contrat moteur ↔ page (fixé avant les chantiers)
Interrupteur `Extensions::structures` (« Bâtiments étendus »), désactivé par défaut, sauvegardé (bit libre suivant
du morceau 1 des règles, `0b1_0000`) ; les bâtiments posés sont sauvegardés dans un nouveau morceau du bloc
d'extensions (numéro 6). Un fichier sans bâtiment et règle éteinte reste identique octet pour octet.

API wasm (`crates/micropolis-wasm/src/structures.rs`) :

| Méthode | Retour |
|---|---|
| `structure_rules()` / `set_structure_rules(on)` | interrupteur ; l'éteindre retire tous les bâtiments posés sans remboursement |
| `structure_catalog()` | `Int32Array` d'enregistrements de 8 : `[genre, largeur, hauteur, coût, entretien_mensuel, drapeaux, rayon, effet]` ; `drapeaux` bit 0 = a besoin d'électricité, bit 1 = a besoin d'eau ; `effet` 0 aucun, 1 valeur du terrain |
| `structures()` | `Int32Array` d'enregistrements de 6 : `[genre, x, y, largeur, hauteur, état]` (x, y = coin haut-gauche ; `état` bit 0 = alimenté en électricité, bit 1 = en eau) |
| `structure_preview(genre, x, y)` | `Int32Array [code, coût]` avec les codes de résultat des outils (1 possible, 0 impossible, -1 à déblayer, -2 pas assez d'argent) |
| `place_structure(genre, x, y)` | code de résultat ; (x, y) = coin haut-gauche |
| `remove_structure(x, y)` | code de résultat ; (x, y) = n'importe quelle tuile du bâtiment |
| `structures_upkeep()` | entretien mensuel total en dollars |

Genres du jalon : 1 parc urbain (2×2), 2 place publique (1×1), 3 monument (3×3). Les noms français sont dans la
page (`web/structures-model.js`, propriété du chantier des outils) ; le moteur ne connaît que les nombres.

## Règles du moteur (chantier cœur, Sonnet)
* Catalogue en table constante ; plafond `MAX_STRUCTURES` (nommé, testé).
* Pose : toutes les tuiles de l'empreinte sur la carte, terre nue (pas d'eau, pas de bâtiment, pas de route) ;
  sinon refus. Les tuiles de surface de l'empreinte reçoivent une tuile classique inerte choisie et documentée par
  le cœur, telle que les outils classiques ne construisent pas dessus, que la croissance des zones l'ignore et que le
  bulldozer classique la retire (le bâtiment entier disparaît alors). Un feu ou une catastrophe qui détruit une
  tuile détruit le bâtiment. Toute incohérence entre la carte et la liste est réparée au chargement et à chaque
  passage mensuel (règle documentée).
* Électricité : un bâtiment qui en a besoin est conducteur comme une zone (le réseau classique l'alimente) ;
  `état` le reflète. Eau : relié au réseau de l'eau v0.2 si la règle de l'eau est active.
* Entretien : prélevé avec le bilan mensuel par le crochet existant (`ext_monthly_balance`).
* Effet « valeur du terrain » : bonus borné dans le rayon, par le crochet `ext_land_value`, cumul plafonné.
* Règle éteinte : aucune action, hooks inertes, comparaisons C++ identiques.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur des bâtiments** | Sonnet (senior) | `crates/micropolis-core/src/structures.rs` (+ sous-module si besoin), branchements dans `extensions.rs` (interrupteur, morceau 6, crochets), `crates/micropolis-wasm/src/structures.rs`, tests `crates/micropolis-core/tests/structures_*.rs`, `web/test/wasm-structures.test.mjs`, section livrée de ce document |
| **Outils de la page** | Haiku (cadré) | `web/tools-structures.js`, `web/structures-model.js`, `web/test/structures-tools.test.mjs`, faux moteur (`web/test/mock-engine.mjs` : ajout des méthodes seulement) |
| **Calque 2D** | Haiku (cadré) | `web/map-layer-structures.js` (+ `web/map-layer-structures-model.js`), `web/test/map-layer-structures.test.mjs` |
| **Calque 3D** | Haiku (cadré) | `web/view3d-structures.js` (+ `web/view3d-structures-model.js`), `web/test/view3d-structures*.test.mjs` |

Points d'extension posés par la relecture avant les chantiers : modules vides enregistrés dans `extra-tools.js`,
`map-layers.js` et `view3d-layers.js`.

## Critères d'acceptation
Comparaisons C++ identiques ; règle éteinte = moteur d'origine ; sauvegarde/chargement aller-retour ; fichier sans
bâtiment identique octet pour octet ; plafonds testés ; e2e : poser un parc, le voir en 2D et en 3D, le démolir ;
tous les tests verts ; relecture.
