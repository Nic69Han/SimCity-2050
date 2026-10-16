# Étude d'Egregoria pour l'IA de simulation

Source étudiée : <https://github.com/Uriopass/Egregoria> (Uriopass et contributeurs, licence GPL-3.0), commit
`ae65c85` du 2025-06-02, lu en lecture seule. Les chemins ci-dessous sont relatifs à la racine de ce dépôt et
les lignes sont celles de ce commit. Aucun code n'a été exécuté ni copié.

## 1. Résumé

Egregoria est une ville 3D (Rust, wgpu) où chaque habitant, voiture, camion et train est une entité simulée. Le
cœur (`simulation/`) est un pas fixe de 50 ticks par seconde réelle (`prototypes/src/types/time.rs:10-21`), une
liste ordonnée de systèmes exécutés en séquence (`simulation/src/utils/scheduler.rs:39-57`), des commandes
joueur appliquées en tête de tick (`simulation/src/lib.rs:244-258`) et des tampons de commandes triés par
identifiant pour rester déterministe (`utils/par_command_buffer.rs:50-83`).

Différences structurantes avec notre moteur :
* Egregoria est **continu** (routes en polylignes, voies, intersections avec virages, physique de véhicule en
  `f32`). Nous sommes **discrets** (tuiles, entiers, `micropolis-core` sans dépendance, wasm).
* Egregoria utilise des dépendances (`pathfinding`, `flat_spatial`, `slotmapd`, `serde`) et un parallélisme
  optionnel. Notre cœur n'a aucune dépendance (ARCHITECTURE.md, règle 2).
* Egregoria n'a pas de plafonds explicites sur ses boucles (A*, BFS, `while` d'itinéraire). Nos règles 6 et 9
  l'exigent.

Donc : on reprend les **idées d'architecture** (agents à désirs notés, itinéraire en étapes, répartiteur,
réservations ferroviaires, marché d'ordres, hachage d'état par tick), pas la cinématique continue.

## 2. Analyse par sujet

### 2.1 Habitants : besoins, décisions, horaires
**Comment.** Un habitant porte `home`, `work`, `food` (`souls/human.rs:20-33`, `234-275`). Chaque « désir » expose
un `score()` ; l'habitant applique celui de score maximal (`human.rs:164-232`). Maison : constante 0,2
(`souls/desire/home.rs:25-27`). Travail : 0,5 pendant la plage horaire 8 h à 18 h décalée par habitant
(`desire/work.rs:28-39`, `69-75`). Nourriture : croît avec le temps depuis le dernier repas, vaut 1,0 une fois
acheté et arrivé (`desire/buyfood.rs:40-56`). La décision est une pile d'actions (`HumanDecisionKind::MultiStack`,
`human.rs:26-33`, `92-101`). Une attente aléatoire de 30 à 80 ticks entre deux décisions étale la charge
(`human.rs:180-185`).
**Transposable.** Le choix par score maximal et la pile d'actions : fonctions pures, entiers (scores en milliers),
testables seules. L'étalement des décisions par une attente dérivée d'un hachage entier de l'identifiant (pas de
position flottante). Plages horaires décalées par habitant via le générateur des agents.
**Non transposable.** Noms/âge/genre (`human.rs:41-73`) : coûteux, inutiles. Un objet riche par habitant : à notre
échelle (dizaines de milliers) il faut des structures compactes ou des habitants agrégés par bâtiment.

### 2.2 Chemins et réseau de transport
**Comment.** Trois pathfinders derrière un trait (`map/pathfinding.rs:11-22`, `31-69`) : piéton, voiture, rail.
Voiture : A* sur les voies, coût = longueur / limite de vitesse + bruit déterministe issu de `(voie, tick)` pour
répartir les itinéraires (`pathfinding.rs:189-247`, bruit aux lignes 219 et 238) ; heuristique volontairement
inexacte (×1,2, lignes 208-217). Piéton : A* avec virages à coût 0,001 (`pathfinding.rs:73-136`). Le rail réutilise
le pathfinder voiture (`pathfinding.rs:165-174`). Les virages d'intersection sont générés par politique
(`map/turn_policy.rs:100-340`), les feux par politique (`map/light_policy.rs:41-60`) et un cycle
vert/orange/rouge calculé à partir des secondes (`map/traffic_control.rs:58-72`). Un « routeur » compose un
trajet en étapes : marcher, déverrouiller, conduire, garer, entrer dans le bâtiment (`map_dynamic/router.rs:41-51`,
`55-110`). L'itinéraire se met en file `WaitForReroute` avec 200 ticks d'attente si aucun chemin
(`map_dynamic/itinerary.rs:244-256`). Parking : réservation du premier emplacement libre par recherche en
largeur de profondeur 7 (`map_dynamic/parking.rs:58-111`) ou 3 essais aléatoires (`parking.rs:42-56`).
**Transposable.** Trait/enum de modes avec fonction « voie autorisée » (`pathfinding.rs:296-298`) ; coût par mode ;
bruit déterministe sur les coûts pour étaler la charge ; heuristique admissible-ish ; routeur à étapes (marche,
voiture, quai, métro) ; réservation de places bornée en profondeur ; reroutage différé avec compte à rebours ;
cycle de feux = fonction pure du temps. Le graphe doit être **reconstruit seulement quand la carte change**
(Egregoria suit les changements par morceaux : `map/change_detection.rs:1-4`, `83-90`).
**Non transposable.** Géométrie des voies, virages en splines, intersections à polylignes : nos routes sont des
tuiles. On prend un graphe où nœud = tuile de route (ou carrefour), arête = adjacence 4-voisins, avec poids entiers.
Les sous-types de voies (vélo, bus, parking) deviennent des drapeaux de tuile.

