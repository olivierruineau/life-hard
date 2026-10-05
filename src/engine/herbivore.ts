import { Biome } from './biome.ts';
import {
  deriveMatingEnergyThreshold,
  deriveMaxLitterSize,
  derivePhenotype,
  genomeToColor,
  mutateGenes,
  seedGenes,
  type Phenotype,
  type PhenotypeRanges,
} from './genetics.ts';
import { chooseGreedyMove, SpatialGrid } from './movement.ts';
import type { Rng } from './random.ts';
import { performMating, type ReproductionParams } from './reproduction.ts';
import type { World } from './world.ts';

/**
 * Per-biome foraging preference multiplier, applied to a cell's raw biomass when a species scores
 * candidate cells to move toward. Biomes absent from the map default to 1 (no preference). It
 * also scales how well the species digests what it eats there (see `digestionSpecialization`);
 * how much biomass it removes (`world.consume`) is unaffected. Without it every herbivore species
 * chases the single richest biome on the map regardless of niche, since raw biomass quantity is
 * all `chooseGreedyMove` sees.
 */
export type BiomeAffinity = Partial<Record<Biome, number>>;

export interface HerbivoreParams extends ReproductionParams {
  initialEnergy: number;
  eatRate: number;
  phenotypeRanges: PhenotypeRanges;
  /** Foraging preference by biome; absent = uniform (today's behavior). */
  biomeAffinity?: BiomeAffinity;
  /**
   * 0-1: how much `biomeAffinity` also limits digestion, not just where the species goes. At 0 a
   * species eats as well in any biome; at 1 its energy conversion in a biome is scaled by
   * affinity / (its best affinity), so grazing outside its niche is a real handicap.
   */
  digestionSpecialization: number;
  /**
   * 0-1: an individual only breeds on a cell whose biomass is at least this fraction of the
   * cell's current max. Stops a population from breeding itself down to a fully grazed-out map.
   */
  breedMinBiomassFraction: number;

  /** Age (in ticks) at which senescence starts adding extra metabolic cost. */
  matureAge: number;
  /** Extra rest-metabolism cost per tick of age past matureAge. */
  senescenceRate: number;
  /** Hard cap: an individual dies of old age at this tick count regardless of energy. */
  maxAge: number;

  /** Per-tick probability that one individual walks in from the map's edge (constant flux, independent of population size). */
  edgeMigrationPerTick: number;
  /** Energy a migrant arrives with, as a fraction of `initialEnergy` (travel leaves them worn). */
  migrantEnergyFraction: number;
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
  // Niche has to be real, not just a movement bias: with free digestion everywhere, selection on
  // conversion efficiency eventually let the plains grazers spill into the forest, starve the
  // browsers and overgraze the whole map (even with no predators at all).
  digestionSpecialization: 1,
  // Breeding stops on a cell once its food is mostly gone, so a population levels off while the map
  // is still grazed at a sustainable level instead of breeding itself down to bare soil.
  breedMinBiomassFraction: 0.6,

  matureAge: 250,
  senescenceRate: 0.02,
  maxAge: 550,

  // The map is one patch of a wider metapopulation: a steady trickle of outsiders keeps arriving
  // across the border whatever the local count, so a bad stretch is a dip, not an extinction.
  edgeMigrationPerTick: 0.01,
  migrantEnergyFraction: 0.6,
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
  /** Cumulative count of individuals that arrived via `migrateFromEdge` (diagnostic). */
  migrantCount = 0;
  private capacity = 0;
  private nextId = 0;
  /** Stable per-individual id, strictly increasing with index (compaction keeps order and births
   * are appended), so `indexOfId` can binary-search it. Lets the UI follow one individual. */
  id: Int32Array = new Int32Array(0);
  x: Int32Array = new Int32Array(0);
  y: Int32Array = new Int32Array(0);
  energy: Float64Array = new Float64Array(0);
  cooldown: Int32Array = new Int32Array(0);
  age: Int32Array = new Int32Array(0);
  geneSpeed: Float64Array = new Float64Array(0);
  geneVision: Float64Array = new Float64Array(0);
  geneFertility: Float64Array = new Float64Array(0);
  geneEfficiency: Float64Array = new Float64Array(0);
  // matingEnergyThreshold/maxLitterSize depend only on geneFertility, which never changes after
  // birth — computed once in `append` and cached here, instead of recomputing full
  // derivePhenotype for the whole population on every reproduceAndCleanup call just to read these
  // two fields (this used to be ~87% of reproduceAndCleanup's cost).
  matingThreshold: Float64Array = new Float64Array(0);
  maxLitterSize: Float64Array = new Float64Array(0);

