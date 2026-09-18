import { derivePhenotype, genomeToColor, mutateGenes, seedGenes, type Phenotype, type PhenotypeRanges } from './genetics.ts';
import type { HerbivorePopulation } from './herbivore.ts';
import { chooseGreedyMove, SpatialGrid } from './movement.ts';
import type { Rng } from './random.ts';
import { performMating, type ReproductionParams } from './reproduction.ts';
import type { World } from './world.ts';

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

function countNearby(grid: SpatialGrid, world: World, cx: number, cy: number, r: number): number {
  let count = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!world.inBounds(nx, ny)) continue;
      count += grid.cellCountAt(world.index(nx, ny));
    }
  }
  return count;
}

/** SoA storage — see HerbivorePopulation for the general rationale (parallel grown TypedArray
 * columns instead of an array of objects). Predators additionally track `huntCooldown`. */
export class PredatorPopulation {
  length = 0;
  private capacity = 0;
  x: Int32Array = new Int32Array(0);
  y: Int32Array = new Int32Array(0);
  energy: Float64Array = new Float64Array(0);
  cooldown: Int32Array = new Int32Array(0);
  age: Int32Array = new Int32Array(0);
  geneSpeed: Float64Array = new Float64Array(0);
  geneVision: Float64Array = new Float64Array(0);
  geneFertility: Float64Array = new Float64Array(0);
  geneEfficiency: Float64Array = new Float64Array(0);
  /** Ticks remaining before this predator can attempt another catch (digestion). */
  huntCooldown: Int32Array = new Int32Array(0);
  private matingThresholdScratch: Float64Array = new Float64Array(0);
  private maxLitterScratch: Float64Array = new Float64Array(0);

  private grid: SpatialGrid | undefined;
  private readonly params: PredatorParams;

  constructor(params: PredatorParams) {
    this.params = params;
  }

  traits(i: number): Phenotype {
    return derivePhenotype(this.geneSpeed[i], this.geneVision[i], this.geneFertility[i], this.geneEfficiency[i], this.params.phenotypeRanges);
  }

  color(i: number, hueOffset: number, hueSpan: number): string {
    return genomeToColor(this.geneSpeed[i], this.geneVision[i], this.geneFertility[i], this.geneEfficiency[i], hueOffset, hueSpan);
  }

  /** Rebuilds (or lazily creates) this population's reusable spatial index from current positions. */
  rebuildGrid(world: World): SpatialGrid {
    if (!this.grid) this.grid = new SpatialGrid(world.width * world.height);
    this.grid.build(this.length, this.x, this.y, world.width);
    return this.grid;
  }

  private ensureCapacity(extra: number): void {
    if (this.length + extra <= this.capacity) return;
    const next = Math.max(this.length + extra, this.capacity * 2, 16);
    const grow = (arr: Int32Array | Float64Array) => {
      const ctor = arr.constructor as { new (n: number): typeof arr };
      const bigger = new ctor(next);
      bigger.set(arr);
      return bigger;
    };
    this.x = grow(this.x) as Int32Array;
    this.y = grow(this.y) as Int32Array;
    this.energy = grow(this.energy) as Float64Array;
    this.cooldown = grow(this.cooldown) as Int32Array;
    this.age = grow(this.age) as Int32Array;
    this.geneSpeed = grow(this.geneSpeed) as Float64Array;
    this.geneVision = grow(this.geneVision) as Float64Array;
    this.geneFertility = grow(this.geneFertility) as Float64Array;
    this.geneEfficiency = grow(this.geneEfficiency) as Float64Array;
    this.huntCooldown = grow(this.huntCooldown) as Int32Array;
    this.matingThresholdScratch = grow(this.matingThresholdScratch) as Float64Array;
    this.maxLitterScratch = grow(this.maxLitterScratch) as Float64Array;
    this.capacity = next;
  }

