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

## Sous-sol en 3D (chantier livré)

Calque `web/view3d-underground.js` (partie pure : `web/view3d-underground-model.js`), lit le moteur par `ctx.city()`
(lecture seule) et ne dessine rien si `water_layer()` / `transit_layer()` manquent ou si la règle est désactivée.

* **Formes** : canalisations = boîtes bleues fines sous le sol (grises-bleues à sec), pompes = petites tours
  cyan sur le sol, tunnels = boîtes plus épaisses et plus profondes (grises, orange sur une ligne en service),
  stations = petits bâtiments sur le sol (couleur plus forte en service). Un noeud par tuile et un segment par
  voisin relié (droite et bas) ; hauteurs depuis `tileCentreY`.
* **Capacités** (`CAPACITY`, une `InstancedMesh` par genre) : canalisations 12288, pompes 64 (`MAX_PUMPS`),
  tunnels 12288, stations 64 (`MAX_STATIONS`). Au-delà, les placements sont abandonnés et comptés (`dropped`).
* **Mises à jour** : `update()` tourne à chaque image ; l'empreinte (FNV-1a) des deux couches, les drapeaux de
  règle et le tableau des coins du terrain sont comparés, et les instances ne sont reconstruites que s'ils changent.
* **Bouton « Sous-sol »** dans `#view3d-controls` : les matériaux Lambert opaques trouvés dans `ctx.scene`
  (terrain, volumes des bâtiments) deviennent translucides (opacité 0,3, sans écriture de profondeur) ; état
  d'origine restauré au relâchement et au `dispose()`. Les réseaux sont dessinés dès que leur règle est active,
  le bouton ne change que la transparence. Les canalisations et tunnels enterrés sont donc cachés par le terrain
  opaque ; les pompes et stations, posées sur le sol, restent visibles.
* **Crochet de test** : `canvas.undergroundStats()` → `{ pipeTiles, pumpTiles, tunnelTiles, stationTiles,
  instances: {pipe, pump, tunnel, station}, dropped, seeThrough, rebuilds }` (retiré au `dispose()`).
* **Tests** : `web/test/view3d-underground*.test.mjs` (placement, capacité, détection de changement),
  `web/e2e/underground.test.mjs` (eau, vue 3D simple `?lite=1`, bascule).

## Conseillers et sons (chantier livré)

### Conseillers (`advisors-model.js`, `advisors.js`)
Seuils en constantes documentées, texte déterministe, fonction totale ; les règles et l'ordre existants sont
inchangés. Un bloc de règle n'est lu que si l'API du moteur existe **et** que son interrupteur
(`water_rules`, `transit_rules`, `deals_rules`) est vrai ; sinon il est ignoré.

| Conseiller | Règle | Seuils |
|---|---|---|
| Urbanisme | Zones sans eau (`water_stats` : pompes, canalisations, alimentées, à sec) ; conseille une pompe si aucune, sinon de prolonger les canalisations à `WATER_REACH` (3) cases | attention dès 1 zone à sec ; urgent à `WATER_DRY_URGENT_MIN` (4) zones et `WATER_DRY_URGENT_SHARE` (50 %) |
| Urbanisme | Métro (`transit_stats` : stations, tunnels, lignes, tuiles desservies) : plaintes de circulation sans ligne en service → creuser une ligne ; avec lignes → les prolonger ; stations sans ligne → les relier ; lignes en service citées quand tout va bien | sévérité des plaintes (`VOTES_ATTENTION` 15, `VOTES_URGENT` 35) ; stations sans ligne : attention |
| Finances | Coût annuel des ordonnances actives (`ordinance_info`/`ordinance_active`) ajouté au diagnostic ; si l'argent manque, retirer la plus chère | tout coût actif > 0 |
| Finances | Accords (`deals_rules`) : nombre et recette annuelle ; surplus d'électricité à vendre aux voisins | surplus ≥ `DEAL_SURPLUS_MIN` (1) |
| Sécurité | Criminalité en plainte (≥ 15 votes) : propose l'ordonnance inactive qui baisse le plus la criminalité, par son nom français et son coût | `VOTES_ATTENTION` |
| Environnement | Pollution en plainte ou en hausse : même chose avec l'effet pollution | `VOTES_ATTENTION`, `POLLUTION_RISE` |

Mise à jour légère : la clé de `update()` contient désormais `cheapKey(city)` (interrupteurs des règles,
masque des ordonnances en vigueur, compteurs d'eau et de métro, nombre d'accords), donc un changement de règle
ou d'ordonnance recalcule les conseils sans attendre le mois suivant.

Forme **supposée** de l'API des accords (à confirmer avec le chantier voisin ; une forme inconnue est ignorée
sans erreur) : `active_deals()` = liste dont la longueur est le nombre d'accords et dont les éléments
portent un `income` numérique (dollars par an) ; `surplus()` = un nombre, une liste dont la première valeur est
le surplus d'électricité, ou un objet `{ electricity }`.

