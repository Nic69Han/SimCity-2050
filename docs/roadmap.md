# Feuille de route : SimCity 2050

Objectif : un jeu de gestion de ville **open source**, moderne, entièrement jouable dans le navigateur, inspiré de
SimCity 3000 (ville 3D avec relief, ville vivante) et de Megapolis (chaînes de production, économie, progression),
avec une simulation « intelligente » (agents : véhicules, taxis, trains, métro).

Principes (ARCHITECTURE.md) : le moteur Rust décide tout ; les vues et les outils ne font que traduire ; chaque
règle nouvelle est testée ; le mode « classique » reste identique au moteur C++ d'origine (tests de différence).
Les règles nouvelles sont derrière des réglages, désactivés par défaut.

## État actuel
Moteur Micropolis complet en Rust, vérifié contre le C++ ; page web jouable (outils, budget, messages, sauvegardes,
tailles de carte) ; vue 3D avec relief décoratif (phase 1) ; déploiement Netlify.

## Étapes

### 1. Relief jouable (en cours)
Réglage `relief_rules` (faux par défaut). Terrain aplani sous les bâtiments avec un coût proportionnel à la pente,
routes et rails plus chers en pente, outils « Relever » / « Abaisser » le terrain, relief sauvegardé dans le format
`MCTY`, bascule dans l'interface. Mode classique inchangé.

### 2. Rendu et ambiance
Vrais modèles de bâtiments (procéduraux puis packs libres de droits), eau animée, cycle jour/nuit, ombres, brouillard,
sprites 3D, surcouches (pollution, trafic, valeur du terrain) sur le terrain. Performance sur grandes cartes.

### 3. Économie à la Megapolis
Ressources et chaînes de production (matières, usines, commerces), échanges entre villes voisines, objectifs et
progression par paliers, bâtiments à débloquer, budget détaillé par service.

### 4. Ville vivante : IA de simulation
Habitants, véhicules, taxis, trains, métro, bus simulés individuellement (voir docs/ia-simulation.md). Le trafic
devient visible et mesurable ; les transports en commun deviennent un vrai levier de gestion.

### 5. Conseillers et événements
Conseillers (finances, sécurité, santé, transport) qui analysent la ville et proposent des actions ; catastrophes et
événements dynamiques ; option d'un conseiller conversationnel (langage naturel) en couche séparée, facultative.

### 6. Finition « jeu complet »
Tutoriel, scénarios et défis, sons et musique, version mobile, accessibilité, traductions, sauvegarde dans le
navigateur et partage, performances, documentation de contribution, licence et marques clairement indiquées.

## Ressources graphiques et sonores
Aucun asset d'Electronic Arts ni de Social Quantum. Procédural d'abord, puis packs CC0 ou modèles originaux ; sons
libres de droits. Licences listées dans `docs/credits.md` (à créer à la première ressource externe).

## Méthode
Pour chaque étape : un document de conception court, des agents en parallèle sur des fichiers distincts, vérification
et intégration par le coordinateur, CI verte (tests, comparaison C++ du mode classique, e2e), PR, puis publication.
