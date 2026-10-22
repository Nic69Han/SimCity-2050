# Conception du jeu : jalon v0.11 « économie »

Huitième jalon du plan docs/plan-sc3000.md. Comme SimCity 3000 : des **impôts par zone et par classe de richesse**,
des **obligations** (emprunts) pour financer les grands travaux, et des **marchandises** : l'industrie produit, le
commerce vend, le surplus part chez les voisins et le manque est importé. Règle « Économie détaillée » désactivée
par défaut ; moteur classique identique au C++ ; entiers, déterminisme, boucles bornées.

## Ce que voit le joueur
* **Impôts** : neuf taux (résidentiel, commercial, industriel × richesse modeste, moyenne, aisée), de 0 à 20 %,
  au lieu du taux unique. La richesse d'une zone vient de la valeur du terrain sous son centre. Un taux élevé fait
  fuir sa zone (demande plus basse), un taux bas l'attire.
* **Obligations** : émettre une obligation apporte 10 000 $ tout de suite ; chaque année la ville paie les intérêts ;
  on peut la rembourser quand on a l'argent. Le taux monte avec le nombre d'obligations en cours.
* **Marchandises** : les zones industrielles produisent, les zones commerciales consomment. Le surplus est vendu aux
  voisins (recette), le manque est acheté (coût) ; un manque prolongé freine le commerce.
* Panneau « Économie » (taux, obligations, marchandises), couche de carte « Richesse », conseiller des finances.

## Contrat (fixé avant les chantiers)
Interrupteur `Extensions::economy` = bit 2 du **second octet** des règles (`RULES2_ECONOMY`), sauvegardé. Taux,
obligations et compteurs de marchandises sauvegardés dans le **morceau 11** (`CHUNK_ECONOMY`, `CHUNK_MAX_TAG` = 11),
écrit seulement s'il diffère de l'état de départ. Ne demande pas les bâtiments étendus. Règle éteinte et rien de
stocké : fichier identique octet pour octet, moteur identique au C++ (comparaisons `compare-*.sh`).

* **Une année** = un passage du bilan (`ext_monthly_balance`), qui a lieu à chaque collecte d'impôts (une fois par
  an de jeu, voir v0.10).
* **Richesse** d'une zone (R, C ou I) : valeur du terrain du bloc de son centre ; modeste `< WEALTH_MID` (= 60),
  moyenne `< WEALTH_HIGH` (= 120), aisée sinon (constantes nommées).
* **Impôts** : nouveau crochet `ext_tax_fund(tax_fund) -> i64` appelé à la fin de `tax_amounts` (`simulate.rs`) ;
  règle éteinte il rend son entrée (moteur classique inchangé). Règle allumée : recette =
  Σ zones `population_de_la_zone × valeur_du_terrain × taux[genre][richesse] / 120`, multipliée par le même facteur de
  difficulté que le classique (`F_LEVELS`, en entiers : `[140, 120, 80] / 100`). Taux de départ = le taux unique
  courant (`city_tax`) pour les neuf cases. La population d'une zone C ou I suit la convention du v0.8
  (`TIER_POPULATION` par palier).
* **Demande** (`ext_valves`) : pour chaque genre, taux moyen pondéré par la population de ses zones ; la valve du
  genre reçoit `(TAX_TABLE[taux_unique] - TAX_TABLE[taux_moyen])` (même table que le classique), bornée à
  ±`VALVE_TAX_LIMIT` (= 300), sans dépasser les bornes classiques des valves.
* **Obligations** : au plus `MAX_BONDS` (= 10) ; montant `BOND_AMOUNT` (= 10 000 $) ; taux annuel en pour mille
  `BOND_BASE_PERMILLE` (= 30) + `BOND_STEP_PERMILLE` (= 10) × obligations en cours. Intérêts payés à chaque année
  (arrondi entier, toujours ≥ 1 $). Rembourser coûte le montant et retire l'obligation ; refusé sans les fonds.
  Éteindre la règle rembourse tout ce qui peut l'être puis oublie le reste (documenté, testé).
* **Marchandises** (par an) : production = Σ population industrielle × `GOODS_PER_IND` (= 2) ; consommation =
  Σ population commerciale × `GOODS_PER_COM` (= 3). Surplus vendu `GOODS_EXPORT_PRICE` (= 1 $) l'unité, manque
  acheté `GOODS_IMPORT_PRICE` (= 2 $). Si le manque dépasse `SHORTAGE_PCT` (= 50) % de la consommation, la valve
  commerciale baisse de `SHORTAGE_VALVE` (= 200) l'année suivante.
