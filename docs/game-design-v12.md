# Conception du jeu : jalon v0.12 « récompenses et accords spéciaux »

Neuvième jalon du plan docs/plan-sc3000.md. Comme SimCity 3000 : la ville grandit et le maire est apprécié, des
**récompenses** se débloquent (résidence du maire, hôtel de ville, statue, palais de justice, arc de triomphe) ; des
**pétitionnaires** proposent des **accords spéciaux** qui rapportent gros mais ont un prix (casino, prison d'État,
décharge toxique, base de missiles) ; un **bandeau d'actualités** raconte la vie de la ville. Règle « Récompenses et
accords » désactivée par défaut ; moteur classique identique au C++ ; entiers, déterminisme, boucles bornées ;
bâtiments = genres du catalogue v0.4.

## Ce que voit le joueur
* **Récompenses** (gratuites, une seule de chaque, débloquées pour toujours une fois le seuil atteint) : résidence du
  maire (2×2), hôtel de ville (3×3), statue du maire (1×1), palais de justice (3×3), arc de triomphe (2×2). Elles
  embellissent leur quartier (valeur du terrain, comme les parcs).
* **Accords spéciaux** : un pétitionnaire propose un bâtiment contre une recette annuelle. Accepter débloque le
  bâtiment (une seule pose) et la recette tombe chaque année tant qu'il est debout ; refuser ferme l'offre pour
  toujours. Chacun a un inconvénient : le casino attire la criminalité, la prison d'État aussi et fait baisser la
  valeur du terrain, la décharge toxique pollue fort, la base de missiles fait baisser la valeur du terrain.
* Panneau « Récompenses et accords » (listes, boutons Accepter / Refuser), bandeau d'actualités sous l'en-tête.

## Contrat (fixé avant les chantiers)
Interrupteur `Extensions::rewards` = bit 3 du **second octet** des règles (`RULES2_REWARDS`), sauvegardé ; actif
seulement si `structures` est aussi active. Déblocages et réponses aux offres sauvegardés dans le **morceau 12**
(`CHUNK_REWARDS`, `CHUNK_MAX_TAG` = 12) : 2 octets de déblocages (bit = genre − 50), 2 octets de réponses (2 bits
par offre : 0 aucune, 1 proposée, 2 acceptée, 3 refusée) ; écrit seulement s'il n'est pas nul. Règle éteinte et rien
de stocké : fichier identique octet pour octet.

* **Satisfaction** = `city_yes` du moteur classique (pourcentage d'opinions favorables de l'évaluation annuelle).
* **Récompenses** (genre, taille, seuil de population, seuil de satisfaction, rayon, bonus de valeur du terrain) :
  50 résidence du maire 2×2 (2 000, 0, 6, 20) ; 51 hôtel de ville 3×3 (10 000, 0, 8, 25) ; 52 statue du maire 1×1
  (5 000, 70 %, 5, 15) ; 53 palais de justice 3×3 (20 000, 0, 8, 20) ; 54 arc de triomphe 2×2 (50 000, 80 %, 10, 30).
  Coût 0, entretien 0 ; électricité non exigée. Déblocage vérifié à chaque bilan annuel (`ext_monthly_balance`) ;
  une fois débloquée, une récompense le reste même si la ville rétrécit. Pose refusée si non débloquée ou déjà posée.
* **Accords spéciaux** (genre, taille, seuil de population pour être proposé, recette annuelle, inconvénient) :
  60 casino 3×3 (8 000, 3 000 $, criminalité +30 dans un rayon de 12) ; 61 prison d'État 4×4 (15 000, 5 000 $,
  criminalité +20 rayon 10 et valeur du terrain −30 rayon 10) ; 62 décharge toxique 4×4 (25 000, 8 000 $, pollution
  +80 rayon 12) ; 63 base de missiles 4×4 (40 000, 10 000 $, valeur du terrain −40 rayon 14). Coût 0 ; entretien 0.
  Une offre passe de « aucune » à « proposée » au bilan où la population atteint son seuil ; la recette est versée
  à chaque bilan tant que le bâtiment est debout et alimenté. Effets par les crochets `ext_crime`, `ext_pollution`,
  `ext_land_value`, décroissance linéaire jusqu'au rayon, bornes classiques.
