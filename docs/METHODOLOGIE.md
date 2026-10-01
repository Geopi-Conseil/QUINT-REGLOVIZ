# Méthodologie

Ce document décrit comment les données affichées par la webmap sont
construites, pour permettre à un technicien ou un contributeur de les
vérifier, les corriger ou les reproduire sur une autre commune.

## 1. Chaîne de traitement

```
PPRi approuvé (règlement + zonage réglementaire, DDT de la Haute-Garonne)
        │
        ▼
Zonage réglementaire (Bi/Ji/Ri/GHi/Pi) ──┐
                                          │  jointure spatiale (bâtiment ↔
BD TOPO® IGN (bâtiments) ────────────────┤  zone qui le contient) +
                                          │  règlement par zone (régime,
Isocotes PHE (cotes de crue historique) ─┤  zone refuge, diagnostic,
                                          │  éligibilité FPRNM, étude
MNT LiDAR HD © IGN (altimétrie) ─────────┘  géotechnique G2, hauteur d'eau)
        │
        ▼
GeoPackage QGIS (projet source) : couches enrichies
        │
        ▼
scripts/export_geojson.py  (reprojection EPSG:4326, nettoyage des champs)
        │
        ▼
data/*.geojson  →  consommés par src/js/app.js
```

## 2. Attribution de la zone réglementaire

Chaque bâtiment est rattaché, par jointure spatiale, à la zone du PPRi
« Marcaissonne-Sauneseillonne » dans laquelle il se trouve (`zoneCode` :
`Bi`, `Ji`, `Ri`, `GHi` ou `Pi` — voir le glossaire pour le détail de ces
cinq zones). Les champs `regime`, `zoneRefuge`, `diagnostic`,
`eligibiliteFprnm` et `etudeGeotechniqueG2` reprennent, pour chaque zone, le
texte du règlement du PPRi applicable aux constructions existantes et
nouvelles (y compris les seuils de travaux, exprimés directement dans le
texte du régime plutôt que sous forme de champs numériques séparés). Ces
textes sont identiques pour tous les bâtiments d'une même zone ; ils ne sont
pas recalculés par bâtiment.

Répartition des 257 bâtiments concernés par le zonage, par zone (donnée au
09/2026) :

| Zone | Bâtiments |
|---|---|
| Bi (Bleue) | 208 |
| Ji (Jaune) | 22 |
| Ri (Rouge) | 18 |
| GHi (Grise hachurée, crue historique) | 9 |
| Pi (Pourpre) | 0 (zone non bâtie sur la commune à ce jour) |

La zone refuge n'est pas applicable en zone GHi (crue historique, régime de
prescriptions géotechniques plutôt que de cote de référence) : les champs
`zoneRefuge` et `refugeCategorie` y sont absents.

## 3. Détermination de la présence d'un étage

Faute de donnée directe et exhaustive sur le nombre de niveaux habitables,
l'outil combine deux sources, par ordre de priorité :

1. **BD TOPO® - `nombre_d_etages`** (ou `nb_niveau` BDNB pour les bâtiments
   enrichis, §10) : quand disponible, une valeur ≥ 2 indique un étage (le
   rez-de-chaussée est compté comme le premier niveau).
2. **Estimation par la hauteur du bâti** (`hauteur`, BD TOPO) : à défaut de
   niveau déclaré, un seuil d'environ 5,1 à 5,3 m est utilisé (calibré
   empiriquement). Au-delà, présence d'un étage jugée probable, la
   fiabilité de cette estimation étant qualifiée de « modérée » dans le
   champ `etageSource` (ex. `"estime par la hauteur (5.1 m), fiabilite
   moderee"`).

Sur les 257 bâtiments concernés : 115 ont un étage (`Oui`), 137 n'en ont pas
(`Non`), 5 restent `Inconnu`.

Si aucune des sources n'est disponible, le champ `etagePresent` vaut
`"Inconnu"`.

## 4. Zone refuge

