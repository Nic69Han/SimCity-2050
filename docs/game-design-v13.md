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

## Livré : cœur (moteur et adaptateur wasm)
Chantier **Cœur** terminé : `crates/micropolis-core/src/disasters2.rs` (+ `disasters2/` : `riot`, `ufo`, `meteor`,
`drought`, `rules`, `state`), `highways.rs` (+ `highways/` : `state`, `rules`, `effects`), les crochets, la
sauvegarde, `crates/micropolis-wasm/src/disasters2.rs` et `highways.rs`, les tests Rust
(`tests/disasters2_rules.rs`, `disasters2_save.rs`, `highways_rules.rs`, `highways_save.rs`) et
`web/test/wasm-disasters2.test.mjs`, `wasm-highways.test.mjs`. Le contrat ci-dessus est suivi à la lettre ; les
précisions et choix sont ici.

### Constantes (toutes publiques dans `micropolis_core::disasters2` / `highways`)
| Constante | Valeur | Rôle |
|---|---|---|
| `RIOT_CHANCE`, `UFO_CHANCE`, `METEOR_CHANCE`, `DROUGHT_CHANCE` | 200, 20, 30, 50 | chance annuelle, pour mille (`random(999) < chance`) |
| `RIOT_CRIME_MIN`, `RIOT_APPROVAL_MAX` | 120, 40 | condition de l'émeute au hasard (`crime_average` ≥, `city_yes` <) |
| `RIOT_FIRES`, `RIOT_RADIUS`, `RIOT_TRIES_PER_FIRE` | 6, 6, 8 | feux, rayon (carré), essais par feu (au plus 48 tirages de position) |
| `UFO_LENGTH` | 20 | tuiles de la bande |
| `DROUGHT_MONTHS`, `DROUGHT_VALVE`, `DROUGHT_PUMP_DIV`, `MONTHS_PER_PASS` | 12, 150, 2, 12 | sécheresse |
| `HIGHWAY_COST`, `HIGHWAY_UPKEEP`, `MAX_HIGHWAY_TILES` | 25, 1, 4096 | autoroutes |
| `HIGHWAY_TRAFFIC_DIV`, `HIGHWAY_SPEED_MUL` | 2, 2 | circulation divisée, vitesse des voitures multipliée |
| `CHUNK_HIGHWAYS`, `CHUNK_DISASTERS`, `CHUNK_MAX_TAG` | 13, 14, 14 | morceaux de sauvegarde |

### Numéros de messages (`send_message`)
Définis dans `disasters2.rs` (pas dans `message.rs`, dont chaque constante doit avoir son texte français côté page) :
émeute = **44** (`MESSAGE_RIOTS_REPORTED`, message classique, texte déjà présent), OVNI = **59** (`MESSAGE_UFO`),
météorite = **60** (`MESSAGE_METEOR`), sécheresse = **61** (`MESSAGE_DROUGHT`, sans position). Position `(x, y)` :
centre de l'émeute, départ de l'OVNI, centre du cratère. La page doit ajouter les textes 59, 60 et 61 à
`web/messages-text.js`.

### Choix de conception
* **Hasard.** `ext_monthly_balance` appelle, règle allumée seulement, `disasters2::monthly_balance` : la sécheresse en
  cours perd `MONTHS_PER_PASS` mois, puis, si `enable_disasters`, un tirage par type dans l'ordre émeute (seulement si la
  condition tient), OVNI, météorite, sécheresse (seulement s'il n'y en a pas en cours). Règle éteinte, ou catastrophes non
  permises : aucun tirage (testé : même suite du générateur que le moteur classique).
* **Passage annuel.** Un passage de `ext_monthly_balance` = un an = 12 mois (comme `energy`) : une sécheresse née à un
  passage finit au suivant (un an) ; **à la demande en cours d'année elle s'arrête au prochain passage** (limite connue,
  bornée). Les mois restants sont sauvegardés (morceau 14, 2 octets, seulement s'ils ne sont pas nuls ; refusé au-delà de
  12 ou nul).
