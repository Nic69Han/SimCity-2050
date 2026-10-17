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

## Sons (web/sounds/)

* **Packs** : Interface Sounds (1.0), Digital Audio, Sci-Fi Sounds (1.0), par Kenney (kenney.nl).
* **Pages** : https://kenney.nl/assets/interface-sounds , https://kenney.nl/assets/digital-audio ,
  https://kenney.nl/assets/sci-fi-sounds
* **Licence** : CC0 1.0 (domaine public). Vérifiée sur chaque page (« Creative Commons CC0 ») et dans
  le fichier `License.txt` de chaque pack. Texte reproduit dans `web/sounds/LICENSE-kenney.txt`.
* **Import** : 2026-10-16.
* **Fichiers** (copies renommées ; nom d'origine dans le pack) :

| Fichier | Origine (pack : fichier) | Usage |
|---|---|---|
| `ui-click.ogg` | Interface Sounds : `click_001.ogg` | clic sur un bouton |
| `ui-refused.ogg` | Interface Sounds : `error_004.ogg` | construction refusée (emplacement occupé, impossible) |
| `ui-no-money.ogg` | Interface Sounds : `error_006.ogg` | pas assez d'argent |
| `city-siren.ogg` | Digital Audio : `highUp.ogg` | sirène (approximation : sweep montant) |
| `city-honk.ogg` | Digital Audio : `twoTone1.ogg` | klaxons (trois hauteurs) |
| `city-fog-horn.ogg` | Digital Audio : `lowThreeTone.ogg` | corne de brume |
| `city-monster.ogg` | Sci-Fi Sounds : `spaceEngineLow_000.ogg` | monstre (approximation : grondement) |
| `city-explosion-low.ogg` | Sci-Fi Sounds : `explosionCrunch_000.ogg` | explosion légère |
| `city-explosion-high.ogg` | Sci-Fi Sounds : `lowFrequency_explosion_000.ogg` | explosion forte |
| `city-traffic.ogg` | Sci-Fi Sounds : `engineCircular_000.ogg` | trafic dense (approximation : moteur) |

Poids total : environ 360 Ko. Le pack Impact Sounds (Kenney, CC0) n'est pas utilisé.
