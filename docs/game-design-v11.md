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