### Sons (`sound.js`, `sound-model.js`) et crochet de résultat (`tools.js`)
* `tools.js` exporte `onToolResult(listener)` (renvoie la fonction de désabonnement). Chaque appel d'outil de la
  page (outils du moteur et outils d'extension) appelle les écouteurs avec `{ kind, result, cost? }` : `kind` est
  `"down"` (clic) ou `"drag"` ; `result` est le code `RESULT`, ou `null` quand le moteur n'en donne pas (un
  glisser d'outil du moteur) ; `cost` (clic seulement) est le coût que `tool_preview` annonçait juste avant. Un
  écouteur qui lève est signalé à la console sans arrêter l'outil. Le comportement des outils est inchangé.
* `sound.js` s'y abonne : réussite → son « construction » (le clic, plus grave), « Pas assez d'argent » → son de
  manque d'argent, refus → son de refus. Plus de lecture du texte de `#tool-msg`. La limite de débit est conservée.
* Test seulement : avec `?soundlog=1` dans l'adresse, `window.__soundLog` liste les clés des sons démarrés (200
  derniers) ; sans ce paramètre rien n'est exposé.
* Limite : un glisser d'outil du moteur ne renvoie aucun code, donc seul le premier carreau d'une route tracée
  au glisser fait entendre le son de construction.

## Accords avec les voisins

Quatre villes voisines (indices 0 nord, 1 est, 2 sud, 3 ouest ; le moteur ne connaît que les indices, la page
donne les noms : Valmont, Port-Aurore, Saint-Élan, Hautebrise) achètent l'électricité et l'eau en trop de la
ville. Code : `crates/micropolis-core/src/deals.rs`, adaptateur `crates/micropolis-wasm/src/deals.rs`, page
`web/deals-ui.js` (+ `web/deals-model.js`, `web/css/deals.css`). Règle désactivée par défaut
(`Extensions::deals`) : le moteur est alors identique à l'original (tests `tests/deals_rules.rs`, scripts
`compare-*.sh`). Entiers uniquement, aucun tirage aléatoire (jamais le générateur de la simulation), tout est
borné : au plus `MAX_DEALS` = 8 accords.

* **Offres** : 8 offres, une par voisin et par ressource (indice `voisin * 2 + ressource`, 0 électricité,
  1 eau). Les conditions ne dépendent que de la population du recensement et des années écoulées
  (`city_time / 48`) : palier `0..=3` (moins de 2 000, 10 000, 50 000 habitants, au-delà),
  `quantité = base * (palier + 1)` unités par an, `prix = base * (100 + min(années, 50)) / 100` $ par unité
  (table `OFFERS` : électricité 100 à 250 unités à 4-6 $, eau 4 à 8 unités à 50-70 $). Un accord signé garde les
  conditions de sa signature.
* **Surplus** : *électricité* = capacité - consommation. Capacité = 700 par centrale à charbon et 2 000 par
  centrale nucléaire présentes sur la carte (`COAL_POWER_STRENGTH` et `NUCLEAR_POWER_STRENGTH` de `power.rs`,
  recopiées ; comptage des tuiles centre de centrale, donc stable à toute phase du cycle). Consommation = nombre
  de tuiles alimentées au dernier balayage du réseau (`power_grid_map`), exactement ce que le moteur compare à
  son `max_power`. *Eau* = 20 zones par pompe du réseau d'eau - zones arrosées (`water_stats`) ; les règles de
  l'eau doivent être actives, sinon la capacité est 0. Le surplus *libre* retire en plus les quantités des
  accords déjà signés.
* **Signer** : règle active, offre valide, pas d'accord déjà signé avec ce voisin pour cette ressource, place
  libre, surplus libre au moins égal à la quantité. Codes : 1 signé, 0 indice invalide, -1 règle désactivée,
  -2 déjà signé, -3 surplus insuffisant, -4 trop d'accords.
* **Recette** : à chaque collecte des impôts (une fois par an, via `ext_monthly_balance`), chaque accord dont la
  quantité est couverte par le surplus restant (dans l'ordre de signature) rapporte `quantité * prix` $.
* **Rupture** : un accord que le surplus ne couvre plus est rompu par le voisin : pénalité de 100 % de sa recette
  annuelle, et le moteur envoie le message `MESSAGE_DEAL_BROKEN` = 58, sans position. Ce numéro n'a pas encore de
  texte dans `web/messages-text.js` (la page affiche « Message du moteur n° 58 ») ; le panneau signale en plus
  lui-même la rupture.
* **Résilier** : pénalité immédiate de 50 % de la recette annuelle ; l'accord disparaît.
* Désactiver la règle supprime tous les accords sans frais. Une nouvelle ville ou un fichier sans accords n'en a
  aucun.
* **Sauvegarde** : bit `0b100` du morceau 1 (règles) pour l'interrupteur, morceau 5 pour les accords (10 octets
  chacun : voisin, ressource, quantité et prix en entiers 32 bits grand-boutiste). Un fichier sans accord et
  règle éteinte reste identique octet pour octet.
* **API wasm** : `deals_rules`, `set_deals_rules`, `deal_offers` (enregistrements de 6 : voisin, ressource,
  quantité, prix, recette annuelle, code que `accept_deal` répondrait), `active_deals` (enregistrements de 7 :
  voisin, ressource, quantité, prix, recette annuelle, couvert 0/1, pénalité de résiliation), `accept_deal`,
  `cancel_deal`, `surplus` (`[électricité, eau]`, surplus libre).
