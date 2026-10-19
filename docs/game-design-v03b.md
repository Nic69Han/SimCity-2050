# Conception du jeu : jalon v0.3b « vivant » (aller-retour et conseiller de la circulation)

Suite du v0.3 (docs/game-design-v03.md). Mêmes règles (docs/regles-de-code.md) : règle « Circulation simulée »
désactivée par défaut, moteur classique identique au C++, entiers et déterminisme, boucles bornées ;
développeur senior (Sonnet) pour le cœur, développeur cadré (Haiku) pour la page, relecture Opus avant
intégration.

## Ce que voit le joueur
Les voitures font l'aller-retour : le matin elles vont au travail, elles y restent un moment (garées, invisibles),
puis rentrent à la maison par le chemin le moins chargé. Les rues se chargent dans les deux sens. Le conseiller
d'urbanisme parle des bouchons mesurés et propose un remède (métro si la règle est active, sinon des routes
parallèles).

## Contrat (inchangé côté page)
L'API wasm du v0.3 ne change pas : `agent_rules`, `set_agent_rules`, `agent_stats` (5 entiers, même ordre),
`vehicles(max)`, `traffic_load()`. Un trajet terminé = une étape (aller **ou** retour) arrivée. Les voitures garées
ne sont ni dans `vehicles()` ni dans `voitures_actives`. Rien de nouveau n'est sauvegardé.

## Chantiers
| Chantier | Rôle | Fichiers |
|---|---|---|
| **Aller-retour et scénario de bouchons** | Sonnet (senior) | `crates/micropolis-core/src/agents/` (voitures garées au travail `WORK_TICKS`, recherche du retour prioritaire dans le budget de recherches par tick, plafond commun voitures roulantes + garées = `MAX_VEHICLES`), `crates/micropolis-core/tests/agents_*.rs`, section livrée de ce document |
| **Conseiller de la circulation** | Haiku (cadré) | `web/advisors-model.js`, `web/advisors.js` (lecture de `agent_stats` seulement si `agent_rules()` est vrai), `web/test/advisors*.test.mjs` |

## Critères d'acceptation
Comparaisons C++ identiques ; déterminisme ; conservation étendue (`lancées = roulantes + garées + terminées
définitivement + abandonnées`, à préciser par le cœur) ; plafonds respectés ; un scénario de test où des tuiles
saturent réellement et où la durée moyenne d'un trajet augmente avec la charge ; conseiller testé (règle éteinte →
rien, bouchons → attention puis urgent, remède selon la règle du métro) ; tous les tests verts ; relecture Opus.
