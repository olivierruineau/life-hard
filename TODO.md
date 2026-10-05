# TODO

## Évolutions envisagées

- **Super-prédateur** chassant les prédateurs actuels (cascade trophique). Les
  décomposeurs (cadavres) et les charognards sont faits. Attention au budget
  énergétique : un échelon au-dessus de prédateurs d'une cinquantaine
  d'individus n'a presque rien à capter, il faudra du rééquilibrage et sans
  doute de la migration.
- Sauvegarde / chargement d'une simulation + export CSV des populations.

## Pistes d'équilibrage

- Les « 1500+ herbivores » de certains seeds ne sont pas une explosion : le troupeau
  sature à ~0,5 herbivore par cellule de terre sur tous les seeds de l'audit
  (audit-0 : 4623 cases de plaine sur 5636 de terre, ~2700 herbivores), avec
  biomasse à ~57 % du max et fertilité > 0,9. Garde-fou : `tests/capacity.test.ts`.
  Ne pas retoucher l'équilibre pour ça ; le seuil 1500 dépend juste de la taille de carte.
