# Conception du jeu : jalon v0.13 « catastrophes et grands transports »

Dixième jalon du plan docs/plan-sc3000.md. Comme SimCity 3000 : de nouvelles **catastrophes** (émeutes, OVNI,
météorite, sécheresse), des **autoroutes** posées sur les routes pour désengorger la circulation, et un **port et un
aéroport animés** aussi en 3D (avions, hélicoptères, bateaux, trains et monstres du moteur classique). Règles
désactivées par défaut ; moteur classique identique au C++ ; entiers, déterminisme, boucles bornées.

## Ce que voit le joueur
* **Catastrophes SC3000** (règle « Catastrophes étendues ») : une **émeute** éclate dans un quartier où la
  criminalité est haute et la satisfaction basse (feux dans les zones voisines, circulation bloquée) ; un **OVNI**
  traverse la ville en détruisant une bande de tuiles ; une **météorite** tombe (cratère et incendie) ; une
  **sécheresse** freine la croissance résidentielle et, avec le réseau d'eau, divise par deux le débit des pompes
  pendant un an. Elles arrivent au hasard (seulement si les catastrophes sont permises) ou à la demande du joueur
  (menu « Déclencher »), et un message les annonce.
* **Autoroutes** (règle « Autoroutes ») : un outil trace une autoroute **sur des routes existantes** (glisser) ;
  elle coûte plus cher qu'une route, divise par deux la circulation de ses tuiles et les voitures simulées (v0.3) y
  vont deux fois plus vite. Couche 2D et tablier surélevé en 3D.
* **Transports animés en 3D** : les sprites du moteur classique (avions et hélicoptères au-dessus de l'aéroport,
  bateaux du port, trains, monstre, tornade) sont dessinés dans la vue 3D, comme ils le sont déjà en 2D.

## Contrat (fixé avant les chantiers)
Deux interrupteurs : `Extensions::disasters2` = bit 4 et `Extensions::highways` = bit 5 du **second octet** des
règles (`RULES2_DISASTERS`, `RULES2_HIGHWAYS`), sauvegardés. Morceau **13** (`CHUNK_HIGHWAYS`) : nombre de tuiles
d'autoroute (2 octets) puis x, y (2+2) par tuile, triées, sans doublon ; morceau **14** (`CHUNK_DISASTERS`) : mois
restants de sécheresse (2 octets), écrit seulement s'il n'est pas nul ; `CHUNK_MAX_TAG` = 14. Règles éteintes et
rien de stocké : fichier identique octet pour octet, moteur identique au C++.

* **Hasard** : les catastrophes étendues tirent leurs nombres du générateur du moteur seulement quand la règle est
  allumée **et** que les catastrophes sont permises (`enable_disasters`) ; une chance par an et par type, en pour
  mille (`RIOT_CHANCE` = 200 si les conditions sont réunies, `UFO_CHANCE` = 20, `METEOR_CHANCE` = 30,
  `DROUGHT_CHANCE` = 50), tirée au bilan annuel (`ext_monthly_balance`).
* **Émeute** : condition : criminalité moyenne ≥ `RIOT_CRIME_MIN` (= 120) et satisfaction (`city_yes`) <
  `RIOT_APPROVAL_MAX` (= 40). Centre = la zone résidentielle au bloc de criminalité le plus haut (égalité : plus
  petit x, puis plus petit y) ; `RIOT_FIRES` (= 6) feux classiques (`do_fire`) sur des tuiles brûlables à moins de
  `RIOT_RADIUS` (= 6), choisies par le générateur ; message.
* **OVNI** : une bande de `UFO_LENGTH` (= 20) tuiles en ligne droite (direction tirée parmi 4) depuis une tuile tirée
  au hasard ; chaque tuile non-eau devient des ruines (comme le monstre) ; message avec la position.
* **Météorite** : cratère 3×3 de ruines autour d'une tuile tirée, plus un feu classique au centre ; message.
* **Sécheresse** : `DROUGHT_MONTHS` (= 12) ; pendant ce temps la valve résidentielle reçoit `-DROUGHT_VALVE`
  (= 150) à chaque calcul et, avec la règle de l'eau, la capacité des pompes est divisée par deux.
