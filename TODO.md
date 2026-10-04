# TODO

## Évolutions envisagées

- **Couche trophique supplémentaire** (à discuter avant de coder) :
  - décomposeur : les cadavres rendent de la fertilité au sol (aujourd'hui un
    individu mort disparaît sans rien restituer, le cycle des nutriments est ouvert) ;
  - ou super-prédateur chassant les prédateurs actuels (cascade trophique).
  Attention au budget énergétique : chaque échelon n'en retient qu'une fraction,
  un échelon de plus risque de ne jamais persister (les prédateurs actuels ont
  déjà demandé rééquilibrage + migration depuis le bord).
- Événements : sécheresse, incendie.
- Graphique : légende et axes (l'inspecteur est fait, pas la légende).
- Sauvegarde / chargement d'une simulation + export CSV des populations.

## Pistes d'équilibrage

- L'immigration des herbivores reste l'ancien mécanisme à seuil
  (`immigrationThreshold`) ; le passer sur le modèle de `migrateFromEdge`.
- ~2 runs sur 16 dépassent encore 1500 herbivores (non diagnostiqué).