### 2.3 Véhicules, mouvement, congestion
**Comment.** Chaque véhicule décide vitesse et direction à chaque tick (`transportation/road.rs:40-79`). Il interroge
les voisins dans une grille spatiale (`query_around`, rayon 12 m + distance de freinage ; `road.rs:59-63` ;
grille `flat_spatial`, `transportation/mod.rs:72`), calcule la distance au premier obstacle dans un cône avant,
plus les trajectoires sécantes (`road.rs:302-407`), s'arrête devant un feu rouge (`road.rs:259-286`), puis applique
accélération/freinage bornés et braquage borné (`road.rs:141-183`). Les véhicules sont triés/synchronisés avant
l'étape de décision (`transportation/mod.rs:87-105`, `maintain_deterministic`). Interblocage : un drapeau d'ID
propagé de voiture en voiture détecte le cycle ; la voiture élue passe en état `Panicking` 200 s et force le passage
(`road.rs:217-233`, `transportation/vehicle.rs:15-24`). Types : voiture, camion, bus avec paramètres (`vehicle.rs:60-105`).
**Transposable.** L'idée d'un **niveau de détail** : seuls les véhicules proches sont simulés finement. Pour nous : un
modèle d'**occupation par tuile** (capacité par tuile et par tick, file d'attente quand pleine), vitesse = fonction
de la densité, détection d'interblocage par drapeau d'ID avec élection déterministe du plus petit identifiant,
« panique » bornée dans le temps. Les types de véhicule comme table de constantes entières.
**Non transposable.** Le cône de collision, le braquage, les rayons sécants : inutiles et coûteux sur tuiles.

### 2.4 Marchandises, logistique, économie
**Comment.** Un marché par type d'objet avec ordres d'achat/vente (`economy/market.rs:15-37`, `119-167`). Les échanges
entre âmes n'utilisent pas d'argent ; seul le commerce extérieur en utilise (`market.rs:65-67`, `284-330`). Appariement
naïf en O(n²) par proximité, trié par distance (`market.rs:193-282`), exécuté dans `market_update`
(`economy/mod.rs:41-86`). Une entreprise suit une recette (consommation/production), avance une jauge de productivité
(travailleurs, surface, électricité) et passe ses ordres (`souls/goods_company.rs:21-58`, `73-105`, `174-210`). Les
camions sont conduits par un habitant qui livre l'acheteur trouvé (`goods_company.rs:229-264`, `desire/work.rs:41-67`).
Le fret ferroviaire : une gare accumule du fret, demande un train au répartiteur, le train arrive, charge 10 s, part
vers la station extérieure (`souls/freight_station.rs:25`, `73-162`). Le **répartiteur** (`Dispatcher`) trouve par
recherche en largeur inverse l'entité libre la plus proche (train, camion) et la réserve (`map_dynamic/dispatch.rs:15-24`,
`220-288`).
**Transposable.** Marché d'ordres + recettes : c'est l'étape 3 de la feuille de route (chaînes à la Megapolis).
Répartiteur par recherche inverse pour taxis, camions, trains. Machine à états de gare (arrivée, chargement,
départ). Plafond de trains par gare (`MAX_TRAINS_PER_STATION = 2`, `freight_station.rs:25`).
**Non transposable.** L'appariement O(n²) : à remplacer par des seaux par quartier ; l'argent hors échange
interne : on garde notre budget Micropolis ; `f32` pour la productivité.