* **Autoroutes** : une tuile d'autoroute est posée sur une route classique (pas un pont, pas un carrefour avec le
  rail) ; coût `HIGHWAY_COST` (= 25 $) par tuile ; démolir la route (bulldozer, feu, catastrophe) retire la tuile
  d'autoroute (réparation au passage des valves) ; plafond `MAX_HIGHWAY_TILES` (= 4096). `ext_traffic` divise par
  `HIGHWAY_TRAFFIC_DIV` (= 2) la densité des tuiles d'autoroute ; les voitures simulées avancent de
  `HIGHWAY_SPEED_MUL` (= 2) fois leur vitesse sur ces tuiles (agents v0.3, sans casser la conservation).
* API wasm (`crates/micropolis-wasm/src/disasters2.rs` et `highways.rs`) :

| Méthode | Retour |
|---|---|
| `disaster2_rules()` / `set_disaster2_rules(on)` | interrupteur |
| `trigger_disaster(kind)` | code : 1 fait, 0 règle éteinte, -1 impossible (émeute sans zone résidentielle…) ; `kind` 1 émeute, 2 OVNI, 3 météorite, 4 sécheresse ; à la demande, sans tirage pour le choix du type, ni condition de criminalité pour l'émeute |
| `disaster2_stats()` | `Int32Array [mois_de_sécheresse_restants, dernière_catastrophe (0..4), x, y]` (position -1 si aucune) |
| `highway_rules()` / `set_highway_rules(on)` | interrupteur ; l'éteindre retire toutes les autoroutes sans remboursement |
| `highway_preview(x, y)` | `Int32Array [code, coût]` (codes des outils) |
| `place_highway(x, y)` / `remove_highway(x, y)` | code de résultat |
| `highway_layer()` | `Uint8Array` une valeur par tuile (ordre `x * hauteur + y`) : 1 autoroute, 0 sinon |
| `highway_stats()` | `Int32Array [tuiles, entretien_annuel]` |

* Entretien des autoroutes : `HIGHWAY_UPKEEP` (= 1 $) par tuile et par an, au bilan.
* Sprites en 3D : aucune API nouvelle ; la page lit `sprites()` (déjà utilisé par la 2D, `web/sprites-art.js`).

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur** | Sonnet | `crates/micropolis-core/src/disasters2.rs` (+ sous-modules), `crates/micropolis-core/src/highways.rs` (+ sous-modules), crochets (`ext_traffic`, `ext_valves`, `ext_monthly_balance`, pompes, agents), sauvegarde, `crates/micropolis-wasm/src/disasters2.rs` et `highways.rs`, tests, `web/test/wasm-disasters2.test.mjs`, `web/test/wasm-highways.test.mjs`, section livrée |
| **Page** | Haiku | panneau « Catastrophes et autoroutes » (`web/disasters2-ui.js`, `web/disasters2-model.js`, `web/css/disasters2.css` : deux interrupteurs, boutons « Déclencher », état de la sécheresse) ; outil autoroute (`web/tools-highways.js` + modèle, enregistré dans `web/extra-tools.js`) ; couche 2D `web/map-layer-highways.js` (+ modèle) ; faux moteur, tests |
| **3D** | Haiku | `web/view3d-highways.js` (+ modèle : tablier surélevé sur les tuiles d'autoroute) et `web/view3d-sprites.js` (+ modèle : avions, hélicoptères, bateaux, trains, monstre, tornade en volumes simples, à partir de `sprites()`), branchés dans `web/view3d-layers.js`, tests |

## Critères d'acceptation
Comparaisons C++ identiques ; règles éteintes = moteur d'origine ; chaque catastrophe testée (à la demande et au
hasard, déterministe à graine égale), sécheresse bornée ; autoroutes (pose, coût, refus, réparation, trafic divisé,
voitures plus rapides, conservation des voyageurs) testées ; sauvegarde aller-retour ; e2e : poser une autoroute et
la voir dans la couche, déclencher une météorite ; tous les tests verts ; relecture.
