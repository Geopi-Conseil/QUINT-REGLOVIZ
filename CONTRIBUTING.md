# Contribuer

Merci de l'intérêt porté à ce projet. Quelques règles simples pour contribuer
efficacement.

## Signaler une erreur sur un bâtiment ou une donnée

Ouvrir une *issue* avec :

- l'adresse ou l'identifiant BD TOPO du bâtiment concerné (visible dans le
  panneau « Détails techniques » de la fiche bâtiment) ;
- la nature de l'erreur constatée ;
- si possible, une source permettant de la corriger (règlement du PPRi,
  cadastre, constat terrain...).

Les corrections de données se font en amont, dans le projet QGIS source, puis
sont republiées via `scripts/export_geojson.py` (voir `docs/METHODOLOGIE.md`).
Ne pas modifier les fichiers `data/*.geojson` à la main.

## Proposer une évolution du code (`src/`)

- Le projet est volontairement **sans dépendance de build** : merci de ne
  pas introduire de framework ou d'étape de compilation sans en discuter au
  préalable dans une *issue*.
- Respecter le style existant (JavaScript vanilla, CSS avec variables,
  commentaires en français comme le reste du projet).
- Toute nouvelle information affichée dans la fiche bâtiment doit rester
  compréhensible par un particulier sans vocabulaire technique préalable :
  les détails techniques vont dans le bloc `<details>` dédié.
- Tester au minimum sur un viewport mobile étroit (< 400 px) et sur desktop
  avant de proposer une modification d'interface.

## Adapter l'outil à une autre commune

Voir la section « Reproduire pour une autre commune » de
[`docs/METHODOLOGIE.md`](docs/METHODOLOGIE.md). Une *issue* de suivi par
commune adaptée est bienvenue pour centraliser les retours.

## Code de conduite

Merci de rester courtois et factuel, en particulier sur un sujet aussi
sensible que la prévention des risques naturels. Toute contribution devra
respecter la portée strictement informative de l'outil (voir
`mentions-legales.html`) : ne jamais présenter une information calculée par
l'outil comme ayant valeur réglementaire opposable.