* API wasm (`crates/micropolis-wasm/src/economy.rs`) :

| Méthode | Retour |
|---|---|
| `economy_rules()` / `set_economy_rules(on)` | interrupteur |
| `tax_rates()` | `Int32Array` de 9 : `[R modeste, R moyenne, R aisée, C …, I …]` (0..=20) |
| `set_tax_rate(genre, richesse, taux)` | `bool` ; `genre` 1 R, 2 C, 3 I ; `richesse` 1 modeste, 2 moyenne, 3 aisée ; refusé hors bornes ou règle éteinte |
| `tax_income()` | `Int32Array` de 9 : recette de la dernière année par case (même ordre) |
| `bonds()` | `Int32Array` d'enregistrements de 3 `[montant, taux_pour_mille, années_écoulées]` |
| `bond_offer()` | `Int32Array [montant, taux_pour_mille]` de la prochaine obligation (`[0, 0]` si impossible) |
| `issue_bond()` / `repay_bond(index)` | code : 1 fait, 0 règle éteinte, -1 plafond / fonds insuffisants / index inconnu |
| `goods_stats()` | `Int32Array [produites, consommées, exportées, importées, recette_nette, pénurie (0/1)]` de la dernière année |
| `wealth_layer()` | `Uint8Array` une valeur par tuile (ordre `x * hauteur + y`) : 0 rien, 1-3 richesse sur les 9 tuiles d'une zone |

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur de l'économie** | Sonnet | `crates/micropolis-core/src/economy.rs` (+ `economy/`), crochet `ext_tax_fund` (une ligne dans `simulate.rs`), `extensions.rs`, `crates/micropolis-wasm/src/economy.rs`, tests, `web/test/wasm-economy.test.mjs`, section livrée |
| **Page** | Haiku | panneau « Économie » (`web/economy-ui.js`, `web/economy-model.js`, `web/css/economy.css` : interrupteur, tableau 3 × 3 des taux, obligations avec émettre / rembourser, marchandises), conseiller des finances (`web/advisors-economy.js`), faux moteur, tests |
| **Couche** | Haiku | `web/map-layer-wealth.js` (+ modèle : richesse 1-3 en trois teintes, case « Voir la richesse » dans le panneau via `setWealthView`), tests |

## Critères d'acceptation
Comparaisons C++ identiques ; règle éteinte = moteur d'origine ; recettes par case testées (somme, difficulté,
richesse) ; effets des taux sur la demande bornés et testés ; obligations (émission, intérêts, remboursement,
plafond, fonds) testées ; marchandises (conservation : produites + importées = consommées + exportées) testées ;
sauvegarde aller-retour ; e2e : activer l'économie, changer un taux, émettre une obligation ; tous les tests verts ;
relecture.

## Cœur de l'économie (chantier livré)
Code : `crates/micropolis-core/src/economy.rs` (constantes, `EconomyState`, sauvegarde) et `economy/` (`zones` zones,
richesse, recette par case, taux moyen ; `bonds` obligations ; `goods` marchandises ; `month` crochets et bilan annuel ;
`rules` interrupteur et appels du joueur ; `layer` couche de richesse) ; adaptateur
`crates/micropolis-wasm/src/economy.rs`. Tests : `tests/economy_rules.rs`, `tests/economy_save.rs` (sur la ville
Haight, qui a des habitants), unitaires des modules, adaptateur, `web/test/wasm-economy.test.mjs`.

* **Interrupteur** : `Extensions::economy`, bit 2 du second octet des règles (`RULES2_ECONOMY`) ; ne demande pas
  `structures`. Éteint (défaut) : `ext_tax_fund` rend son entrée, `ext_valves` et le bilan ne font rien, les appels
  sont refusés (code 0 / `false`) ou vides ; test « règle éteinte puis rallumée puis éteinte = moteur d'origine » sur
  600 pas (mêmes tuiles, fonds, valves, même fichier), comparaisons `compare-*.sh` inchangées.