* API wasm (`crates/micropolis-wasm/src/rewards.rs`) :

| Méthode | Retour |
|---|---|
| `reward_rules()` / `set_reward_rules(on)` | interrupteur ; l'éteindre retire les genres 50-63 (sans remboursement) et oublie déblocages et réponses |
| `rewards()` | `Int32Array` d'enregistrements de 5 `[genre, débloquée 0/1, posée 0/1, population_requise, satisfaction_requise]`, genres 50-54 |
| `special_offers()` | `Int32Array` d'enregistrements de 4 `[genre, recette_annuelle, état, population_requise]`, genres 60-63 ; `état` 0 aucune, 1 proposée, 2 acceptée, 3 refusée |
| `answer_offer(genre, accept)` | code : 1 fait, 0 règle éteinte, -1 offre inconnue ou pas « proposée » |
| `reward_stats()` | `Int32Array [satisfaction_pct, recette_spéciale_dernière_année, récompenses_débloquées, accords_acceptés]` |

* Pose : `place_structure` (v0.4) avec les nouveaux genres ; refusée (`Failed`) pour une récompense non débloquée ou
  déjà posée et pour un accord non accepté ou déjà posé.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Cœur des récompenses** | Sonnet | `crates/micropolis-core/src/rewards.rs` (+ `rewards/`), catalogue (genres 50-54, 60-63), barrière de pose dans `structures/rules.rs`, crochets, sauvegarde, `crates/micropolis-wasm/src/rewards.rs`, tests, `web/test/wasm-rewards.test.mjs`, section livrée |
| **Page** | Haiku | noms des genres 50-54 et 60-63 (`web/structures-model.js`), panneau « Récompenses et accords » (`web/rewards-ui.js`, `web/rewards-model.js`, `web/css/rewards.css`), bandeau d'actualités (`web/news-ui.js`, `web/news-model.js` : titres tirés de l'état de la ville, purs et testés), faux moteur, tests |
| **3D** | Haiku | formes 3D des genres 50-54 et 60-63 dans un nouveau module `web/view3d-structures-rewards.js` (même schéma que `web/view3d-structures-energy.js`), branché dans `web/view3d-structures-model.js`, tests |

## Critères d'acceptation
Comparaisons C++ identiques ; règle éteinte = moteur d'origine ; déblocages (population, satisfaction, définitifs),
offres (proposition, acceptation, refus définitif, recette annuelle seulement bâtiment debout et alimenté), barrières
de pose, inconvénients mesurés ; sauvegarde aller-retour ; e2e : activer la règle, voir une récompense débloquée sur
la ville d'exemple et la poser ; tous les tests verts ; relecture.

## Cœur des récompenses (chantier livré)
Code : `crates/micropolis-core/src/rewards.rs` (genres, tables `REWARDS` et `DEALS`, `Drawback`, `RewardReport`) et
`rewards/` (`state` déblocages et réponses, sauvegarde ; `rules` interrupteur, listes, `answer_offer`, barrière de
pose ; `month` bilan annuel ; `effects` inconvénients) ; catalogue dans `structures/catalog.rs` ; adaptateur
`crates/micropolis-wasm/src/rewards.rs`. Tests : `tests/rewards_rules.rs`, `tests/rewards_save.rs`, unitaires des
modules, adaptateur, `web/test/wasm-rewards.test.mjs` (ville Haight : plus de 40 000 habitants).

* **Interrupteur** : `Extensions::rewards`, bit 3 du second octet des règles (`RULES2_REWARDS`) ; agit seulement si
  `structures` l'est aussi (`reward_active`). Éteint (défaut) : les crochets rendent leur entrée, le bilan ne fait
  rien, les listes sont vides, les statistiques nulles, `answer_offer` rend 0, la pose des genres 50-63 est `Failed` ;
  test « règle allumée sur 2 400 pas = même ville » (tuiles, fonds, cartes de criminalité, valeur du terrain,
  pollution, générateur), comparaisons `compare-*.sh` inchangées. L'éteindre retire les bâtiments 50-63 sans
  remboursement (`repair_structures` les voit orphelins) et oublie déblocages et réponses.
