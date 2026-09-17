# life-hard

Simulation numérique de vie : grille 2D avec biomes générés par seed (relief,
eau, humidité), biomasse végétale comme ressource primaire, herbivores puis
prédateurs comme consommateurs primaire/secondaire, reproduction à deux avec
génétique et mutations entre générations.

## Stack

- TypeScript + Vite, rendu Canvas 2D, pas de framework UI.
- `src/engine/` : logique de simulation pure (pas de DOM). `src/render/` :
  rendu Canvas. `src/main.ts` : UI et boucle d'affichage.
- Le moteur (`Simulation`, `World`, `HerbivorePopulation`, ...) doit rester
  utilisable sans navigateur (testable en headless via `npx tsx`).

## Règles de travail

- **Un commit par fonctionnalité ou par correctif.** Ne pas grouper
  plusieurs changements sans rapport dans un seul commit. Message concis,
  qui explique le pourquoi plus que le quoi.
- Toujours faire passer `npx tsc --noEmit` avant de committer.
- Avant de considérer un changement de comportement de simulation comme
  terminé, valider empiriquement l'équilibre (ex: script `tsx` qui fait
  tourner `Simulation.step()` sur plusieurs centaines de ticks et affiche
  l'évolution de la population) plutôt que de se fier au seul typage.
- Pas de dépendances externes ajoutées sans raison forte : le moteur et le
  rendu doivent rester simples (vanilla TS + Canvas).
- Ne pas committer/pusher sans demande explicite de l'utilisateur.