* **Unité de la population** : la population d'une zone est sur l'échelle résidentielle (habitants ; un palier C ou I
  vaut `TIER_POPULATION` = 8). La recette d'une case est `Σ(pop × valeur du terrain) × taux × difficulté /
  (8 × 120 × 100)` (le `/ 8` ramène à `total_pop × valeur / 120` du classique), arrondie vers le bas par case ;
  difficulté `DIFFICULTY_PCT` = [140, 120, 80]. Une valeur de terrain 0..=250 par zone, lue au bloc de son centre.
* **Taux** : neuf octets 0..=`RATE_MAX` (20). Tant que le joueur n'en a fixé aucun, les neuf suivent `city_tax`
  (`custom` = faux, rien d'écrit) ; le premier `set_zone_tax_rate` fige les neuf au taux courant puis change celui
  demandé. Règle allumée, le taux unique du budget ne change plus la recette, seulement la référence de la demande.
* **Demande** : taux moyen d'un genre pondéré par la population de ses zones (arrondi au plus proche) ; poussée =
  `TAX_TABLE[taux unique + niveau] - TAX_TABLE[taux moyen + niveau]` (mêmes indices bornés que le classique), bornée à
  ±`VALVE_TAX_LIMIT` (300) par appel, puis valve ramenée dans sa plage classique (±2 000 / ±1 500 / ±1 500) ; une
  valve plafonnée (`*_cap`) ne devient pas positive. Genre sans population : pas de poussée.
* **Obligations** : `Vec<Bond>` (`montant`, `permille`, `années`), au plus `MAX_BONDS` (10). Le taux se fige à
  l'émission : `BOND_BASE_PERMILLE` (30) + `BOND_STEP_PERMILLE` (10) × obligations en cours. Intérêt annuel =
  `montant × permille / 1000`, au moins 1 $, payé au bilan avec les autres frais ; les années croissent (plafond
  65 535). `repay_bond(index)` : n'importe quelle obligation, au montant, refusé sans les fonds. Éteindre la règle
  rembourse, de la plus ancienne à la plus récente, ce que les fonds permettent, oublie le reste (la dette
  disparaît), remet les taux à zéro.
* **Marchandises** : à chaque bilan, `produites = Σ pop I × 2`, `consommées = Σ pop C × 3` ; surplus exporté à 1 $,
  manque importé à 2 $ ; `produites + importées = consommées + exportées` (testé) ; recette nette = exportées −
  2 × importées, ajoutée au bilan (le bilan renvoie intérêts moins recette nette). Pénurie = importées × 100 >
  `SHORTAGE_PCT` × consommées ; elle est mémorisée et la valve commerciale perd `SHORTAGE_VALVE` (200) à chaque appel
  de l'année suivante (jusqu'au bilan suivant). Pas de consommation sans commerce : pas de pénurie.
* **Bilan annuel** (`ext_monthly_balance`, une fois par collecte) : enregistre recette par case et marchandises,
  paye les intérêts, vieillit les obligations. Les impôts eux-mêmes sont encaissés par le classique via
  `ext_tax_fund` (une ligne dans `tax_amounts`), donc la somme des neuf cases égale `tax_fund` du même instant.
* **Sauvegarde** : morceau 11 (`CHUNK_ECONOMY`, `CHUNK_MAX_TAG` = 11), écrit seulement s'il diffère de l'état de départ
  (`EconomyState::default()`) : drapeau `custom` (1), neuf taux (9), neuf recettes (36), marchandises 5 × i32 + pénurie
  (21), nombre d'obligations (1) puis 8 octets par obligation. Refusé (`cty_bad_extension`) : trop court, nombre
  > 10 ou ne correspondant pas à la longueur, drapeau > 1, taux > 20, obligation à montant ≤ 0 ou taux > 1 000 ‰,
  compteur de marchandises négatif ; règle éteinte, tout est oublié au chargement. Les trois premiers bits du
  second octet de règles : 1 services, 2 énergie, 4 économie.
* **API wasm** : table du contrat, sans écart ; `bond_offer()` donne `[0, 0]` règle éteinte ou au plafond ;
  `wealth_layer()` n'est pas nul que règle allumée ; `tax_rates()` montre le taux unique neuf fois règle éteinte.
* **Bornes** : aucune boucle sans borne (carte, `MAX_BONDS`, neuf cases) ; aucun tirage aléatoire ; tous les
  cumuls en `i64` ramenés en `i32` par saturation.
* **Limites connues** : le prévisionnel du budget de la page (`tax_fund_at`) reste le calcul classique à taux unique ;
  une sauvegarde d'une ville jouée n'est pas identique octet pour octet après rechargement dans la partie classique
  (comportement du moteur d'origine, indépendant de l'économie), seul le bloc d'extensions l'est.