Le texte du champ `zoneRefuge` est celui du règlement du PPRi pour la zone
concernée. Pour Quint-Fonsegrives, la règle retenue en zones Bi/Ji/Ri est
**conditionnelle** : si le plancher ne peut pas être calé au-dessus des
plus hautes eaux connues (PHEC) — impossibilité fonctionnelle dûment
justifiée — un niveau refuge adapté est exigé (20 m² minimum, hauteur
1,80 m minimum). `refugeCategorie` en donne le résumé affiché dans la
fiche bâtiment.

## 5. Régime et seuils de travaux

Contrairement à une approche par seuils numériques calculés par bâtiment,
les seuils de travaux applicables (extensions, annexes, changement de
destination...) sont donnés **verbatim dans le champ `regime`**, qui
reprend le texte du règlement de la zone concernée (constructions nouvelles
/ constructions existantes). Aucun champ `empriseSolM2` séparé n'est donc
calculé pour cette commune ; l'emprise au sol n'intervient pas dans les
seuils du règlement de ce PPRi.

## 6. Éligibilité au Fonds Barnier (FPRNM)

Estimation indicative basée sur la typologie d'occupation déduite de
`typologie` (BD TOPO ou BDNB, voir §10) :

- **Habitation** (maison individuelle ou logement collectif) → éligible à
  80 %, plafond 36 000 €/bien ;
- **Activité économique de moins de 20 salariés** → éligible à 20 % (taux à
  vérifier au cas par cas, l'effectif n'étant pas connu depuis les données
  géographiques) ;
- **Typologie indéterminée** → non déterminé, à qualifier sur site.

Dans tous les cas, l'éligibilité réelle suppose un bien existant avant la
date d'approbation du PPRi (18/04/2016) et reste soumise à instruction par
la DDT de la Haute-Garonne.

## 7. Étude géotechnique G2

Spécifique à la zone GHi (crue historique) : le champ `etudeGeotechniqueG2`
(booléen) signale les 9 bâtiments pour lesquels le règlement impose une
étude géotechnique G2 AVP (norme NF P 94-500) avant toute construction
nécessitant des fondations, que ce soit pour le neuf ou l'existant.

## 8. Hauteur d'eau estimée (crue de référence)

Champs : `hauteurEauEstimeeM`, `hauteurEauNote`, `altitudeSolLidarHdM`,
`coteReferencePheM`, `coteReferenceMethode`, `distanceIsocoteM`.

**Méthode :**

1. Les isocotes de la crue de référence (lignes de cote PHE géoréférencées,
   issues du dossier du PPRi) sont interpolées en une surface continue par
   triangulation (TIN, `QgsTinInterpolator`), donnant une cote de référence
   (m NGF) en tout point de la zone PPRi. `coteReferenceMethode` documente
   cette méthode (« TIN isocotes (interpolation linéaire entre lignes de
   cote) »).
2. L'altitude du sol est extraite du Modèle Numérique de Terrain LiDAR HD
   officiel de l'IGN (mosaïque de dalles 50 cm, précision verticale
   officielle de 10 cm), au centroïde de chaque bâtiment
   (`altitudeSolLidarHdM`). Le sol sous un bâtiment n'étant jamais mesuré
   directement (la toiture bloque le laser), cette valeur est elle-même
   interpolée par l'IGN à partir des points sol alentour — voir la
   [FAQ](../faq.html).
3. `hauteurEauEstimeeM` = `coteReferencePheM` − `altitudeSolLidarHdM`. Les
   valeurs négatives (terrain surélevé localement par rapport à la cote de
   référence interpolée à cet endroit : pas de submersion attendue pour
   cette crue de référence) sont ramenées à **0** dans l'affichage ; la note
   `hauteurEauNote` explicite le calcul et, le cas échéant, ce cas de figure.
4. `distanceIsocoteM` indique la distance entre le bâtiment et l'isocote la
   plus proche utilisée pour l'interpolation : plus cette distance est
   grande, moins l'estimation est fiable (sur les 257 bâtiments : distance
   moyenne 69 m, de 1 à 196 m).