  private append(x: number, y: number, energy: number, genes: readonly [number, number, number, number]): void {
    this.ensureCapacity(1);
    const i = this.length;
    this.x[i] = x;
    this.y[i] = y;
    this.energy[i] = energy;
    this.cooldown[i] = 0;
    this.age[i] = 0;
    this.geneSpeed[i] = genes[0];
    this.geneVision[i] = genes[1];
    this.geneFertility[i] = genes[2];
    this.geneEfficiency[i] = genes[3];
    this.huntCooldown[i] = 0;
    this.length++;
  }

  spawnRandom(world: World, count: number, rng: Rng): void {
    this.ensureCapacity(count);
    let attempts = 0;
    let placed = 0;
    while (placed < count && attempts < count * 50) {
      attempts++;
      const x = Math.floor(rng() * world.width);
      const y = Math.floor(rng() * world.height);
      if (world.isWater(x, y)) continue;
      this.append(x, y, this.params.initialEnergy, seedGenes(rng));
      placed++;
    }
  }

  /** Aging, movement toward under-hunted prey patches, hunting, and mating-cooldown tick-down. */
  moveAndHunt(world: World, herbivores: HerbivorePopulation, rng: Rng): void {
    const preyGrid = herbivores.rebuildGrid(world);
    const preyDensityAt = (x: number, y: number) => preyGrid.cellCountAt(world.index(x, y));
    // All predators share the same greedy movement heuristic, so without this they'd all converge
    // on the single richest prey cell and permanently crowd each other out there (territoriality
    // avoids that): a predator prefers prey-rich cells that aren't already staked out by others,
    // spreading hunting pressure across multiple patches instead of hammering one hotspot.
    const predatorGrid = this.rebuildGrid(world);
    const territorialScoreAt = (x: number, y: number) => {
      const preyCount = preyDensityAt(x, y);
      if (preyCount === 0) return 0;
      const rivals = predatorGrid.cellCountAt(world.index(x, y));
      return preyCount / (1 + rivals);
    };
    const eaten = new Set<number>();
    // Ecosystem-wide scarcity penalty: on top of the local dilution effect, a herbivore
    // population that's collapsing overall becomes much harder to hunt down (more vigilant,
    // more scattered survivors) — this is what lets herbivores actually recover instead of both
    // species grinding toward extinction together once numbers get low. Squaring the ratio makes
    // the penalty bite well before the population is already critically low, instead of only
    // near the very end.
    const scarcityRatio = clamp(herbivores.length / this.params.scarcityReferencePopulation, 0, 1);
    const scarcityFactor = clamp(scarcityRatio * scarcityRatio, this.params.scarcityFloor, 1);

    for (let i = 0; i < this.length; i++) {
      this.age[i]++;
      const traits = this.traits(i);
      const senescence = Math.max(0, this.age[i] - this.params.matureAge) * this.params.senescenceRate;
      this.energy[i] -= traits.restMetabolism + senescence;

      // A predator that's fed up and ready to breed switches from spreading out over prey patches
      // to actively seeking another ready predator — otherwise territoriality (needed to stop
      // hunting packs from crashing prey) also keeps well-fed adults permanently apart and the
      // population can never out-reproduce its losses.
      const readyToMate = this.cooldown[i] === 0 && this.energy[i] >= traits.matingEnergyThreshold;
      const scoreAt = readyToMate
        ? (x: number, y: number) => {
            const count = predatorGrid.cellCountAt(world.index(x, y));
            return x === this.x[i] && y === this.y[i] ? count - 1 : count;
          }
        : territorialScoreAt;
      const [dx, dy] = chooseGreedyMove(world, this.x[i], this.y[i], traits.visionRadius, scoreAt, rng);
      if (dx !== 0 || dy !== 0) {
        this.x[i] += dx;
        this.y[i] += dy;
        this.energy[i] -= world.isWater(this.x[i], this.y[i]) ? traits.swimCost : traits.moveCost;
      }

      if (this.huntCooldown[i] > 0) {
        this.huntCooldown[i]--;
      } else {
        const preyIdx = this.findPrey(i, world, herbivores, preyGrid, eaten, rng);
        if (preyIdx !== -1) {
          // Interference competition: a predator hunting alone gets its full chance, but packed
          // in among other predators (exactly what happens once population grows around a prey
          // hotspot) it competes for the same catches. This is what caps the *aggregate* harvest
          // rate as predator numbers grow, instead of harvest scaling linearly with population and
          // crashing prey every time predators become numerous enough to find mates reliably.
          const nearbyPredators = Math.max(
            0,
            countNearby(predatorGrid, world, this.x[i], this.y[i], this.params.huntRadius) - 1,
          );
          const interferenceFactor = 1 / (1 + this.params.predatorInterferenceStrength * nearbyPredators);
          const chance = clamp(
            (this.params.catchBaseChance + this.params.catchSpeedFactor * (this.geneSpeed[i] - herbivores.geneSpeed[preyIdx])) *
              interferenceFactor *
              scarcityFactor,
            0.01,
            0.95,
          );
          if (rng() < chance) {
            this.energy[i] += herbivores.energy[preyIdx] * traits.conversionEfficiency;
            herbivores.energy[preyIdx] = -1;
            this.huntCooldown[i] = this.params.huntCooldown;
          }
        }
      }

      if (this.cooldown[i] > 0) this.cooldown[i]--;
    }
  }

