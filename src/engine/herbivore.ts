import type { Rng } from './random.ts';
import type { World } from './world.ts';

export interface Herbivore {
  x: number;
  y: number;
  energy: number;
  /** Ticks remaining before this individual can mate again. */
  cooldown: number;
}

export interface HerbivoreParams {
  initialEnergy: number;
  /** Energy spent per tick just to stay alive, regardless of action. */
  restMetabolism: number;
  /** Extra energy spent when stepping onto a land cell. */
  moveCost: number;
  /** Extra energy spent when stepping into water — much costlier than walking. */
  swimCost: number;
  eatRate: number;
  energyPerBiomass: number;
  /** Radius (in cells) scanned when looking for the richest nearby cell. */
  visionRadius: number;

  /** Minimum energy required to be eligible to mate. */
  matingEnergyThreshold: number;
  /** Radius (in cells) within which two eligible individuals can find each other and mate. */
  matingRadius: number;
  minLitterSize: number;
  maxLitterSize: number;
  /** Total energy cost of a litter of size 1; larger litters cost more than proportionally. */
  litterCostBase: number;
  /** Exponent applied to litter size in the cost formula (>1 makes bigger litters disproportionately costly). */
  litterCostExponent: number;
  /** Fraction of the per-child cost the newborn actually receives as starting energy. */
  childEnergyEfficiency: number;
  /** Ticks a parent must wait before it can mate again. */
  reproductionCooldown: number;
}

export const DEFAULT_HERBIVORE_PARAMS: HerbivoreParams = {
  initialEnergy: 50,
  restMetabolism: 1.6,
  moveCost: 0.6,
  swimCost: 4,
  eatRate: 5,
  energyPerBiomass: 0.5,
  visionRadius: 3,

  matingEnergyThreshold: 80,
  matingRadius: 1,
  minLitterSize: 1,
  maxLitterSize: 3,
  litterCostBase: 40,
  litterCostExponent: 1.5,
  childEnergyEfficiency: 0.55,
  reproductionCooldown: 30,
};

function litterCost(litterSize: number, params: HerbivoreParams): number {
  return params.litterCostBase * litterSize ** params.litterCostExponent;
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/**
 * Picks a one-step move: toward the richest land cell within vision, falling
 * back to a random land step, and only entering water when no land option exists.
 */
function chooseMove(world: World, h: Herbivore, params: HerbivoreParams, rng: Rng): [number, number] {
  const r = params.visionRadius;
  let bestScore = -1;
  let bestX = h.x;
  let bestY = h.y;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = h.x + dx;
      const ny = h.y + dy;
      if (!world.inBounds(nx, ny) || world.isWater(nx, ny)) continue;
      const score = world.biomass[world.index(nx, ny)];
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
    const nx = h.x + dx;
    const ny = h.y + dy;
    if (!world.inBounds(nx, ny)) continue;
    (world.isWater(nx, ny) ? waterCandidates : landCandidates).push([dx, dy]);
  }

  if (bestScore > 0) {
    return [Math.sign(bestX - h.x), Math.sign(bestY - h.y)];
  }

  if (landCandidates.length > 0) {
    return landCandidates[Math.floor(rng() * landCandidates.length)];
  }
  if (waterCandidates.length > 0) {
    return waterCandidates[Math.floor(rng() * waterCandidates.length)];
  }
  return [0, 0];
}

interface MatingEvent {
  x: number;
  y: number;
  litterSize: number;
  childEnergy: number;
}

export class HerbivorePopulation {
  readonly individuals: Herbivore[] = [];
  private readonly params: HerbivoreParams;

  constructor(params: HerbivoreParams) {
    this.params = params;
  }

  spawnRandom(world: World, count: number, rng: Rng): void {
    let attempts = 0;
    let placed = 0;
    while (placed < count && attempts < count * 50) {
      attempts++;
      const x = Math.floor(rng() * world.width);
      const y = Math.floor(rng() * world.height);
      if (world.isWater(x, y)) continue;
      this.individuals.push({ x, y, energy: this.params.initialEnergy, cooldown: 0 });
      placed++;
    }
  }

  private moveAndFeed(world: World, rng: Rng): void {
    for (const h of this.individuals) {
      h.energy -= this.params.restMetabolism;

      const [dx, dy] = chooseMove(world, h, this.params, rng);
      if (dx !== 0 || dy !== 0) {
        h.x += dx;
        h.y += dy;
        h.energy -= world.isWater(h.x, h.y) ? this.params.swimCost : this.params.moveCost;
      }

      if (!world.isWater(h.x, h.y)) {
        const eaten = world.consume(h.x, h.y, this.params.eatRate);
        h.energy += eaten * this.params.energyPerBiomass;
      }

      if (h.cooldown > 0) h.cooldown--;
    }
  }

  private mate(world: World, rng: Rng): MatingEvent[] {
    const params = this.params;
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < this.individuals.length; i++) {
      const h = this.individuals[i];
      const key = world.index(h.x, h.y);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }

    const isEligible = (h: Herbivore) => h.energy >= params.matingEnergyThreshold && h.cooldown === 0;
    const paired = new Set<number>();
    const events: MatingEvent[] = [];
    const r = params.matingRadius;

    for (let i = 0; i < this.individuals.length; i++) {
      if (paired.has(i)) continue;
      const h = this.individuals[i];
      if (!isEligible(h)) continue;

      let partnerIndex = -1;
      outer: for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = h.x + dx;
          const ny = h.y + dy;
          if (!world.inBounds(nx, ny)) continue;
          const bucket = buckets.get(world.index(nx, ny));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i || paired.has(j)) continue;
            if (!isEligible(this.individuals[j])) continue;
            partnerIndex = j;
            break outer;
          }
        }
      }

      if (partnerIndex === -1) continue;
      const partner = this.individuals[partnerIndex];

      const litterSize = params.minLitterSize + Math.floor(rng() * (params.maxLitterSize - params.minLitterSize + 1));
      const totalCost = litterCost(litterSize, params);
      const costEach = totalCost / 2;

      h.energy -= costEach;
      partner.energy -= costEach;
      h.cooldown = params.reproductionCooldown;
      partner.cooldown = params.reproductionCooldown;
      paired.add(i);
      paired.add(partnerIndex);

      events.push({
        x: h.x,
        y: h.y,
        litterSize,
        childEnergy: (totalCost / litterSize) * params.childEnergyEfficiency,
      });
    }

    return events;
  }

  step(world: World, rng: Rng): void {
    this.moveAndFeed(world, rng);
    const events = this.mate(world, rng);

    for (let i = this.individuals.length - 1; i >= 0; i--) {
      if (this.individuals[i].energy <= 0) this.individuals.splice(i, 1);
    }

    for (const event of events) {
      for (let n = 0; n < event.litterSize; n++) {
        this.individuals.push({ x: event.x, y: event.y, energy: event.childEnergy, cooldown: 0 });
      }
    }
  }
}