* **Feux et ruines classiques** : `random_fire` / `random_rubble` de `disasters.rs` (le `do_fire` du moteur les propage
  ensuite) ; l'OVNI réutilise `destroy_map_tile` du monstre (l'eau et le sol nu sont épargnés). L'émeute n'allume que des
  tuiles qui brûlent (`BURNBIT`) et que `vulnerable` accepte (bâtiments, pas de centre de zone). La météorite épargne l'eau.
  « Circulation bloquée » de l'émeute n'est pas simulée (non listée au contrat).
* **Sécheresse et eau.** `WaterNetwork` a un drapeau d'exécution `weak` (jamais sauvegardé) : la portée des pompes
  `PUMP_RANGE` est divisée par `DROUGHT_PUMP_DIV` et la couverture recalculée ; resynchronisé à chaque passage des valves,
  à chaque déclenchement et à l'extinction de la règle. La valve résidentielle perd `DROUGHT_VALVE` à chaque calcul, bornée
  à −2000.
* **Autoroutes.** Tuile éligible = `is_highway_road` : routes `ROADS..=LASTROAD` sauf `HBRIDGE`, `VBRIDGE` et la pièce de
  pont qui clôt chaque groupe de 16 tuiles de trafic (`BRWH`, `BRWV`, …) ; les passages à niveau sont hors de la plage.
  Liste triée sans doublon (`HighwayList`), recherche dichotomique. `repair_highways` (à chaque passage des valves et au
  chargement) retire les tuiles dont la route a disparu et vide la liste règle éteinte ; reconstruire la route ne ramène
  pas l'autoroute. Refus : règle éteinte, hors carte, pas une route classique, déjà autoroute, plafond (`Failed`), fonds
  (`NoMoney`).
* **Circulation.** Un bloc de la carte de circulation qui contient au moins une tuile d'autoroute a sa densité divisée par
  `HIGHWAY_TRAFFIC_DIV`, après la densité mesurée des voitures ou celle du métro (`ext_traffic`).
* **Voitures.** `RoadGraph` porte un drapeau « autoroute » par tuile (dans la comparaison : poser une autoroute déclenche la
  relecture du graphe, sans abandonner de voiture dont la route existe) ; `Car::advance_scaled` multiplie la vitesse, plafonnée
  à une tuile par tick, donc la conservation (`spawned = driving + parked + round_trips + abandoned`) tient à chaque tick
  (testée avec poses en cours de route et extinction de la règle). Les bus et taxis ne sont pas accélérés.
* **Sauvegarde.** Octet de règles 2 : bit 4 `RULES2_DISASTERS`, bit 5 `RULES2_HIGHWAYS`. Règles éteintes et rien de stocké :
  fichier identique octet pour octet (testé). Dernière catastrophe (`disaster2_stats`) : état d'exécution, non sauvegardé.
* **Effets de bord sur des tests existants** : `CHUNK_MAX_TAG` passe de 12 à 14 et les bits 4 et 5 de l'octet 2 sont
  connus ; les tests qui prenaient la étiquette 13 ou le bit 4 pour « inconnus » (`extensions.rs`, `tests/save_extensions.rs`,
  `web/test/wasm-extensions-save.test.mjs`) utilisent maintenant l'étiquette 15 et le bit 6, et les tests `*_save.rs` qui
  fixaient `CHUNK_MAX_TAG` attendent 14.

### Tests
Règle éteinte = moteur classique pendant 600 pas (états, suite du générateur, fichier) pour chaque règle ; chaque
catastrophe à la demande (effet, message, position) et au hasard (déterministe à graine égale, jamais sans règle ni
permission, pas d'émeute sans condition) ; sécheresse (valve, pompes, durée, extinction) ; refus (règle éteinte, type
inconnu, émeute sans zone, bâtiment, pont, passage à niveau, hors carte, fonds, plafond de 4096) ; réparation ; circulation
divisée ; voitures plus rapides sans casser la conservation ; sauvegarde aller-retour et morceaux refusés (`cty_bad_extension`).
