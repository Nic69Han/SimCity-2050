# Déploiement (Netlify)

Site : https://simcity-2050.netlify.app (projet Netlify `simcity-2050`, id `7b6b283c-fc3b-4f1a-8a5f-df7364f3f5d0`).

## Automatique
`.github/workflows/ci.yml`, job `deploy` : à chaque push sur `main` (donc à chaque fusion de PR), **après** que les jobs
`test` (tests, clippy, comparaisons avec le moteur C++ d'origine) et `e2e` (navigateur) sont verts, la page est
assemblée (`scripts/package-web.sh` → `dist/`) et publiée en production avec la CLI Netlify, puis un test de fumée
vérifie le site en ligne. Une PR ou une branche ne déploie rien.

### Réglage unique (à faire une fois)
Le job a besoin d'un jeton Netlify, que seul le propriétaire du compte peut créer :
1. Netlify → *User settings* → *Applications* → *Personal access tokens* → *New access token*.
2. GitHub → dépôt → *Settings* → *Secrets and variables* → *Actions* → *New repository secret* :
   nom `NETLIFY_AUTH_TOKEN`, valeur = le jeton.
(L'identifiant du site est déjà dans le workflow ; pour changer de site, définir la variable de dépôt `NETLIFY_SITE_ID`.)
Tant que le secret n'existe pas, le job `deploy` se termine proprement en indiquant qu'il est ignoré.

## Manuel
`./scripts/package-web.sh` puis `npx netlify-cli@27.12.0 deploy --dir=dist --prod --site <id>` (après `netlify login`).
