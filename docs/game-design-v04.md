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

## Cœur des bâtiments (chantier livré)
Livré dans `crates/micropolis-core/src/structures.rs` (catalogue, liste, codec, crochets) et
`structures/rules.rs` (règles sur `Simulation`), `crates/micropolis-wasm/src/structures.rs` (API du tableau ci-dessus,
à l'identique), tests `tests/structures_rules.rs`, `tests/structures_save.rs`, `web/test/wasm-structures.test.mjs`.

**Constantes (toutes nommées, dans `structures.rs`).** `MAX_STRUCTURES = 256`, `LAND_VALUE_CAP = 40`,
`SURFACE_BASE = 1019`, `SURFACE_BITS = BURNBIT | BULLBIT | CONDBIT`, `RECORD_SIZE = 5`.

| Genre | Taille | Coût | Entretien/mois | Besoins | Rayon | Bonus de valeur au pied |
|---|---|---|---|---|---|---|
| 1 parc urbain | 2×2 | 300 | 5 | aucun | 6 | 12 |
| 2 place publique | 1×1 | 100 | 2 | électricité | 4 | 6 |
| 3 monument | 3×3 | 2000 | 40 | électricité, eau | 12 | 30 |

**Tuile de surface inerte.** Chaque tuile d'une empreinte porte le caractère `1019 + genre - 1` (1019, 1020, 1021 :
caractères libres après la dernière église, `CHURCH7LAST = 1018`) avec les bits brûlable, bulldozable, conducteur. Ces
caractères sont hors de toute plage que le moteur teste (pas zone, route, rail, fil, feu, inondation ; les plages
2..=63 déclenchent du feu, de l'inondation ou de la radioactivité, d'où le choix du haut de la table). Conséquences,
testées : les zones n'y poussent pas ; tous les outils de construction classiques (zones, routes, fils, rails, parc,
centrales, stade, port, aéroport, réseau) répondent `NeedBulldoze` et ne changent rien ; le bulldozer retire une tuile
(1 $) ; un feu transforme une tuile en feu. Les outils eau/terre/forêt passent d'abord par le bulldozer.

**Cohérence liste/carte.** Un bâtiment est *intact* si toutes les tuiles de son empreinte portent sa tuile de surface.
`repair_structures` retire les bâtiments cassés de la liste et remet à terre nue leurs tuiles de surface restantes ;
elle tourne à chaque passage de `ext_valves`, à chaque pose/démolition et à chaque bilan mensuel, qui nettoie aussi
(parcours borné par la carte) les tuiles de surface qu'aucun bâtiment de la liste ne possède ; au chargement d'un
fichier avec bloc d'extensions, même nettoyage complet (règle éteinte : tout part). Les lecteurs (`structures()`,
entretien, bonus) ignorent tout de suite un bâtiment cassé, sans attendre la réparation.

**Pose.** Codes : `0` règle éteinte, genre inconnu, empreinte hors carte ou sur l'eau, `MAX_STRUCTURES` atteint ;
`-1` une tuile de l'empreinte n'est pas de la terre nue (arbres, gravats, route, autre bâtiment : pas d'auto-bulldozer) ;
`-2` pas assez d'argent ; `1` sinon. L'aperçu rend `[code, coût]` (coût 0 sauf si `1`). Démolition gratuite, depuis
n'importe quelle tuile ; éteindre la règle retire tout sans remboursement.

**Électricité.** Chaque tuile est conductrice (comme une zone, et comme elle compte pour une tuile de la capacité des
centrales). `état` bit 0 = une tuile de l'empreinte a le bit d'alimentation (mis par le balayage du réseau classique,
donc avec le retard habituel d'un cycle). **Eau.** `état` bit 1 = une tuile est couverte par le réseau de l'eau v0.2 ;
toujours 0 si la règle de l'eau est éteinte. Un besoin d'eau n'est exigé que si la règle de l'eau est active.

**Effet « valeur du terrain ».** Par le crochet `ext_land_value`, appelé en dernier de la chaîne : pour chaque
bâtiment intact dont les besoins sont satisfaits (alimenté s'il a besoin d'électricité, arrosé s'il a besoin d'eau et que
la règle de l'eau est active), `bonus × (rayon + 1 − d) / (rayon + 1)` avec `d` la distance de Manhattan du bloc à
l'empreinte, nul au-delà du rayon ; somme plafonnée à `LAND_VALUE_CAP`, puis le plafond habituel 1..=250. Entretien :
somme des entretiens des bâtiments intacts, prélevée dans `ext_monthly_balance`.

**Sauvegarde.** Bit 4 (`0b1_0000`) du morceau 1 = l'interrupteur ; morceau 6 (`CHUNK_STRUCTURES`, nouveau
`CHUNK_MAX_TAG`) = enregistrements de 5 octets `[genre u8, x u16, y u16]` (grand-boutiste), vide (donc absent) sans
bâtiment. Refusé (`cty_bad_extension`) : longueur non multiple de 5, plus de `MAX_STRUCTURES`, genre inconnu, empreinte
hors carte, chevauchement. Les tests « drapeau inconnu » utilisent désormais `0b10_0000`. Règle éteinte et aucun
bâtiment : fichier identique octet pour octet (test).

Le bulldozer classique (et les outils eau, terrain, forêt) retire le bâtiment entier : le crochet vit dans `do_tool`
(`tool.rs`), juste après `modify_world`, et appelle `repair_structures` si les extensions et la règle des structures sont
actives. Règle coupée, rien ne change (moteur classique identique).
