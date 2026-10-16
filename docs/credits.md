# Crédits

Ressources tierces embarquées dans le site. Licence vérifiée sur la page de chaque pack et dans son fichier
`License.txt` (copié dans `web/models/LICENSE-kenney.txt`) à la date d'import.

## Modèles 3D : Kenney (kenney.nl), CC0 1.0

Licence : Creative Commons Zero (CC0 1.0), http://creativecommons.org/publicdomain/zero/1.0/ . Usage personnel,
éducatif et commercial permis ; la mention « Kenney / www.kenney.nl » n'est pas obligatoire, elle est donnée ici.
Pages des packs : la mention « CC0 licensed » y figure, et chaque archive contient `License.txt` (CC0).

| Pack | Page | Version | Importé le | Fichiers utilisés (`web/models/<dossier>/`) |
|---|---|---|---|---|
| City Kit (Commercial) | https://kenney.nl/assets/city-kit-commercial | 2.1 | 2026-10-16 | `commercial/` : building-a, b, c, d, f, h, skyscraper-a, skyscraper-c, skyscraper-e |
| City Kit (Suburban) | https://kenney.nl/assets/city-kit-suburban | 2.0 | 2026-10-16 | `suburban/` : building-type-a, c, h, i, k, l, o, r, s ; tree-large, tree-small |
| City Kit (Industrial) | https://kenney.nl/assets/city-kit-industrial | 2.0 | 2026-10-16 | `industrial/` : building-d, e, f, g, h, i, j, k, n, o |

Chaque dossier contient aussi `Textures/colormap.png` (la texture des .glb du pack). Les modèles sont ceux des packs,
non modifiés (format GLB). Pack Roads non utilisé. Seuls les modèles utilisés sont conservés (2,9 Mo avec textures
et licence, budget 3 Mo).

## Three.js r170 : MIT

`web/vendor/three.module.min.js`, `OrbitControls.js`, `GLTFLoader.js`, `BufferGeometryUtils.js` (copiés de
`three@0.170.0`, imports réécrits vers `./three.module.min.js`). Licence : `web/vendor/three.LICENSE`.
