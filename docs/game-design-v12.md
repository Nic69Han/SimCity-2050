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
