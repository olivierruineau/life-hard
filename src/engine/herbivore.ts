import {
  derivePhenotype,
  mutateGenome,
  seedGenome,
  type Genome,
  type Phenotype,
  type PhenotypeRanges,
} from './genetics.ts';
import { chooseGreedyMove } from './movement.ts';
import type { Rng } from './random.ts';
import { performMating, type ReproductionParams } from './reproduction.ts';
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

export interface HerbivoreParams extends ReproductionParams {
  initialEnergy: number;
  eatRate: number;
  phenotypeRanges: PhenotypeRanges;

  /** Age (in ticks) at which senescence starts adding extra metabolic cost. */
  matureAge: number;
  /** Extra rest-metabolism cost per tick of age past matureAge. */
  senescenceRate: number;
  /** Hard cap: an individual dies of old age at this tick count regardless of energy. */
  maxAge: number;

  /** Population at/below which stray individuals may wander in from outside the mapped area. */
  immigrationThreshold: number;
  /** Per-tick probability of a wandering-in arrival while the population is at/below that threshold. */
  immigrationChancePerTick: number;
}

export const DEFAULT_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [1, 5],
  moveCost: [0.9, 0.3],
  swimCost: [6, 2],
  baseRestMetabolism: 1.2,
  restMetabolismGeneFactor: 0.2,
  conversionEfficiency: [0.35, 0.65],
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

  // Same rationale as PredatorPopulation's immigration (see predator.ts): a small closed
  // population sharing its food supply with a competing species can still get unlucky into
  // extinction no matter how the hunting/competition economics are tuned — a low-rate trickle of
  // outside arrivals is what turns a bad patch into a recoverable dip instead of a dead species.
  immigrationThreshold: 6,
  immigrationChancePerTick: 0.03,
};

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

  /** Aging, movement toward food, grazing, and mating-cooldown tick-down. */
  moveAndFeed(world: World, rng: Rng): void {
    for (const h of this.individuals) {
      h.age++;
      const traits = this.traits(h.genome);
      const senescence = Math.max(0, h.age - this.params.matureAge) * this.params.senescenceRate;
      h.energy -= traits.restMetabolism + senescence;

      const [dx, dy] = chooseGreedyMove(
        world,
        h.x,
        h.y,
        traits.visionRadius,
        (x, y) => world.biomass[world.index(x, y)],
        rng,
      );
      if (dx !== 0 || dy !== 0) {
        h.x += dx;
        h.y += dy;
        h.energy -= world.isWater(h.x, h.y) ? traits.swimCost : traits.moveCost;
      }

      if (!world.isWater(h.x, h.y)) {
        const eaten = world.consume(h.x, h.y, this.params.eatRate);
        h.energy += eaten * traits.conversionEfficiency;
      }

      if (h.cooldown > 0) h.cooldown--;
    }
  }

  /** Mating, death (starvation, predation, or old age), and spawning newborns. */
  reproduceAndCleanup(world: World, rng: Rng): void {
    const events = performMating(
      this.individuals,
      world,
      this.params,
      (h) => this.traits(h.genome).matingEnergyThreshold,
      (h) => this.traits(h.genome).maxLitterSize,
      rng,
    );

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

    this.immigrate(world, rng);
  }

  private immigrate(world: World, rng: Rng): void {
    if (this.individuals.length > this.params.immigrationThreshold) return;
    if (rng() >= this.params.immigrationChancePerTick) return;

    let attempts = 0;
    while (attempts < 50) {
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
      return;
    }
  }

  step(world: World, rng: Rng): void {
    this.moveAndFeed(world, rng);
    this.reproduceAndCleanup(world, rng);
  }
}
