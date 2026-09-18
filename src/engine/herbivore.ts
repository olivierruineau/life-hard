import { Biome } from './biome.ts';
import { derivePhenotype, genomeToColor, mutateGenes, seedGenes, type Phenotype, type PhenotypeRanges } from './genetics.ts';
import { chooseGreedyMove, SpatialGrid } from './movement.ts';
import type { Rng } from './random.ts';
import { performMating, type ReproductionParams } from './reproduction.ts';
import type { World } from './world.ts';

/**
 * Per-biome foraging preference multiplier, applied to a cell's raw biomass when a species scores
 * candidate cells to move toward. Biomes absent from the map default to 1 (no preference). This
 * only biases *where* a species chooses to forage, not how much it actually eats once there
 * (`world.consume` is unaffected) — without it every herbivore species chases the single richest
 * biome on the map regardless of niche, since raw biomass quantity is all `chooseGreedyMove` sees.
 */
export type BiomeAffinity = Partial<Record<Biome, number>>;

export interface HerbivoreParams extends ReproductionParams {
  initialEnergy: number;
  eatRate: number;
  phenotypeRanges: PhenotypeRanges;
  /** Foraging preference by biome; absent = uniform (today's behavior). */
  biomeAffinity?: BiomeAffinity;

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

// How much better the best visible cell must be than the current one (as a fraction) before an
// individual bothers moving — see chooseGreedyMove's stayThreshold. Tuned so a mild, map-wide
// gradient (a seasonal biomassMax swing) isn't worth chasing tick after tick, while a real local
// difference (an actually richer patch, a grazed-out cell) still clears it comfortably.
const FORAGING_STAY_THRESHOLD = 0.05;

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

/**
 * SoA storage: one Herbivore used to be a plain object; a population is now parallel TypedArray
 * columns indexed 0..length-1, grown (doubling, copy via `.set`) when capacity is exceeded. This
 * mirrors how `World` already stores its per-cell grid (public readonly-in-spirit TypedArrays),
 * just resizable since population count changes every tick. `length` is the live individual
 * count; everything at index >= length in the backing arrays is stale/garbage.
 */
export class HerbivorePopulation {
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
  // Scratch columns recomputed each reproduceAndCleanup call (see performMating) — grown alongside
  // the rest so no per-tick allocation once capacity settles.
  private matingThresholdScratch: Float64Array = new Float64Array(0);
  private maxLitterScratch: Float64Array = new Float64Array(0);

  private grid: SpatialGrid | undefined;
  private affinityMultiplier: Float64Array | undefined;
  private readonly params: HerbivoreParams;

  constructor(params: HerbivoreParams) {
    this.params = params;
  }

  traits(i: number): Phenotype {
    return derivePhenotype(this.geneSpeed[i], this.geneVision[i], this.geneFertility[i], this.geneEfficiency[i], this.params.phenotypeRanges);
  }

  /**
   * Per-cell foraging-preference multiplier (1 everywhere if no `biomeAffinity` is configured),
   * built once and cached — biome layout is fixed for a simulation run, so there's no reason to
   * re-derive `affinity[world.biomeAt(x,y)]` (a string-keyed object lookup) on every cell scanned
   * by every individual on every tick.
   */
  private getAffinityMultiplier(world: World): Float64Array {
    if (this.affinityMultiplier) return this.affinityMultiplier;
    const mult = new Float64Array(world.width * world.height).fill(1);
    const affinity = this.params.biomeAffinity;
    if (affinity) {
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          const idx = world.index(x, y);
          mult[idx] = affinity[world.biomeAt(x, y)] ?? 1;
        }
      }
    }
    this.affinityMultiplier = mult;
    return mult;
  }

  color(i: number, hueOffset: number, hueSpan: number): string {
    return genomeToColor(this.geneSpeed[i], this.geneVision[i], this.geneFertility[i], this.geneEfficiency[i], hueOffset, hueSpan);
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

  /** Aging, movement toward food (weighted by biome preference), grazing, and mating-cooldown tick-down. */
  moveAndFeed(world: World, rng: Rng): void {
    const affinityMultiplier = this.getAffinityMultiplier(world);
    const scoreAt = (_x: number, _y: number, idx: number) => world.biomass[idx] * affinityMultiplier[idx];

    for (let i = 0; i < this.length; i++) {
      this.age[i]++;
      const traits = this.traits(i);
      const senescence = Math.max(0, this.age[i] - this.params.matureAge) * this.params.senescenceRate;
      this.energy[i] -= traits.restMetabolism + senescence;

      const [dx, dy] = chooseGreedyMove(world, this.x[i], this.y[i], traits.visionRadius, scoreAt, rng, FORAGING_STAY_THRESHOLD);
      if (dx !== 0 || dy !== 0) {
        this.x[i] += dx;
        this.y[i] += dy;
        this.energy[i] -= world.isWater(this.x[i], this.y[i]) ? traits.swimCost : traits.moveCost;
      }

      if (!world.isWater(this.x[i], this.y[i])) {
        const eaten = world.consume(this.x[i], this.y[i], this.params.eatRate);
        this.energy[i] += eaten * traits.conversionEfficiency;
      }

      if (this.cooldown[i] > 0) this.cooldown[i]--;
    }
  }

  /** Rebuilds (or lazily creates) this population's reusable spatial index from current positions. */
  rebuildGrid(world: World): SpatialGrid {
    if (!this.grid) this.grid = new SpatialGrid(world.width * world.height);
    this.grid.build(this.length, this.x, this.y, world.width);
    return this.grid;
  }

  /** Mating, death (starvation, predation, or old age), and spawning newborns. */
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

  step(world: World, rng: Rng): void {
    this.moveAndFeed(world, rng);
    this.reproduceAndCleanup(world, rng);
  }
}