### 2.5 Trains et rail
**Comment.** Réservation d'intersections à l'avance : chaque train réserve les carrefours devant lui sur sa distance
d'arrêt plus sa longueur ; sinon il freine (`transportation/train.rs:230-336`, `388-475`). Les wagons suivent la
trace passée de la locomotive (`map_dynamic/itinerary.rs:427-437`). Compositions de wagons par prototypes
(`train.rs:58-78`). Aucun horaire ni passager : seuls des trains de fret.
**Transposable.** Cantonnement par blocs : un bloc = quelques tuiles de rail, un train réserve les blocs devant lui
(table indexée par bloc), libère derrière. Pas de réservation partielle (tout ou rien, `train.rs:301-306`) :
prévient les interblocages. Wagons = position décalée dans la même trace (déduction à l'affichage).
**Non transposable.** Distance d'arrêt flottante ; absence de passagers/horaires : à concevoir nous-mêmes (étape C).

### 2.6 Temps, déterminisme
**Comment.** Pas fixe, horloge dérivée du compteur de ticks (`time.rs:10-21`), `RandProvider` xorshift128 amorcé
par splitmix64 (`utils/rand_provider.rs:12-39`, `93-99`), aléa local par hachage `(tick, id)`
(`transportation/testing_vehicles.rs:37`). `HashMap` interdit par clippy (`simulation/clippy.toml`), avertissement
sur l'itération de tables de hachage (`lib.rs:3`), `BTreeMap` partout. Commandes enregistrées par tick pour rejouer
(`utils/replay.rs:7-82`). Hachage de l'état par sous-système (`lib.rs:270-283`) ; chaque tick de test sérialise,
désérialise et compare les hachages (`tests/mod.rs:65-82`). Verrouillage de pas (lockstep) pour le multijoueur
(`ARCHITECTURE.md` d'Egregoria, « Bird's Eye View » ; `headless/src/main.rs:65-69`).
**Transposable.** Tout : générateur propre aux agents, hachage `(tick, id)`, structures ordonnées, journal de commandes,
hachage d'état par tick. **Réserve** : Egregoria utilise `f32` ; nous visons des entiers (virgule fixe) pour une
reproductibilité exacte entre machines et wasm.

### 2.7 Performances : échelle, ordonnancement, données
**Comment.** Systèmes en séquence avec chronométrage moyen par système (`scheduler.rs:27-67`). Stockage par
`HopSlotMap` par type d'entité (`world.rs:183-189`), identifiants générationnels. Amortissement : au plus 100
véhicules aléatoires replanifiés par tick, curseur circulaire (`testing_vehicles.rs:25`). Étalement des décisions
d'habitant (voir 2.1) et du reroutage (200 ticks). Tampons de commandes pour muter hors de la boucle d'itération
(`par_command_buffer.rs:26-83`). Tampons réutilisés pour éviter les allocations (`market.rs:70-76`). Grille
spatiale pour les voisins. Profilage par portée (`profiling::scope!`).
**Transposable.** Plafonds par tick (replanifications, nouveaux habitants), curseur circulaire, tampons de commandes
triés, tampons réutilisés, chronométrage par système (hors cœur : mesuré par l'adaptateur car pas d'horloge dans le cœur).
**Non transposable.** `Box<dyn>` et fermetures dans les tampons : allocation et non-sérialisable ; préférer une `enum`
de commandes. Parallélisme (`ParCommandBuffer` à `Mutex`) : wasm sans threads.

### 2.8 Tests
**Comment.** Contexte de test qui construit des routes, des maisons, des habitants (`tests/mod.rs:16-63`) ; tests de
scénario avec borne de ticks (`souls/freight_station.rs:174-227`) ; tests de répartiteur et banc d'essai
(`map_dynamic/dispatch.rs:299-675`) ; aller-retour de sérialisation à chaque tick (`tests/mod.rs:65-82`). Les tests
de véhicules sont désactivés (`tests/vehicles.rs:1`, tout en commentaire) : dette à éviter.
**Transposable.** Contexte de test, scénarios bornés, aller-retour de sauvegarde, comparaison de hachages.

## 3. Recommandations pour `docs/ia-simulation.md`

Constantes communes (règle 6) : `MAX_AGENTS`, `MAX_PATH_LEN`, `MAX_ASTAR_EXPANSIONS`, `MAX_PATHS_PER_TICK`,
`MAX_BFS_DEPTH`, `MAX_QUEUE_PER_TILE`, chacune nommée, testée, et dépassement = échec propre (pas de panique).

**Principes à ajouter au document** (avant les étapes) :
1. Générateur des agents = xorshift128 amorcé par splitmix64 en entiers (`rand_provider.rs:12-39`), plus hachage
   `(tick, id)` pour les décisions locales. Jamais celui de Micropolis.
2. Pas de `HashMap`, pas d'itération dans un ordre non défini ; agents dans un `Vec` indexé par identifiant stable
   (index + génération), itération par indice croissant.
3. Mutations différées : une `enum` de commandes appliquée triée par identifiant (`par_command_buffer.rs:50-83`),
   pas de fermetures.
4. Position d'un agent = (arête, progression en 1/256 de tuile) en entiers ; la vue interpole.
5. Test de conservation et de déterminisme par hachage d'état tous les N ticks (`lib.rs:270-283`, `tests/mod.rs:65-82`).

**Étape A (graphe, habitants, voitures, trafic mesuré).**
* A1. Graphe des routes en tableaux (nœud = tuile de route, arêtes 4-voisins, poids entier selon mode), reconstruit
  par morceaux quand la carte change ; compteur de version pour invalider les chemins (`change_detection.rs`).
* A2. A* borné par `MAX_ASTAR_EXPANSIONS`, tas binaire écrit à la main, bruit déterministe `(arête, tick)` sur les
  coûts, heuristique de Manhattan (cf. `pathfinding.rs:189-247`). Échec = `WaitForReroute` de 200 ticks.
* A3. Habitant compact (domicile, travail, plage horaire, prochaine décision) ; désirs maison/travail notés en
  entiers, choix par score maximal (`human.rs:164-232`) ; décision différée par hachage de l'identifiant.
* A4. Occupation par tuile : capacité `MAX_QUEUE_PER_TILE`, vitesse selon densité, interblocage résolu par élection du
  plus petit identifiant (`road.rs:217-233`). Le trafic mesuré remplace le seuil statistique de `traffic.rs` quand
  `agent_sim` est actif, sinon comportement C++ inchangé (règle 10).
* A5. Plafond `MAX_PATHS_PER_TICK` avec curseur circulaire (`testing_vehicles.rs:25`).

**Étape B (bus, taxis, budget).**
* B1. Répartiteur : recherche en largeur inverse depuis la demande, profondeur `MAX_BFS_DEPTH`, premier véhicule libre
  non réservé (`dispatch.rs:220-288`) ; table des véhicules libres par tuile (tableau, pas de table de hachage).
* B2. Bus = lignes d'arrêts sur le graphe, capacité entière, billets et entretien dans le budget existant.
* B3. Routeur à étapes (marche, voiture, bus, taxi), choix du mode au coût minimal (`router.rs:41-51`).

**Étape C (trains et métro).**
* C1. Cantonnement : tuiles de rail regroupées en blocs ; un train réserve tout ou rien les blocs sur sa distance
  d'arrêt (`train.rs:230-336`), table de réservation indexée par bloc, libération derrière lui.
* C2. Métro = même mécanisme sur un second graphe (tunnels) ; horaires = fonction pure du temps
  (`traffic_control.rs:58-72`) ; capacité et correspondances nouvelles (Egregoria n'a pas de passagers).
* C3. Machine à états de station (arrivée, chargement, départ) avec plafond de rames par station
  (`freight_station.rs:15-25`).

**Étape D (marchandises).**
* D1. Marché d'ordres par marchandise avec seaux par quartier (pas d'O(n²), `market.rs:193-282`), échanges internes
  sans argent, commerce extérieur via gares/ports (`market.rs:284-330`), brancher sur l'économie de l'étape 3.
* D2. Recettes d'entreprise avec stock plafonné (`goods_company.rs:30-58`), productivité = travailleurs × surface ×
  électricité, en entiers.
* D3. Camions via le répartiteur de B1 ; chaque livraison est un événement compté (conservation du fret testée).

**Étape E (équilibrage, performances, 3D).**
* E1. Niveaux de détail : agents proches de la caméra simulés tuile par tuile, le reste agrégé par arête (flux).
* E2. Mesure par l'adaptateur (le cœur n'a pas d'horloge) : budget de ticks par système, rapport de dépassement.
* E3. Instantanés compacts (tableaux plats) vers la vue ; la vue interpole.

**Tests à prévoir** (en plus de ceux du document actuel) : A* respecte `MAX_ASTAR_EXPANSIONS` ; deux exécutions ont
les mêmes hachages à chaque N-ième tick ; sauvegarde puis rechargement donne les mêmes hachages
(`tests/mod.rs:65-82`) ; aucun interblocage persistant sur cartes générées ; mode désactivé identique au C++.

## 4. Licence et attribution

Egregoria est publié sous **GPL-3.0** (fichier `LICENSE` à la racine du dépôt cité). Notre dépôt reprend déjà des
données GPL de Micropolis, mais **nous ne recopions aucun code d'Egregoria** : ni fonction, ni structure, ni constante
non triviale. Ce document ne contient que des descriptions et des références de fichier. Toute implémentation de nos
étapes A à E est réécrite à partir de ces descriptions, avec nos types entiers et nos règles de code. Si un
contributeur pense avoir besoin d'un extrait, il le signale en relecture : la décision de licence revient au
mainteneur, pas à l'agent.

Attribution : idées d'architecture inspirées d'Egregoria, © Uriopass et contributeurs, GPL-3.0,
<https://github.com/Uriopass/Egregoria>. Ce dépôt n'est ni affilié ni approuvé par ses auteurs.
