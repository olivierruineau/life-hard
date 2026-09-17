import {
  crossoverGenome,
  derivePhenotype,
  genomeDistance,
  mutateGenome,
  seedGenome,
  type Genome,
  type Phenotype,
  type PhenotypeRanges,
} from './genetics.ts';
import type { Rng } from './random.ts';
import type { World } from './world.ts';

export interface Herbivore {
  x: number;
  y: number;
  energy: number;
  /** Ticks remaining before this individual can mate again. */
  cooldown: number;
  /** Age in ticks. */
  age: number;
  genome: Genome;
}

export interface HerbivoreParams {
  initialEnergy: number;
  eatRate: number;
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
  phenotypeRanges: PhenotypeRanges;

  /** Age (in ticks) at which senescence starts adding extra metabolic cost. */
  matureAge: number;
  /** Extra rest-metabolism cost per tick of age past matureAge. */
  senescenceRate: number;
  /** Hard cap: an individual dies of old age at this tick count regardless of energy. */
  maxAge: number;
}

export const DEFAULT_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [1, 5],
  moveCost: [0.9, 0.3],
  swimCost: [6, 2],
  baseRestMetabolism: 1.2,
  restMetabolismGeneFactor: 0.2,
  energyPerBiomass: [0.35, 0.65],
  matingEnergyThreshold: [60, 100],
  maxLitterSize: [1, 4],
};

export const DEFAULT_HERBIVORE_PARAMS: HerbivoreParams = {
  initialEnergy: 50,
  eatRate: 5,
  minLitterSize: 1,
  litterCostBase: 40,
  litterCostExponent: 1.5,
  childEnergyEfficiency: 0.55,
  reproductionCooldown: 30,
  matingRadius: 1,
  maxMatingDistance: 0.4,
  phenotypeRanges: DEFAULT_PHENOTYPE_RANGES,

  matureAge: 250,
  senescenceRate: 0.02,
  maxAge: 550,
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
function chooseMove(world: World, h: Herbivore, visionRadius: number, rng: Rng): [number, number] {
  let bestScore = -1;
  let bestX = h.x;
  let bestY = h.y;

  for (let dy = -visionRadius; dy <= visionRadius; dy++) {
    for (let dx = -visionRadius; dx <= visionRadius; dx++) {
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
  genome: Genome;
}

export class HerbivorePopulation {
  readonly individuals: Herbivore[] = [];
  private readonly params: HerbivoreParams;

  constructor(params: HerbivoreParams) {
    this.params = params;
  }

  traits(genome: Genome): Phenotype {
    return derivePhenotype(genome, this.params.phenotypeRanges);
  }

  spawnRandom(world: World, count: number, rng: Rng): void {
    let attempts = 0;
    let placed = 0;
    while (placed < count && attempts < count * 50) {
      attempts++;
      const x = Math.floor(rng() * world.width);
      const y = Math.floor(rng() * world.height);
      if (world.isWater(x, y)) continue;
      this.individuals.push({
        x,
        y,
        energy: this.params.initialEnergy,
        cooldown: 0,
        age: 0,
        genome: seedGenome(rng),
      });
      placed++;
    }
  }

  private moveAndFeed(world: World, rng: Rng): void {
    for (const h of this.individuals) {
      h.age++;
      const traits = this.traits(h.genome);
      const senescence = Math.max(0, h.age - this.params.matureAge) * this.params.senescenceRate;
      h.energy -= traits.restMetabolism + senescence;

      const [dx, dy] = chooseMove(world, h, traits.visionRadius, rng);
      if (dx !== 0 || dy !== 0) {
        h.x += dx;
        h.y += dy;
        h.energy -= world.isWater(h.x, h.y) ? traits.swimCost : traits.moveCost;
      }

      if (!world.isWater(h.x, h.y)) {
        const eaten = world.consume(h.x, h.y, this.params.eatRate);
        h.energy += eaten * traits.energyPerBiomass;
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

    const isEligible = (h: Herbivore) => h.cooldown === 0 && h.energy >= this.traits(h.genome).matingEnergyThreshold;
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
            const candidate = this.individuals[j];
            if (!isEligible(candidate)) continue;
            if (genomeDistance(h.genome, candidate.genome) > params.maxMatingDistance) continue;
            partnerIndex = j;
            break outer;
          }
        }
      }

      if (partnerIndex === -1) continue;
      const partner = this.individuals[partnerIndex];

      const hFertility = this.traits(h.genome).maxLitterSize;
      const partnerFertility = this.traits(partner.genome).maxLitterSize;
      const maxLitter = Math.max(params.minLitterSize, Math.round((hFertility + partnerFertility) / 2));
      const litterSize = params.minLitterSize + Math.floor(rng() * (maxLitter - params.minLitterSize + 1));
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
        genome: crossoverGenome(h.genome, partner.genome, rng),
      });
    }

    return events;
  }

  step(world: World, rng: Rng): void {
    this.moveAndFeed(world, rng);
    const events = this.mate(world, rng);

    for (let i = this.individuals.length - 1; i >= 0; i--) {
      const h = this.individuals[i];
      if (h.energy <= 0 || h.age >= this.params.maxAge) this.individuals.splice(i, 1);
    }

    for (const event of events) {
      for (let n = 0; n < event.litterSize; n++) {
        this.individuals.push({
          x: event.x,
          y: event.y,
          energy: event.childEnergy,
          cooldown: 0,
          age: 0,
          genome: mutateGenome(event.genome, rng),
        });
      }
    }
  }
}
