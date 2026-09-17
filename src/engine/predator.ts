import { derivePhenotype, mutateGenome, seedGenome, type Genome, type Phenotype, type PhenotypeRanges } from './genetics.ts';
import type { Herbivore, HerbivorePopulation } from './herbivore.ts';
import { bucketByCell, chooseGreedyMove } from './movement.ts';
import type { Rng } from './random.ts';
import { performMating, type ReproductionParams } from './reproduction.ts';
import type { World } from './world.ts';

export interface Predator {
  x: number;
  y: number;
  energy: number;
  cooldown: number;
  age: number;
  genome: Genome;
  /** Ticks remaining before this predator can attempt another catch (digestion). */
  huntCooldown: number;
}

export interface PredatorParams extends ReproductionParams {
  initialEnergy: number;
  phenotypeRanges: PhenotypeRanges;

  /** Base probability of a successful catch when both predator and prey have equal speed. */
  catchBaseChance: number;
  /** How much a predator/prey speed-gene gap shifts the catch probability. */
  catchSpeedFactor: number;
  /** Radius (in cells) within which a predator can attempt to catch prey. */
  huntRadius: number;
  /** Ticks a predator must wait after a successful catch before hunting again. */
  huntCooldown: number;

  matureAge: number;
  senescenceRate: number;
  maxAge: number;
}

export const DEFAULT_PREDATOR_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [2, 7],
  moveCost: [0.35, 0.15],
  swimCost: [3, 1.5],
  baseRestMetabolism: 0.8,
  restMetabolismGeneFactor: 0.1,
  conversionEfficiency: [0.4, 0.75],
  matingEnergyThreshold: [70, 100],
  maxLitterSize: [1, 3],
};

export const DEFAULT_PREDATOR_PARAMS: PredatorParams = {
  initialEnergy: 150,
  minLitterSize: 1,
  litterCostBase: 35,
  litterCostExponent: 1.5,
  childEnergyEfficiency: 0.5,
  reproductionCooldown: 45,
  matingRadius: 1,
  maxMatingDistance: 0.4,
  phenotypeRanges: DEFAULT_PREDATOR_PHENOTYPE_RANGES,

  catchBaseChance: 0.35,
  catchSpeedFactor: 0.35,
  huntRadius: 1,
  huntCooldown: 60,

  matureAge: 300,
  senescenceRate: 0.02,
  maxAge: 700,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class PredatorPopulation {
  readonly individuals: Predator[] = [];
  private readonly params: PredatorParams;

  constructor(params: PredatorParams) {
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
        huntCooldown: 0,
      });
      placed++;
    }
  }

  /** Aging, movement toward prey-dense cells, hunting, and mating-cooldown tick-down. */
  moveAndHunt(world: World, herbivores: HerbivorePopulation, rng: Rng): void {
    const preyBuckets = bucketByCell(herbivores.individuals, world);
    const preyDensityAt = (x: number, y: number) => preyBuckets.get(world.index(x, y))?.length ?? 0;
    const eaten = new Set<number>();

    for (const p of this.individuals) {
      p.age++;
      const traits = this.traits(p.genome);
      const senescence = Math.max(0, p.age - this.params.matureAge) * this.params.senescenceRate;
      p.energy -= traits.restMetabolism + senescence;

      const [dx, dy] = chooseGreedyMove(world, p.x, p.y, traits.visionRadius, preyDensityAt, rng);
      if (dx !== 0 || dy !== 0) {
        p.x += dx;
        p.y += dy;
        p.energy -= world.isWater(p.x, p.y) ? traits.swimCost : traits.moveCost;
      }

      if (p.huntCooldown > 0) {
        p.huntCooldown--;
      } else {
        const prey = this.findPrey(p, world, herbivores.individuals, preyBuckets, eaten, rng);
        if (prey) {
          const chance = clamp(
            this.params.catchBaseChance + this.params.catchSpeedFactor * (p.genome.speed - prey.genome.speed),
            0.05,
            0.95,
          );
          if (rng() < chance) {
            p.energy += prey.energy * traits.conversionEfficiency;
            prey.energy = -1;
            p.huntCooldown = this.params.huntCooldown;
          }
        }
      }

      if (p.cooldown > 0) p.cooldown--;
    }
  }

  private findPrey(
    predator: Predator,
    world: World,
    herbivoreList: Herbivore[],
    buckets: Map<number, number[]>,
    eaten: Set<number>,
    rng: Rng,
  ): Herbivore | null {
    const r = this.params.huntRadius;
    const candidates: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = predator.x + dx;
        const ny = predator.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const bucket = buckets.get(world.index(nx, ny));
        if (!bucket) continue;
        for (const idx of bucket) {
          if (eaten.has(idx) || herbivoreList[idx].energy <= 0) continue;
          candidates.push(idx);
        }
      }
    }
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.floor(rng() * candidates.length)];
    eaten.add(chosen);
    return herbivoreList[chosen];
  }

  /** Mating, death (starvation or old age), and spawning newborns. */
  reproduceAndCleanup(world: World, rng: Rng): void {
    const events = performMating(
      this.individuals,
      world,
      this.params,
      (p) => this.traits(p.genome).matingEnergyThreshold,
      (p) => this.traits(p.genome).maxLitterSize,
      rng,
    );

    for (let i = this.individuals.length - 1; i >= 0; i--) {
      const p = this.individuals[i];
      if (p.energy <= 0 || p.age >= this.params.maxAge) this.individuals.splice(i, 1);
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
          huntCooldown: 0,
        });
      }
    }
  }
}
