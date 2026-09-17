import type { Rng } from './random.ts';
import type { World } from './world.ts';

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/**
 * Picks a one-step move: toward the richest land cell within vision (as
 * measured by `scoreAt`), falling back to a random land step, and only
 * entering water when no land option exists.
 */
export function chooseGreedyMove(
  world: World,
  x: number,
  y: number,
  visionRadius: number,
  scoreAt: (x: number, y: number) => number,
  rng: Rng,
): [number, number] {
  let bestScore = -1;
  let bestX = x;
  let bestY = y;

  for (let dy = -visionRadius; dy <= visionRadius; dy++) {
    for (let dx = -visionRadius; dx <= visionRadius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!world.inBounds(nx, ny) || world.isWater(nx, ny)) continue;
      const score = scoreAt(nx, ny);
      if (score > bestScore) {
        bestScore = score;
        bestX = nx;
        bestY = ny;
      }
    }
  }

  const landCandidates: Array<[number, number]> = [];
  const waterCandidates: Array<[number, number]> = [];
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!world.inBounds(nx, ny)) continue;
    (world.isWater(nx, ny) ? waterCandidates : landCandidates).push([dx, dy]);
  }

  if (bestScore > 0) {
    return [Math.sign(bestX - x), Math.sign(bestY - y)];
  }

  if (landCandidates.length > 0) {
    return landCandidates[Math.floor(rng() * landCandidates.length)];
  }
  if (waterCandidates.length > 0) {
    return waterCandidates[Math.floor(rng() * waterCandidates.length)];
  }
  return [0, 0];
}

/** Groups individuals' indices by the cell they occupy. */
export function bucketByCell<T extends { x: number; y: number }>(
  individuals: T[],
  world: World,
): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < individuals.length; i++) {
    const key = world.index(individuals[i].x, individuals[i].y);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }
  return buckets;
}
