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
  /** Herbivore population at/above which the global scarcity penalty is fully lifted. */
  scarcityReferencePopulation: number;
  /** Catch-chance multiplier floor applied once the herbivore population collapses toward zero. */
  scarcityFloor: number;
  /** How strongly nearby competing predators cut into an individual's catch chance (interference competition). */
  predatorInterferenceStrength: number;

  matureAge: number;
  senescenceRate: number;
  maxAge: number;

  /** Population at/below which stray individuals may wander in from outside the mapped area. */
  immigrationThreshold: number;
  /** Per-tick probability of a wandering-in arrival while the population is at/below that threshold. */
  immigrationChancePerTick: number;
}

export const DEFAULT_PREDATOR_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [3, 8],
  moveCost: [0.35, 0.15],
  swimCost: [3, 1.5],
  baseRestMetabolism: 0.5,
  restMetabolismGeneFactor: 0.08,
  conversionEfficiency: [0.55, 0.85],
  matingEnergyThreshold: [70, 100],
  maxLitterSize: [1, 3],
};

export const DEFAULT_PREDATOR_PARAMS: PredatorParams = {
  initialEnergy: 150,
  minLitterSize: 1,
  litterCostBase: 35,
  litterCostExponent: 1.5,
  childEnergyEfficiency: 0.5,
  reproductionCooldown: 50,
  matingRadius: 2,
  maxMatingDistance: 0.4,
  phenotypeRanges: DEFAULT_PREDATOR_PHENOTYPE_RANGES,

  // Predator population growth is bottlenecked by spatial mate-finding, not food — it plateaus
  // around 10-40 individuals even with thousands of available prey, so a stronger per-capita catch
  // rate (bumped from 0.35/20 during multi-species balancing) is what keeps a static-sized predator
  // pack's aggregate harvest actually tracking herbivore population growth instead of a handful of
  // predators being permanently outpaced by an exponentially growing prey base.
  catchBaseChance: 0.5,
  catchSpeedFactor: 0.25,
  huntRadius: 2,
  huntCooldown: 18,
  scarcityReferencePopulation: 150,
  scarcityFloor: 0.05,
  predatorInterferenceStrength: 0.5,

  matureAge: 300,
  senescenceRate: 0.02,
  maxAge: 700,

  immigrationThreshold: 6,
  immigrationChancePerTick: 0.03,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function countNearby(buckets: Map<number, number[]>, world: World, cx: number, cy: number, r: number): number {
  let count = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!world.inBounds(nx, ny)) continue;
      count += buckets.get(world.index(nx, ny))?.length ?? 0;
    }
  }
  return count;
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

  /** Aging, movement toward under-hunted prey patches, hunting, and mating-cooldown tick-down. */
  moveAndHunt(world: World, herbivores: HerbivorePopulation, rng: Rng): void {
    const preyBuckets = bucketByCell(herbivores.individuals, world);
    const preyDensityAt = (x: number, y: number) => preyBuckets.get(world.index(x, y))?.length ?? 0;
    // All predators share the same greedy movement heuristic, so without this they'd all converge
    // on the single richest prey cell and permanently crowd each other out there (territoriality
    // avoids that): a predator prefers prey-rich cells that aren't already staked out by others,
    // spreading hunting pressure across multiple patches instead of hammering one hotspot.
    const predatorBuckets = bucketByCell(this.individuals, world);
    const territorialScoreAt = (x: number, y: number) => {
      const preyCount = preyDensityAt(x, y);
      if (preyCount === 0) return 0;
      const rivals = predatorBuckets.get(world.index(x, y))?.length ?? 0;
      return preyCount / (1 + rivals);
    };
    const eaten = new Set<number>();
    // Ecosystem-wide scarcity penalty: on top of the local dilution effect, a herbivore
    // population that's collapsing overall becomes much harder to hunt down (more vigilant,
    // more scattered survivors) — this is what lets herbivores actually recover instead of both
    // species grinding toward extinction together once numbers get low. Squaring the ratio makes
    // the penalty bite well before the population is already critically low, instead of only
    // near the very end.
    const scarcityRatio = clamp(herbivores.individuals.length / this.params.scarcityReferencePopulation, 0, 1);
    const scarcityFactor = clamp(scarcityRatio * scarcityRatio, this.params.scarcityFloor, 1);

    for (const p of this.individuals) {
      p.age++;
      const traits = this.traits(p.genome);
      const senescence = Math.max(0, p.age - this.params.matureAge) * this.params.senescenceRate;
      p.energy -= traits.restMetabolism + senescence;

      // A predator that's fed up and ready to breed switches from spreading out over prey patches
      // to actively seeking another ready predator — otherwise territoriality (needed to stop
      // hunting packs from crashing prey) also keeps well-fed adults permanently apart and the
      // population can never out-reproduce its losses.
      const readyToMate = p.cooldown === 0 && p.energy >= traits.matingEnergyThreshold;
      const scoreAt = readyToMate
        ? (x: number, y: number) => {
            const count = predatorBuckets.get(world.index(x, y))?.length ?? 0;
            return x === p.x && y === p.y ? count - 1 : count;
          }
        : territorialScoreAt;
      const [dx, dy] = chooseGreedyMove(world, p.x, p.y, traits.visionRadius, scoreAt, rng);
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
          // Interference competition: a predator hunting alone gets its full chance, but packed
          // in among other predators (exactly what happens once population grows around a prey
          // hotspot) it competes for the same catches. This is what caps the *aggregate* harvest
          // rate as predator numbers grow, instead of harvest scaling linearly with population and
          // crashing prey every time predators become numerous enough to find mates reliably.
          const nearbyPredators = Math.max(
            0,
            countNearby(predatorBuckets, world, p.x, p.y, this.params.huntRadius) - 1,
          );
          const interferenceFactor = 1 / (1 + this.params.predatorInterferenceStrength * nearbyPredators);
          const chance = clamp(
            (this.params.catchBaseChance + this.params.catchSpeedFactor * (p.genome.speed - prey.genome.speed)) *
              interferenceFactor *
              scarcityFactor,
            0.01,
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

    this.immigrate(world, rng);
  }

  /**
   * A resident population this small on a single mapped patch is, in reality, part of a wider
   * metapopulation: individuals occasionally wander in from neighboring, unmapped territory. This
   * is what keeps a run of bad luck (a lean season, a failed litter) from being a permanent,
   * irreversible extinction — without it, a closed population this size is a dead species walking
   * no matter how the hunting/reproduction economics are tuned, since it will eventually hit zero
   * by pure chance.
   */
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
        huntCooldown: 0,
      });
      return;
    }
  }
}
