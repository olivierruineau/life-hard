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
import type { HerbivorePopulation } from './herbivore.ts';
import { chooseGreedyMove, SpatialGrid } from './movement.ts';
import type { Rng } from './random.ts';
import { performMating, type ReproductionParams } from './reproduction.ts';
import type { World } from './world.ts';

export interface PredatorParams extends ReproductionParams {
  initialEnergy: number;
  /** Organic matter a dead body leaves on its cell (on top of any energy it still holds). */
  carcassEnergy: number;
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

  /** Per-tick probability that one individual walks in from the map's edge (constant flux, independent of population size). */
  edgeMigrationPerTick: number;
  /** Energy a migrant arrives with, as a fraction of `initialEnergy` (travel leaves them worn). */
  migrantEnergyFraction: number;
}

// Costs are deliberately low: a predator pack's equilibrium size is (prey harvest) / (per-capita
// upkeep), and at the old upkeep it settled around 10-20 individuals — too few to ride out the
// predator/prey cycle's trough in a closed map, so the species only survived through a rescue
// mechanism. Cheaper upkeep raises the equilibrium pack size enough to persist on its own.
export const DEFAULT_PREDATOR_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [3, 8],
  moveCost: [0.12, 0.05],
  swimCost: [1, 0.5],
  baseRestMetabolism: 0.18,
  restMetabolismGeneFactor: 0.028,
  conversionEfficiency: [0.55, 0.85],
  matingEnergyThreshold: [70, 100],
  maxLitterSize: [1, 3],
};

export const DEFAULT_PREDATOR_PARAMS: PredatorParams = {
  initialEnergy: 150,
  carcassEnergy: 90,
  minLitterSize: 1,
  litterCostBase: 35,
  litterCostExponent: 1.5,
  childEnergyEfficiency: 0.5,
  reproductionCooldown: 50,
  matingRadius: 2,
  maxMatingDistance: 0.4,
  phenotypeRanges: DEFAULT_PREDATOR_PHENOTYPE_RANGES,

  // Gentle catch rate: at 0.5 the pack over-harvested, drove its prey down to a handful and starved
  // with it, going extinct within ~1000 ticks.
  catchBaseChance: 0.2,
  catchSpeedFactor: 0.25,
  huntRadius: 2,
  huntCooldown: 18,
  scarcityReferencePopulation: 250,
  scarcityFloor: 0.05,
  predatorInterferenceStrength: 0.5,

  matureAge: 300,
  senescenceRate: 0.02,
  maxAge: 700,

  edgeMigrationPerTick: 0.008,
  migrantEnergyFraction: 0.6,
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
  /** Ticks remaining before this predator can attempt another catch (digestion). */
  huntCooldown: Int32Array = new Int32Array(0);
  // matingEnergyThreshold/maxLitterSize depend only on geneFertility, which never changes after
  // birth — computed once in `append` and cached here (see HerbivorePopulation for the full
  // rationale: this used to be recomputed via full derivePhenotype for the whole population on
  // every reproduceAndCleanup call).
  matingThreshold: Float64Array = new Float64Array(0);
  maxLitterSize: Float64Array = new Float64Array(0);

  private grid: SpatialGrid | undefined;
  readonly params: PredatorParams;

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
    this.huntCooldown = grow(this.huntCooldown) as Int32Array;
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
    this.huntCooldown[i] = 0;
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

  /** Aging, movement toward under-hunted prey patches, hunting, and mating-cooldown tick-down. */
  moveAndHunt(world: World, herbivores: HerbivorePopulation, rng: Rng): void {
    const preyGrid = herbivores.rebuildGrid(world);
    // All predators share the same greedy movement heuristic, so without this they'd all converge
    // on the single richest prey cell and permanently crowd each other out there (territoriality
    // avoids that): a predator prefers prey-rich cells that aren't already staked out by others,
    // spreading hunting pressure across multiple patches instead of hammering one hotspot.
    const predatorGrid = this.rebuildGrid(world);
    const territorialScoreAt = (_x: number, _y: number, idx: number) => {
      const preyCount = preyGrid.cellCountAt(idx);
      if (preyCount === 0) return 0;
      const rivals = predatorGrid.cellCountAt(idx);
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
        ? (x: number, y: number, idx: number) => {
            const count = predatorGrid.cellCountAt(idx);
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
            world.depositCarrion(herbivores.x[preyIdx], herbivores.y[preyIdx], herbivores.energy[preyIdx] * (1 - traits.conversionEfficiency));
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

    const events = performMating(
      this,
      grid,
      world,
      this.params,
      (i) => this.matingThreshold[i],
      (i) => this.maxLitterSize[i],
      rng,
    );

    let w = 0;
    for (let r = 0; r < this.length; r++) {
      if (this.energy[r] <= 0 || this.age[r] >= this.params.maxAge) {
        world.depositCarrion(this.x[r], this.y[r], this.params.carcassEnergy + Math.max(0, this.energy[r]));
        continue;
      }
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
        this.huntCooldown[w] = this.huntCooldown[r];
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

  /**
   * A closed pack of a few dozen on one mapped patch is part of a wider metapopulation: individuals
   * keep trickling in from neighboring territory, always across the map's border and at a rate that
   * doesn't depend on how many are already here (a steady external source, not a rescue triggered
   * by near-extinction). Migrants share the resident gene pool when there is one, arrive worn from
   * the trip, and have to find food and mates like everyone else.
   */
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
}