  private grid: SpatialGrid | undefined;
  private affinityMultiplier: Float64Array | undefined;
  private digestion: Float64Array | undefined;
  readonly params: HerbivoreParams;

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
  private getDigestion(world: World): Float64Array {
    if (this.digestion) return this.digestion;
    const mult = this.getAffinityMultiplier(world);
    const out = new Float64Array(mult.length).fill(1);
    const strength = this.params.digestionSpecialization;
    const affinity = this.params.biomeAffinity;
    if (affinity && strength > 0) {
      const best = Math.max(...Object.values(affinity));
      for (let i = 0; i < out.length; i++) out[i] = 1 - strength * (1 - Math.min(1, mult[i] / best));
    }
    this.digestion = out;
    return out;
  }

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

  /** Current index of the individual with this id, or -1 if it has died. */
  indexOfId(id: number): number {
    let lo = 0;
    let hi = this.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.id[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
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
    this.id = grow(this.id) as Int32Array;
    this.x = grow(this.x) as Int32Array;
    this.y = grow(this.y) as Int32Array;
    this.energy = grow(this.energy) as Float64Array;
    this.cooldown = grow(this.cooldown) as Int32Array;
    this.age = grow(this.age) as Int32Array;
    this.geneSpeed = grow(this.geneSpeed) as Float64Array;
    this.geneVision = grow(this.geneVision) as Float64Array;
    this.geneFertility = grow(this.geneFertility) as Float64Array;
    this.geneEfficiency = grow(this.geneEfficiency) as Float64Array;
    this.matingThreshold = grow(this.matingThreshold) as Float64Array;
    this.maxLitterSize = grow(this.maxLitterSize) as Float64Array;
    this.capacity = next;
  }

  private append(x: number, y: number, energy: number, genes: readonly [number, number, number, number]): void {
    this.ensureCapacity(1);
    const i = this.length;
    this.id[i] = this.nextId++;
    this.x[i] = x;
    this.y[i] = y;
    this.energy[i] = energy;
    this.cooldown[i] = 0;
    this.age[i] = 0;
    this.geneSpeed[i] = genes[0];
    this.geneVision[i] = genes[1];
    this.geneFertility[i] = genes[2];
    this.geneEfficiency[i] = genes[3];
    this.matingThreshold[i] = deriveMatingEnergyThreshold(genes[2], this.params.phenotypeRanges);
    this.maxLitterSize[i] = deriveMaxLitterSize(genes[2], this.params.phenotypeRanges);
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
    const digestion = this.getDigestion(world);
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
        this.energy[i] += eaten * traits.conversionEfficiency * digestion[world.index(this.x[i], this.y[i])];
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
    const minFraction = this.params.breedMinBiomassFraction;

    const events = performMating(
      this,
      grid,
      world,
      this.params,
      (i) => {
        if (minFraction > 0) {
          const cell = world.index(this.x[i], this.y[i]);
          if (world.biomass[cell] < minFraction * world.biomassMax[cell]) return Infinity;
        }
        return this.matingThreshold[i];
      },
      (i) => this.maxLitterSize[i],
      rng,
    );

    let w = 0;
    for (let r = 0; r < this.length; r++) {
      if (this.energy[r] <= 0 || this.age[r] >= this.params.maxAge) continue;
      if (w !== r) {
        this.id[w] = this.id[r];
        this.x[w] = this.x[r];
        this.y[w] = this.y[r];
        this.energy[w] = this.energy[r];
        this.cooldown[w] = this.cooldown[r];
        this.age[w] = this.age[r];
        this.geneSpeed[w] = this.geneSpeed[r];
        this.geneVision[w] = this.geneVision[r];
        this.geneFertility[w] = this.geneFertility[r];
        this.geneEfficiency[w] = this.geneEfficiency[r];
        this.matingThreshold[w] = this.matingThreshold[r];
        this.maxLitterSize[w] = this.maxLitterSize[r];
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

    this.migrateFromEdge(world, rng);
  }

  /** Same model as PredatorPopulation.migrateFromEdge: a steady border arrival sharing the resident gene pool. */
  private migrateFromEdge(world: World, rng: Rng): void {
    if (rng() >= this.params.edgeMigrationPerTick) return;

    for (let attempts = 0; attempts < 50; attempts++) {
      const along = rng();
      const side = Math.floor(rng() * 4);
      const x = side === 0 ? 0 : side === 1 ? world.width - 1 : Math.floor(along * world.width);
      const y = side === 2 ? 0 : side === 3 ? world.height - 1 : Math.floor(along * world.height);
      if (world.isWater(x, y)) continue;
      const energy = this.params.initialEnergy * this.params.migrantEnergyFraction;
      if (this.length === 0) {
        this.append(x, y, energy, seedGenes(rng));
      } else {
        const kin = Math.floor(rng() * this.length);
        const genes = mutateGenes(this.geneSpeed[kin], this.geneVision[kin], this.geneFertility[kin], this.geneEfficiency[kin], rng);
        this.append(x, y, energy, genes);
      }
      this.migrantCount++;
      return;
    }
  }

  step(world: World, rng: Rng): void {
    this.moveAndFeed(world, rng);
    this.reproduceAndCleanup(world, rng);
  }
}
