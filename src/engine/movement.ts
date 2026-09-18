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
 *
 * `stayThreshold` (fraction, default 0) is how much better the best visible cell must be than the
 * current one before it's worth moving for. At 0 (predators, and herbivores with no threshold
 * passed) any positive improvement is chased, which is right for tracking real local depletion.
 * A nonzero threshold makes shallow, sustained gradients (like a mild seasonal biomassMax swing
 * spread over many rows) too marginal to act on tick after tick, while a real difference (a
 * genuinely richer patch, a locally grazed-out cell) still clears it easily — without that, any
 * persistent directional pull, however faint per step, eventually drags an entire population
 * across the map one cell at a time since nothing here weighs the move against its cost.
 */
export function chooseGreedyMove(
  world: World,
  x: number,
  y: number,
  visionRadius: number,
  scoreAt: (x: number, y: number) => number,
  rng: Rng,
  stayThreshold = 0,
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

  if (bestScore > 0) {
    if (stayThreshold > 0) {
      const currentScore = world.isWater(x, y) ? 0 : scoreAt(x, y);
      if (bestScore <= currentScore * (1 + stayThreshold)) return [0, 0];
    }
    return [Math.sign(bestX - x), Math.sign(bestY - y)];
  }

  return randomLandStep(world, x, y, rng);
}

/** A random one-step move onto land when possible, only entering water if no land neighbor exists. */
export function randomLandStep(world: World, x: number, y: number, rng: Rng): [number, number] {
  const landCandidates: Array<[number, number]> = [];
  const waterCandidates: Array<[number, number]> = [];
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!world.inBounds(nx, ny)) continue;
    (world.isWater(nx, ny) ? waterCandidates : landCandidates).push([dx, dy]);
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