  /** Returns the index (into `herbivores`' columns) of a randomly chosen nearby, not-yet-eaten prey, or -1. */
  private findPrey(
    i: number,
    world: World,
    herbivores: HerbivorePopulation,
    grid: SpatialGrid,
    eaten: Set<number>,
    rng: Rng,
  ): number {
    const r = this.params.huntRadius;
    const px = this.x[i];
    const py = this.y[i];
    const candidates: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (!world.inBounds(nx, ny)) continue;
        const cell = world.index(nx, ny);
        for (let k = grid.cellStart(cell); k < grid.cellEnd(cell); k++) {
          const idx = grid.sortedIndices[k];
          if (eaten.has(idx) || herbivores.energy[idx] <= 0) continue;
          candidates.push(idx);
        }
      }
    }
    if (candidates.length === 0) return -1;
    const chosen = candidates[Math.floor(rng() * candidates.length)];
    eaten.add(chosen);
    return chosen;
  }

  /** Mating, death (starvation or old age), and spawning newborns. */
  reproduceAndCleanup(world: World, rng: Rng): void {
    const grid = this.rebuildGrid(world);

    for (let i = 0; i < this.length; i++) {
      const traits = this.traits(i);
      this.matingThresholdScratch[i] = traits.matingEnergyThreshold;
      this.maxLitterScratch[i] = traits.maxLitterSize;
    }

    const events = performMating(
      this,
      grid,
      world,
      this.params,
      (i) => this.matingThresholdScratch[i],
      (i) => this.maxLitterScratch[i],
      rng,
    );

    let w = 0;
    for (let r = 0; r < this.length; r++) {
      if (this.energy[r] <= 0 || this.age[r] >= this.params.maxAge) continue;
      if (w !== r) {
        this.x[w] = this.x[r];
        this.y[w] = this.y[r];
        this.energy[w] = this.energy[r];
        this.cooldown[w] = this.cooldown[r];
        this.age[w] = this.age[r];
        this.geneSpeed[w] = this.geneSpeed[r];
        this.geneVision[w] = this.geneVision[r];
        this.geneFertility[w] = this.geneFertility[r];
        this.geneEfficiency[w] = this.geneEfficiency[r];
        this.huntCooldown[w] = this.huntCooldown[r];
      }
      w++;
    }
    this.length = w;

    for (const event of events) {
      for (let n = 0; n < event.litterSize; n++) {
        const genes = mutateGenes(event.geneSpeed, event.geneVision, event.geneFertility, event.geneEfficiency, rng);
        this.append(event.x, event.y, event.childEnergy, genes);
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
    if (this.length > this.params.immigrationThreshold) return;
    if (rng() >= this.params.immigrationChancePerTick) return;

    let attempts = 0;
    while (attempts < 50) {
      attempts++;
      const x = Math.floor(rng() * world.width);
      const y = Math.floor(rng() * world.height);
      if (world.isWater(x, y)) continue;
      this.append(x, y, this.params.initialEnergy, seedGenes(rng));
      return;
    }
  }
}