**Résultat pour Quint-Fonsegrives :** sur 257 bâtiments concernés, 83 ont
une hauteur d'eau estimée strictement positive (moyenne 0,63 m, jusqu'à
1,64 m) ; 173 affichent 0 m (terrain localement au-dessus de la cote de
référence interpolée) ; 1 en zone Pi (sans bâtiment à ce jour, non
concerné).

C'est une **estimation indicative**, à vocation pédagogique : elle ne
remplace pas une étude hydraulique et n'a pas de valeur réglementaire
opposable. En cas de doute, le plan officiel des cotes PHE reste consultable
auprès de la DDT ou de la mairie.

En parallèle de la table par bâtiment, la même interpolation produit deux
couches cartographiques (`data/hauteur_eau.geojson`, non affichée par
défaut) : un raster continu de hauteur d'eau (résolution 2 m, non publié
dans ce dépôt pour limiter le poids du site) et des polygones classés en
4 classes (visibles sur la carte via la couche « Hauteur d'eau estimée »).

## 9. Limites connues

- 64 bâtiments restent en « Typologie indéterminée » (aucune correspondance
  BDNB trouvée, ou bâtiment également absent des Fichiers Fonciers, cas
  fréquent pour de petites annexes ou des constructions très récentes) : la
  donnée source ne permet pas de distinguer habitation / activité pour ces
  bâtiments sans visite terrain.
- Le calcul d'éligibilité FPRNM est indicatif ; il ne remplace pas
  l'instruction d'un dossier réel.
- Les seuils de travaux ne couvrent que les obligations relatives aux
  **biens existants** ; les règles applicables aux **projets neufs** (permis
  de construire) ne sont pas modélisées dans cet outil au-delà du texte du
  régime affiché.
- La hauteur d'eau estimée est une interpolation (isocotes PHE + MNT LiDAR
  HD), pas un calcul hydraulique réglementaire : elle est d'autant moins
  fiable que `distanceIsocoteM` est grand, et le sol sous un bâtiment est
  lui-même interpolé (voir §8).
- Aucune donnée ERP (établissements recevant du public) n'est encore
  intégrée pour cette commune.

## 10. Enrichissement par la BDNB (typologie, étages, logements)

BD TOPO® ne renseigne l'usage que pour une partie des bâtiments ; les
autres restent sans typologie ni nombre de logements exploitables. Pour
combler ce trou **sans changer de source principale**, ces bâtiments sont
croisés avec la [Base de Données Nationale des Bâtiments
(BDNB)](https://bdnb.io/), dont la table `batiment_groupe_ffo_bat` (source :
Fichiers Fonciers, DGFiP/Cerema) fournit `usage_niveau_1_txt`, `nb_niveau`
et `nb_log` pour un grand nombre de bâtiments absents de la classification
BD TOPO.

**Méthode :**

1. Requêter l'[API BDNB Open](https://www.data.gouv.fr/dataservices/api-bdnb-open)
   (gratuite, sans clé, `https://api.bdnb.io/v1/bdnb/donnees/…`, syntaxe
   PostgREST) filtrée sur `code_commune_insee=eq.31445` : **uniquement la
   commune concernée**, jamais un téléchargement département/national.
2. Pour chaque bâtiment sans typologie exploitable, jointure spatiale
   (centroïde, puis repli sur la plus grande intersection) avec les
   polygones `batiment_groupe` de la BDNB.
3. Traduction de `usage_niveau_1_txt` en trois grandes catégories, alignées
   sur celles déjà utilisées côté BD TOPO :

   | `usage_niveau_1_txt` (BDNB) | Catégorie retenue |
   |---|---|
   | Résidentiel individuel, Résidentiel collectif, Secondaire | Habitation |
   | Tertiaire & Autres | Activité économique |
   | Dépendance | Annexe (non habitée) |

   Le nombre de logements (`nb_log`) détermine ensuite « Maison
   individuelle » (0 ou 1) vs « Logement collectif (N logements) ». Le
   nombre de niveaux (`nb_niveau`) prend le pas sur l'estimation par
   hauteur du §3 lorsqu'il est connu.