* **Population et satisfaction** : population = `get_population()` (habitants, `(res + 8 (com + ind)) × 20`),
  satisfaction = `city_yes`. Seuils : tables du contrat, mesurés un à un (juste en dessous, juste au seuil, population
  sans satisfaction).
* **Écart voulu au contrat** : allumer la règle lance une fois la vérification des déblocages et des offres, pour qu'une
  ville qui qualifie déjà le voie tout de suite (sinon il faut attendre jusqu'à un an de jeu) ; le bilan annuel
  (`ext_monthly_balance`, une fois par collecte) la refait. Rien n'est payé hors du bilan.
* **Récompenses** (50-54) : entrées `amenity` du catalogue (coût 0, entretien 0, sans électricité) ; la valeur du terrain
  passe par `structures::land_value` (décroissance linéaire, plafond commun `LAND_VALUE_CAP` = 40). Le déblocage est un bit
  qui ne se retire jamais. « Déjà posée » = un bâtiment de ce genre debout : démolie, elle peut être reposée.
* **Accords** (60-63) : `answer_offer` n'accepte que l'état « proposée » (retour 1, 0 règle éteinte, -1 sinon) ; accepter
  autorise une pose ; refuser est définitif (la proposition ne revient jamais, même population plus haute). Les entrées du
  catalogue exigent l'électricité (`FLAG_POWER`) : `structure_works` = alimenté. Recette annuelle versée au bilan
  tant que le bâtiment est debout et alimenté (`reward_stats()[1]` = dernière année, état d'exécution non sauvegardé).
  Un accord accepté mais non construit ne rapporte rien.
* **Inconvénients** (`ext_crime`, `ext_pollution`, `ext_land_value`, appliqués en dernier de la chaîne pour que le
  commissariat ou l'éducation ne les effacent pas) : `montant × (rayon + 1 − d) / (rayon + 1)`, `d` = distance de
  Manhattan à l'emprise, nul au-delà du rayon, sommés sur les bâtiments ; les balayages bornent ensuite comme le
  classique (criminalité 0..=250, pollution 0..=255, valeur 1..=250). Ils agissent tant que le bâtiment est debout,
  alimenté ou non (un mauvais voisin l'est aussi dans le noir). Test sur les cartes balayées : changées près du
  bâtiment, identiques loin.
* **Barrière de pose** (`place_structure`, `structure_preview`) : `reward_allows` → `Failed` si la règle est éteinte, si
  le genre n'est pas débloqué / accepté, ou s'il en est déjà un debout ; les autres genres ne sont pas touchés. Au
  chargement et à chaque contrôle (`repair_structures`) un bâtiment que l'état n'autorise pas est retiré.
* **Sauvegarde** : morceau 12 (`CHUNK_REWARDS`, `CHUNK_MAX_TAG` = 12), 4 octets (`CHUNK_SIZE`) : déblocages 16 bits (bit =
  genre − 50), réponses 16 bits (2 bits par offre, offre = genre − 60), écrit seulement s'il n'est pas nul. Refusé
  (`cty_bad_extension`) : longueur autre que 4, bit de déblocage au-delà du genre 54, bit de réponse au-delà de l'offre
  63, morceau nul ; règle éteinte, l'état lu est oublié. Règle éteinte et rien de stocké : fichier identique octet pour
  octet.
* **API wasm** : table du contrat, sans écart ; `rewards()` et `special_offers()` sont vides, `reward_stats()` nul, règle
  éteinte. `reward_stats()[0]` est `city_yes`.
* **Constantes** : `REWARD_BASE` 50, `DEAL_BASE` 60, `ANSWER_NONE/PROPOSED/ACCEPTED/REFUSED` 0..3, `CHUNK_SIZE` 4,
  `STATS_SIZE` 4 ; seuils, recettes et inconvénients dans `REWARDS` et `DEALS`.
* **Bornes** : aucune boucle sans borne (deux tables, liste des bâtiments `MAX_STRUCTURES` = 256, emprise) ; aucun
  tirage aléatoire ; le plafond de la liste arrête aussi les récompenses (testé).
* **Limites connues** : une offre proposée n'expire pas ; les chiffres de `reward_stats()[1]` ne sont pas
  sauvegardés (0 après chargement jusqu'au bilan suivant).
