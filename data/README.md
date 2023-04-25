# Données

Toutes les données utilisées sont dans `data/raw/`. Elles ne sont jamais modifiées : le
nettoyage se fait à la lecture, dans `src/kerala_rain/data.py`.

| Fichier | Contenu | Source | Licence |
|---|---|---|---|
| `kerala_rainfall_1901_2017.csv` | Pluie mensuelle, saisonnière et annuelle (mm) de la sous-division météorologique « Kerala », 1901–2017 | India Meteorological Department (IMD), diffusé sur [data.gov.in](https://data.gov.in) | Government Open Data License – India |
| `india_temperatures_1901_2017.csv` | Températures mensuelles, saisonnières et annuelles (°C) de l'Inde entière, 1901–2017 | IMD, diffusé sur data.gov.in | Government Open Data License – India |
| `kerala_floods_2018_districts.csv` | Inondations d'août 2018 par district : décès, camps de secours, pluie observée et normale, glissements de terrain, maisons détruites | Non documentée dans la première version du projet | Non précisée |
| `imd_kerala_monsoon_2018.csv` | Pluie observée et normale à l'échelle du Kerala, de juin à septembre 2018 | IMD, Regional Meteorological Centre Chennai, [*Regional report on southwest monsoon – 2018 over the southern peninsular India*](https://mausam.imd.gov.in/chennai/mcdata/sw_monsoon_2018.pdf) (2019), tableaux 1 et 2 | Chiffres extraits d'une publication officielle, cités avec leur source |
| `land_use_1914_1967_2007.csv` | Occupation du sol (km²) d'une zone d'étude de 483,4 km² en 1914, 1967 et 2007 | Très probablement Sheeja R. V. *et al.* (2011), *International Journal of Digital Earth*, 4(3), 258–270 (bassin de la rivière Neyyar, sud du Kerala) | Extrait d'article scientifique |
| `kerala_districts.geojson` | Contours simplifiés des 14 districts du Kerala (WGS84) | [DataMeet India](https://github.com/datameet/maps), via [geohacker/kerala](https://github.com/geohacker/kerala), simplifiés par `scripts/prepare_districts.py` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## Précisions

**Pluie (`kerala_rainfall_1901_2017.csv`).** Une ligne par année. `JAN` … `DEC` : pluie
mensuelle ; `ANNUAL` : total annuel ; `JF`, `MAM`, `JJAS`, `OND` : totaux saisonniers (hiver,
pré-mousson, mousson du sud-ouest, mousson du nord-est). La somme des mois retrouve le total
annuel à 0,3 mm près (arrondis de la source).

**Températures (`india_temperatures_1901_2017.csv`).** Même structure, saisons nommées
`JAN-FEB`, `MAR-MAY`, `JUN-SEP`, `OCT-DEC` (renommées `JF`, `MAM`, `JJAS`, `OND` à la lecture).
Le fichier ne précise pas la nature de la température. Ses valeurs annuelles (28,1 à 31,6 °C)
dépassent nettement la température moyenne de l'Inde (environ 25 °C) : il s'agit très
probablement de la moyenne des températures **maximales** journalières. La série couvre toute
l'Inde, pas seulement le Kerala.

**Inondations (`kerala_floods_2018_districts.csv`).** `fatalities` : décès ; `no_of_camps` :
camps de secours ; `actual_rainfall_in_mm` / `normal_rainfall_in_mm` : pluie observée et
normale ; `no_of_landslides` : glissements de terrain ; `full_damaged_houses` : maisons
entièrement détruites. La période n'est pas indiquée : la moyenne des districts pondérée par
leur surface (833 mm observés, 421 mm normaux) concorde avec le chiffre de l'IMD pour le Kerala
en août 2018 (821,9 mm pour 419,5 mm), ce qui confirme que le tableau couvre ce mois. Le district
de Kasaragod y est orthographié « Kasaragode » (harmonisé à la lecture).

**Occupation du sol (`land_use_1914_1967_2007.csv`).** Tableau mis en page : en-tête sur deux
lignes, cellules vides (espaces insécables) pour les niveaux répétés, lignes de sous-totaux et
total (483,437 km² chaque année). Une cellule vide signifie que la classe n'a pas été relevée
cette année-là. La superficie et les dates correspondent à l'étude du bassin de la Neyyar
(cartes topographiques de 1914 et 1967, images satellite de 2006–2007).

**Contours (`kerala_districts.geojson`).** Chaque frontière partagée par deux districts est
simplifiée une seule fois (tolérance 0,004°, environ 400 m), puis les polygones sont
reconstruits : la carte n'a ni trou ni chevauchement. Surface totale obtenue : 38 800 km²
(superficie officielle : 38 863 km²).
