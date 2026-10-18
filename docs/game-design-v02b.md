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