4. Traçabilité : le champ `typologieSource` distingue "BD TOPO" (implicite,
   valeur par défaut) de `"BDNB (Fichiers Fonciers, millesime 2026-02.a)"`,
   affiché dans le panneau « Détails techniques » de chaque bâtiment
   concerné.

**Résultat pour Quint-Fonsegrives (millésime BDNB 2026-02.a) :** sur les
125 bâtiments initialement sans typologie exploitable (BD TOPO seule), 61
obtiennent une correspondance BDNB exploitable ; 64 restent indéterminés
(voir §9).

**Licence et attribution :** données BDNB sous Licence Ouverte / Open
Licence version 2.0 (Etalab), comme BD TOPO®. Voir `mentions-legales.html`.

## 11. Correction déclarative du visiteur

Pour les bâtiments concernés par le zonage réglementaire, la fiche propose
un bloc dépliable « Précisez votre bâtiment » : le visiteur qui connaît le
bâtiment mieux que les données publiques (§9) peut y indiquer la présence
d'un étage, et le type d'occupation (maison individuelle, logement
collectif avec son nombre de logements, local d'activité économique, ou
annexe non habitée).

**Fonctionnement :**

- Le calcul est entièrement effectué **côté client** (JavaScript,
  `src/js/app.js`), avec les **mêmes règles et les mêmes textes** que ceux
  déjà appliqués côté données pour un bâtiment nativement classé dans la
  même catégorie (zone refuge : §4 ; diagnostic, obligations, éligibilité
  FPRNM : §6).
- La correction est **enregistrée uniquement dans le navigateur du
  visiteur** (`localStorage`, clé `reglo-risques:corrections-batiments:v1`,
  indexée par l'identifiant BD TOPO du bâtiment) : elle n'est **jamais
  envoyée à un serveur, ni partagée avec les autres visiteurs**, et ne
  modifie jamais les fichiers `data/*.geojson` sources. Elle est retrouvée
  automatiquement si le même visiteur revient sur la même fiche depuis le
  même appareil, et peut être réinitialisée à tout moment.
- Elle ne porte que sur l'étage et la typologie/logements : les champs
  déterminés par la zone (régime, zone refuge, diagnostic, hauteur d'eau)
  ne sont pas modifiables par le visiteur.
- Comme le reste de l'outil, cette correction n'a **aucune valeur
  réglementaire opposable** (rappelé dans le panneau) : elle aide à mieux
  comprendre le cadre applicable, elle ne remplace pas une vérification
  officielle (service urbanisme, DDT).

## 12. Reproduire pour une autre commune

1. Récupérer le zonage réglementaire du PPRi et le règlement (texte par
   zone : régime, zone refuge, diagnostic, éligibilité FPRNM, prescriptions
   géotechniques).
2. Récupérer le bâti (BD TOPO® IGN) sur l'emprise de la commune.
3. Réaliser la jointure spatiale bâtiment ↔ zone (voir §2) et reporter le
   texte du règlement de chaque zone sur les bâtiments qu'elle contient.
4. Optionnel : reproduire l'enrichissement BDNB du §10 en remplaçant le code
   INSEE (`code_commune_insee=eq.<code INSEE>`) par celui de la nouvelle
   commune.
5. Optionnel : si des isocotes PHE géoréférencées sont disponibles,
   reproduire la méthode du §8 (TIN + MNT LiDAR HD) pour publier une
   hauteur d'eau estimée par bâtiment.
6. Adapter `scripts/export_geojson.py` (noms de couches, éventuels nouveaux
   champs) et régénérer `data/*.geojson`.
7. Mettre à jour `CONFIG.center` / `CONFIG.codeInsee` dans `src/js/app.js`.
