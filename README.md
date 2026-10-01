# Mes obligations face au risque inondation - Quint-Fonsegrives

Webmap indépendante qui aide les habitants, les gestionnaires d'établissements
recevant du public (ERP) ou d'activités, ainsi que les élus et techniciens, à
comprendre **les obligations réglementaires qui s'appliquent à un bâtiment**
au titre du Plan de Prévention des Risques naturels d'inondation (PPRi)
« Marcaissonne-Sauneseillonne » (Quint-Fonsegrives, Haute-Garonne,
approuvé le 18/04/2016).

➡️ Cliquer sur un bâtiment sur la carte (ou rechercher une adresse) affiche
la zone réglementaire, le régime applicable, le diagnostic de vulnérabilité
attendu, l'obligation éventuelle de zone refuge, les seuils de travaux sur
l'existant, et l'éligibilité indicative au Fonds Barnier.

**⚠️ Outil non officiel**, à vocation pédagogique : voir
[`mentions-legales.html`](mentions-legales.html) et
[`docs/METHODOLOGIE.md`](docs/METHODOLOGIE.md) pour les sources, la
méthode de calcul et les limites.

## Aperçu

| | |
|---|---|
| **Public visé** | Particuliers, gestionnaires d'ERP/activités, élus, techniciens |
| **Stack** | HTML/CSS/JS statique, sans framework ni étape de build ; [Leaflet](https://leafletjs.com/) pour la carte |
| **Données** | GeoJSON statiques dans `data/`, régénérées depuis QGIS |
| **Hébergement** | N'importe quel hébergeur de fichiers statiques (GitHub Pages, Netlify, serveur mutualisé...) |

## Choix d'expérience utilisateur (UX)

- **Divulgation progressive plutôt qu'un sélecteur de profil.** Plutôt que de
  proposer trois parcours distincts (particulier / gestionnaire / élu),
  coûteux à maintenir et à tenir à jour de façon cohérente, chaque fiche
  bâtiment affiche d'abord une réponse courte, en langage clair, puis des
  sections dépliables (diagnostic, zone refuge, travaux, aides financières)
  et un bloc « détails techniques » replié par défaut, à l'attention des
  élus/techniciens/bureaux d'études. Un particulier n'a jamais besoin
  d'ouvrir les détails techniques pour comprendre l'essentiel.
- **Mobile-first et responsive.** Sur petit écran, la carte occupe tout
  l'espace disponible et le panneau d'information est un « bottom sheet »
  (tiroir remontant du bas) ; sur écran large, il devient un panneau latéral
  fixe. Aucune fonctionnalité n'est réservée au desktop.
- **Recherche d'adresse.** Un particulier ne sait pas toujours situer son
  bâtiment sur une carte : la recherche d'adresse (Base Adresse Nationale) et
  la géolocalisation permettent d'atteindre directement sa fiche.
- **Accessibilité de base** : lien d'évitement, contrastes de couleur
  vérifiés, zones cliquables ≥ 40 px, focus clavier visible, attributs ARIA
  sur les contrôles de carte et le panneau. À approfondir (voir
  [Pistes d'amélioration](#pistes-damélioration)).
- **Pas de logo ni de charte « République française ».** Pour éviter toute
  confusion avec une communication officielle de l'État ou de la mairie, le
  site s'identifie clairement comme un outil indépendant, avec un bandeau de
  rappel et un lien systématique vers les mentions légales.
- **Tableau de bord communal (élus, techniciens).** Section dépliable
  accessible depuis la carte (icône 📊), complémentaire à la fiche par
  bâtiment : agrégats communaux (ERP en zone, bâtiments soumis à obligation
  de zone refuge, fiabilité des données, éligibilité FPRNM, répartition par
  zone réglementaire...). Chaque donnée est cliquable et surligne sur la
  carte les bâtiments/ERP correspondants, calculée côté client à partir des
  mêmes GeoJSON (aucune source ni traitement serveur supplémentaire).
- **Correction déclarative par le visiteur.** Sur chaque fiche bâtiment en
  zone réglementée, un bloc dépliable permet de préciser la présence d'un
  étage et le type d'occupation (voir `docs/METHODOLOGIE.md` §9) : l'outil
  recalcule alors la zone refuge et les obligations avec les mêmes règles
  que pour un bâtiment classé automatiquement. Correction 100% côté client,
  gardée uniquement dans le navigateur du visiteur (`localStorage`), jamais
  envoyée ni partagée.

## Démarrage rapide

Site 100 % statique : aucune compilation n'est nécessaire. Pour le tester en
local (obligatoire pour que les fichiers `data/*.geojson` se chargent : un
simple double-clic sur `index.html` ne fonctionnera pas à cause des règles
CORS des navigateurs sur `file://`) :

```bash
# Python (déjà présent sur la plupart des systèmes)
python3 -m http.server 8000

# ou avec Node.js
npx serve .
```

Puis ouvrir `http://localhost:8000`.

## Déploiement

Le dossier peut être publié tel quel sur n'importe quel hébergeur statique :

- **GitHub Pages** : `Settings > Pages`, déployer depuis la branche
  principale (racine du dépôt).
- **Netlify / Vercel** : importer le dépôt, aucune commande de build à
  renseigner, dossier de publication = racine.
- **Serveur mutualisé / mairie** : copier l'intégralité du dossier par FTP.

## Structure du dépôt

```
index.html                 Page principale (carte interactive)
glossaire.html              Définitions des termes du PPRi
faq.html                    Questions fréquentes
mentions-legales.html       Portée, limites, sources, licences
src/
  css/style.css              Styles (mobile-first, variables CSS)
  js/app.js                  Logique de la carte (chargement des données,
                              sélection de bâtiment, recherche, légende)
  js/nav.js                  Menu mobile partagé par les pages de contenu
data/
  batiments_ppri.geojson       Bâtiments touchés par le zonage (détaillés)
  batiments_hors_zone.geojson  Autres bâtiments (géométrie seule)
  zonage_pprin.geojson         Polygones des zones réglementaires
  erp.geojson                  Établissements recevant du public (vide, voir faq.html)
  hauteur_eau.geojson          Hauteur d'eau estimée (polygones classés)
scripts/
  export_geojson.py          Script PyQGIS de régénération des GeoJSON
docs/
  METHODOLOGIE.md             Méthode de calcul, dictionnaire des champs,
                               limites connues, guide pour adapter l'outil
                               à une autre commune
qgis-project/                (à ajouter, voir ci-dessous) projet QGIS source
```

> Le projet QGIS source (`.qgz` + GeoPackage) qui a servi à produire les
> données n'est pas inclus dans cette première version du dépôt (fichiers
> volumineux). Voir [Étapes suivantes](#étapes-suivantes).

## Mettre à jour les données

1. Ouvrir le projet QGIS source (couches bâti / zonage / ERP enrichies).
2. Exécuter `scripts/export_geojson.py` dans la console Python de QGIS.
3. Vérifier les tailles de fichiers générés dans `data/` (chaque export
   affiche sa taille).
4. Tester en local (`python3 -m http.server`) avant de publier.

Le détail de la méthode de calcul (règle du bâtiment le plus contraignant,
seuils de travaux, éligibilité FPRNM, enrichissement BDNB des bâtiments non
classés par BD TOPO, etc.) est documenté dans
[`docs/METHODOLOGIE.md`](docs/METHODOLOGIE.md).

## Sources et licences des données

Voir le détail complet dans [`mentions-legales.html`](mentions-legales.html).
En résumé : PPRi (DDT de la Haute-Garonne, données publiques), BD TOPO® ©
IGN (licence ouverte Etalab), [BDNB](https://bdnb.io/) (CSTB/ADEME, Fichiers
Fonciers, Licence Ouverte 2.0, complète la typologie des bâtiments non
classés par BD TOPO, voir `docs/METHODOLOGIE.md` §10), Modèle Numérique de
Terrain LiDAR HD © IGN (licence ouverte Etalab, hauteur d'eau estimée, voir
`docs/METHODOLOGIE.md` §8), fond de carte © contributeurs OpenStreetMap,
recherche d'adresse via l'API Adresse (Etalab).

## Licence du code

Voir [`LICENSE`](LICENSE) (MIT). Les données du dossier `data/` restent
soumises aux licences de leurs producteurs respectifs (voir ci-dessus), plus
restrictives sur certains points (attribution obligatoire notamment).

## Pistes d'amélioration

- Intégrer les établissements recevant du public (ERP) pour cette commune
  (aucune source identifiée à ce jour, voir `faq.html`).
- Audit d'accessibilité complet (contraste automatisé, lecteur d'écran,
  navigation clavier exhaustive sur la carte Leaflet).
- Bascule vers des tuiles vectorielles si le nombre de bâtiments augmente
  significativement (au-delà de quelques dizaines de milliers, le GeoJSON
  statique montrera ses limites).
- Ajouter le projet QGIS source et le GeoPackage au dépôt (ou à un stockage
  Git LFS / dépôt de données séparé) pour une traçabilité complète.
- Page "atlas imprimable" par secteur, pour les réunions publiques.
- Réduire encore les 64 bâtiments de typologie indéterminée restants (voir
  `docs/METHODOLOGIE.md` §9 et §10) : croisement cadastral complémentaire,
  ou vérification terrain ciblée sur les bâtiments en zone réglementée.
- Publier le raster continu de hauteur d'eau (en plus des polygones
  classés déjà intégrés), voir `docs/METHODOLOGIE.md` §8.

## Contribuer

Voir [`CONTRIBUTING.md`](CONTRIBUTING.md).
