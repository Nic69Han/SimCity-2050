# IA de simulation : agents et transports

Aujourd'hui le trafic de Micropolis est statistique : un seuil de densité par tuile, pas de véhicule individuel.
L'IA de simulation ajoute des **agents** (habitants, véhicules) qui se déplacent réellement, sans casser le mode
classique. Tout vit dans le moteur (déterministe, sans dépendance, sans entrées-sorties) ; les vues dessinent
seulement la liste des agents.

## Principes
* **Réglage séparé** `agent_sim` (faux par défaut) : désactivé, le moteur reste identique au C++.
* **Déterminisme** : générateur propre aux agents (pas celui de Micropolis), mêmes entrées, mêmes agents.
* **Coût borné** : les agents sont simulés par lots à chaque tick, avec un plafond et un niveau de détail
  (agents proches de la caméra en détail, le reste agrégé).
* **Lecture seule côté vue** : le moteur expose des instantanés (position, type, direction) ; la vue interpole.

## Composants
1. **Graphe de déplacement** : construit à partir de la carte (routes, rails, stations). Recalculé seulement quand
   la carte change. Recherche de chemin A* avec coûts par mode (voiture, bus, train, métro, marche).
2. **Habitants** : chaque zone génère des habitants avec un domicile, un lieu de travail et des achats. Un
   habitant planifie des trajets selon l'heure ; il choisit le mode au moindre coût (temps, prix, confort).
3. **Véhicules** : voitures privées, camions de marchandises, bus, taxis. Files d'attente et vitesse selon la
   congestion de la route ; le trafic mesuré remplace le seuil statistique quand `agent_sim` est actif.
4. **Taxis** : une flotte par ville ; un taxi prend une demande (habitant sans voiture ou pressé), roule jusqu'au
   client puis à destination ; revenus et coûts dans le budget.
5. **Trains et métro** : lignes définies par des stations et des rails (ou tunnels, sous le relief) ; horaires,
   capacité, correspondances ; billets, entretien, usure dans le budget. Le métro libère la surface et réduit le
   trafic routier.
6. **Retour vers la ville** : le trafic réel alimente la pollution, le bruit, le crime, la valeur du terrain et la
   demande de zones.

## Étapes de réalisation
A. Graphe de déplacement + habitants + voitures (preuve de concept, trafic mesuré).
B. Bus et taxis, budget des transports.
C. Trains et métro (lignes, stations, horaires, correspondances).
D. Marchandises (lien avec l'économie de l'étape 3 de la feuille de route).
E. Équilibrage, performances (plafonds, niveaux de détail), vue 3D des agents.

## Tests
Déterminisme (deux exécutions identiques), conservation (aucun agent perdu ou dupliqué), chemins valides sur le
graphe, plafond respecté, mode désactivé identique au C++ (comparaisons existantes), tests de propriétés sur des
cartes générées.
