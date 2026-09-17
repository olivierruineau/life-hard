import { bucketByCell } from './movement.ts';
import { crossoverGenome, genomeDistance, type Genome } from './genetics.ts';
import type { Rng } from './random.ts';
import type { World } from './world.ts';

export interface Mate {
  x: number;
  y: number;
  energy: number;
  cooldown: number;
  genome: Genome;
}

export interface ReproductionParams {
  minLitterSize: number;
  /** Total energy cost of a litter of size 1; larger litters cost more than proportionally. */
  litterCostBase: number;
  /** Exponent applied to litter size in the cost formula (>1 makes bigger litters disproportionately costly). */
  litterCostExponent: number;
  /** Fraction of the per-child cost the newborn actually receives as starting energy. */
  childEnergyEfficiency: number;
  /** Ticks a parent must wait before it can mate again. */
  reproductionCooldown: number;
  /** Radius (in cells) within which two eligible individuals can find each other and mate. */
  matingRadius: number;
  /** Max normalized genetic distance (see genomeDistance) at which two individuals can still interbreed. */
  maxMatingDistance: number;
}

export interface MatingEvent {
  x: number;
  y: number;
  litterSize: number;
  childEnergy: number;
  genome: Genome;
}

function litterCost(litterSize: number, params: ReproductionParams): number {
  return params.litterCostBase * litterSize ** params.litterCostExponent;
}

/**
 * Finds compatible eligible pairs among `individuals` (grouped by proximity)
 * and settles each mating: pays the (litter-size-dependent) energy cost from
 * both parents, sets their cooldown, and returns one event per successful
 * pairing describing the litter to spawn.
 */
export function performMating<T extends Mate>(
  individuals: T[],
  world: World,
  params: ReproductionParams,
  matingEnergyThreshold: (individual: T) => number,
  maxLitterSizeFor: (individual: T) => number,
  rng: Rng,
): MatingEvent[] {
  const buckets = bucketByCell(individuals, world);
  const isEligible = (ind: T) => ind.cooldown === 0 && ind.energy >= matingEnergyThreshold(ind);
  const paired = new Set<number>();
  const events: MatingEvent[] = [];
  const r = params.matingRadius;

  for (let i = 0; i < individuals.length; i++) {
    if (paired.has(i)) continue;
    const ind = individuals[i];
    if (!isEligible(ind)) continue;

    let partnerIndex = -1;
    outer: for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = ind.x + dx;
        const ny = ind.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const bucket = buckets.get(world.index(nx, ny));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i || paired.has(j)) continue;
          const candidate = individuals[j];
          if (!isEligible(candidate)) continue;
          if (genomeDistance(ind.genome, candidate.genome) > params.maxMatingDistance) continue;
          partnerIndex = j;
          break outer;
        }
      }
    }

    if (partnerIndex === -1) continue;
    const partner = individuals[partnerIndex];

    const maxLitter = Math.max(
      params.minLitterSize,
      Math.round((maxLitterSizeFor(ind) + maxLitterSizeFor(partner)) / 2),
    );
    const litterSize = params.minLitterSize + Math.floor(rng() * (maxLitter - params.minLitterSize + 1));
    const totalCost = litterCost(litterSize, params);
    const costEach = totalCost / 2;

    ind.energy -= costEach;
    partner.energy -= costEach;
    ind.cooldown = params.reproductionCooldown;
    partner.cooldown = params.reproductionCooldown;
    paired.add(i);
    paired.add(partnerIndex);

    events.push({
      x: ind.x,
      y: ind.y,
      litterSize,
      childEnergy: (totalCost / litterSize) * params.childEnergyEfficiency,
      genome: crossoverGenome(ind.genome, partner.genome, rng),
    });
  }

  return events;
}
