# Plan : de SimCity 2050 v0.3b à une ville 3D au niveau de SimCity 3000

Plan d'exécution (ordre fixé) qui prolonge docs/roadmap.md et docs/ia-simulation.md. Chaque jalon suit la même
méthode : document de conception `docs/game-design-<jalon>.md` écrit par la relecture (Opus) avec le contrat
moteur ↔ page, chantiers confiés à des agents (Sonnet pour le moteur et les concepts complexes, Haiku pour la page,
fichiers listés, docs/regles-de-code.md), relecture adversariale, vérifications complètes (Rust, wasm, page, e2e,
comparaisons C++), PR, fusion, publication Netlify. Chaque règle nouvelle reste désactivée par défaut : le mode
classique reste identique au moteur C++.

## Déjà livré
v0.1 (3D, conseillers, tutoriel, sons), v0.2 (eau, ordonnances, métro, relief jouable), v0.2b (sous-sol 3D, accords
avec les voisins), v0.3 (voitures simulées), v0.3b (aller-retour, conseiller de la circulation), v0.4 (bâtiments
étendus), v0.5 (bus et taxis), v0.6 (trains et métro animés), v0.7 (densités et fermes), v0.8 (déchets), v0.9
(éducation, santé, justice), v0.10 (énergie), v0.11
(économie), v0.12 (récompenses et accords spéciaux), v0.13 (catastrophes et grands transports).

## Jalons à venir (dans l'ordre)

| Jalon | Contenu | Fonctionnalités SimCity 3000 couvertes |
|---|---|---|
| **v0.4 Bâtiments étendus** | Plateforme générique : catalogue de bâtiments (taille, coût, entretien, besoins électricité/eau, rayon d'effet), placement/démolition, sauvegarde, entretien au budget, calques 2D et 3D, outils. Trois premiers bâtiments : parc urbain, place publique, monument. | Parcs et loisirs, base de tous les bâtiments ci-dessous |
| **v0.5 Bus et taxis** | Arrêts de bus et dépôt de taxis (bâtiments v0.4) ; habitants sans voiture qui prennent le bus ou le taxi ; recettes et coûts au budget ; véhicules genre 1 et 2 visibles en 2D/3D. | Bus, transport en commun de surface |
| **v0.6 Trains et métro animés** | Gares sur les rails, rames sur les rails et dans les tunnels, horaires, capacité, correspondances, choix du mode au moindre coût. | Trains de voyageurs, métro |
| **v0.7 Densités de zonage et fermes** | Zonage léger / moyen / dense pour R, C, I (plafond de croissance par densité), fermes sur l'industrie légère à faible valeur. | Densités de zones, agriculture |
| **v0.8 Déchets** | Production de déchets par zone, décharge, incinérateur, centre de recyclage, usine de valorisation ; ordures non ramassées → plaintes et pollution ; accords d'export de déchets avec les voisins. | Gestion des déchets |
| **v0.9 Éducation, santé, justice** | École, collège, bibliothèque, musée → niveau d'éducation (EQ) ; clinique, hôpital → espérance de vie ; prison → criminalité ; effets sur la croissance et l'industrie propre. | Éducation, santé, prisons |
| **v0.10 Énergie** | Centrales gaz, pétrole, éolienne, solaire, hydroélectrique, micro-ondes, fusion ; usure et fin de vie des centrales ; pollution propre à chacune ; achat d'électricité aux voisins. | Centrales variées, vieillissement |
| **v0.11 Économie** | Impôts par zone et par classe de richesse, emprunts et obligations, marchandises et chaînes de production (étape D de l'IA, Megapolis), commerce avec les voisins. | Budget détaillé, emprunts, industrie |
| **v0.12 Récompenses et accords spéciaux** | Bâtiments-récompenses débloqués par la population et la satisfaction ; accords spéciaux (casino, prison d'État, décharge toxique, base de missiles) ; pétitionnaires ; journal et bandeau d'actualités. | Récompenses, accords d'affaires, pétitionnaires, actualités |
| **v0.13 Catastrophes et grands transports** | Émeutes, OVNI, météorite, sécheresse ; autoroutes et bretelles ; port et aéroport animés. | Catastrophes SC3000, autoroutes, ports, aéroports |
| **v0.14 Rendu 3D final** | Modèles 3D de tous les nouveaux bâtiments et des densités, variantes par valeur du terrain, éclairage de nuit, performance. | Ville 3D complète |
| **v1.0 Finition** | Musique, scénarios et défis, mobile, accessibilité, traductions, sauvegarde partagée, documentation de contribution. | Jeu complet |

## Règles communes
* Une règle étendue par domaine (interrupteur dans `Extensions`, sauvegardé dans le bloc d'extensions MCTY v3).
* Entiers, déterminisme, boucles bornées par des constantes nommées, tests de chaque plafond.
* Contrat moteur ↔ page écrit avant les chantiers ; la page détecte les méthodes absentes et ne casse jamais.
* Rien de nouveau sans tests ; un jalon n'est fusionné que vert partout.

## Au-delà : niveau SimCity 4 (après v1.0)
Ce que SimCity 4 ajoute à SimCity 3000, dans l'ordre proposé :

| Jalon | Contenu |
|---|---|
| **v1.1 Régions** | Plusieurs villes sur une carte de région, voisins réels (et non fictifs), demande, trajets domicile-travail et échanges (électricité, eau, déchets) entre villes de la région ; vue de région. |
| **v1.2 Richesse et sous-types** | Habitants et emplois par niveau de richesse (§, §§, §§§) ; commerces de services et de bureaux, industrie agricole, sale, manufacturière, de haute technologie ; demande séparée par sous-type. |
| **v1.3 Lots et croissance réaliste** | Parcelles de tailles variées orientées vers la rue, remplacement progressif des bâtiments, désirabilité par sous-type (bruit, pollution, distance au travail, services). |
| **v1.4 Réseau routier complet** | Rue, route, avenue, sens unique, autoroute surélevée et au sol, échangeurs ; ferry, monorail, rail surélevé ; heure de pointe et choix du mode par trajet. |
| **v1.5 Services à capacité** | Chaque école, hôpital, caserne, commissariat a une capacité, un budget propre et une zone de couverture ; âge des habitants (éducation et santé par tranche d'âge). |
| **v1.6 Mode « Ma Sim » et missions** | Suivre un habitant (domicile, travail, humeur) ; missions de conduite (pompiers, police, bus) dans la ville. |
| **v1.7 Mode divin étendu et catastrophes** | Terraformage complet avant la fondation (montagnes, rivières, érosion), volcan, robot géant, pluie de météores. |
| **v1.8 Rendu SimCity 4** | Bâtiments 3D détaillés et variés par sous-type et richesse, saisons, ombres portées, zoom rapproché sur les habitants. |
