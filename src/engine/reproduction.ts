import type { SpatialGrid } from './movement.ts';
import { crossoverGenes, genomeDistance } from './genetics.ts';
import type { Rng } from './random.ts';
import type { World } from './world.ts';

/** Structural view any SoA population (herbivore or predator) satisfies. */
export interface MatePopulation {
  length: number;
  x: Int32Array;
  y: Int32Array;
  energy: Float64Array;
  cooldown: Int32Array;
  geneSpeed: Float64Array;
  geneVision: Float64Array;
  geneFertility: Float64Array;
  geneEfficiency: Float64Array;
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
  geneSpeed: number;
  geneVision: number;
  geneFertility: number;
  geneEfficiency: number;
}

function litterCost(litterSize: number, params: ReproductionParams): number {
  return params.litterCostBase * litterSize ** params.litterCostExponent;
}

/**
 * Finds compatible eligible pairs among `pop` (grouped by proximity via the pre-built `grid`,
 * which the caller is responsible for having rebuilt from `pop`'s current positions this tick)
 * and settles each mating: pays the (litter-size-dependent) energy cost from both parents, sets
 * their cooldown, and returns one event per successful pairing describing the litter to spawn.
 */
export function performMating(
  pop: MatePopulation,
  grid: SpatialGrid,
  world: World,
  params: ReproductionParams,
  matingEnergyThreshold: (i: number) => number,
  maxLitterSizeFor: (i: number) => number,
  rng: Rng,
): MatingEvent[] {
  const isEligible = (i: number) => pop.cooldown[i] === 0 && pop.energy[i] >= matingEnergyThreshold(i);
  const paired = new Set<number>();
  const events: MatingEvent[] = [];
  const r = params.matingRadius;

  for (let i = 0; i < pop.length; i++) {
    if (paired.has(i)) continue;
    if (!isEligible(i)) continue;

    let partnerIndex = -1;
    outer: for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = pop.x[i] + dx;
        const ny = pop.y[i] + dy;
        if (!world.inBounds(nx, ny)) continue;
        const cell = world.index(nx, ny);
        for (let k = grid.cellStart(cell); k < grid.cellEnd(cell); k++) {
          const j = grid.sortedIndices[k];
          if (j === i || paired.has(j)) continue;
          if (!isEligible(j)) continue;
          const dist = genomeDistance(
            pop.geneSpeed[i], pop.geneVision[i], pop.geneFertility[i], pop.geneEfficiency[i],
            pop.geneSpeed[j], pop.geneVision[j], pop.geneFertility[j], pop.geneEfficiency[j],
          );
          if (dist > params.maxMatingDistance) continue;
          partnerIndex = j;
          break outer;
        }
      }
    }

    if (partnerIndex === -1) continue;
    const j = partnerIndex;

    const maxLitter = Math.max(
      params.minLitterSize,
      Math.round((maxLitterSizeFor(i) + maxLitterSizeFor(j)) / 2),
    );
    const litterSize = params.minLitterSize + Math.floor(rng() * (maxLitter - params.minLitterSize + 1));
    const totalCost = litterCost(litterSize, params);
    const costEach = totalCost / 2;

    pop.energy[i] -= costEach;
    pop.energy[j] -= costEach;
    pop.cooldown[i] = params.reproductionCooldown;
    pop.cooldown[j] = params.reproductionCooldown;
    paired.add(i);
    paired.add(j);

    const [geneSpeed, geneVision, geneFertility, geneEfficiency] = crossoverGenes(
      pop.geneSpeed[i], pop.geneVision[i], pop.geneFertility[i], pop.geneEfficiency[i],
      pop.geneSpeed[j], pop.geneVision[j], pop.geneFertility[j], pop.geneEfficiency[j],
      rng,
    );

    events.push({
      x: pop.x[i],
      y: pop.y[i],
      litterSize,
      childEnergy: (totalCost / litterSize) * params.childEnergyEfficiency,
      geneSpeed,
      geneVision,
      geneFertility,
      geneEfficiency,
    });
  }

  return events;
}
