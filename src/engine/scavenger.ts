import { restoreColumns, snapshotColumns, type PopulationSnapshot } from './snapshot.ts';
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
import { chooseGreedyMove, randomBorderLandCell, SpatialGrid } from './movement.ts';
import type { Rng } from './random.ts';
import { performMating, type ReproductionParams } from './reproduction.ts';
import type { World } from './world.ts';

export interface ScavengerParams extends ReproductionParams {
  initialEnergy: number;
  /** Organic matter a dead body leaves on its cell (on top of any energy it still holds). */
  carcassEnergy: number;
  /** Max carrion (energy units) eaten per tick. */
  eatRate: number;
  phenotypeRanges: PhenotypeRanges;
  /** Carrion below this amount on a cell isn't worth walking to. */
  minCarrionWorthEating: number;

  matureAge: number;
  senescenceRate: number;
  maxAge: number;

  edgeMigrationPerTick: number;
  migrantEnergyFraction: number;
}

export const DEFAULT_SCAVENGER_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [3, 8],
  moveCost: [0.3, 0.12],
  swimCost: [3, 1],
  baseRestMetabolism: 0.5,
  restMetabolismGeneFactor: 0.06,
  geneCostCurvature: 3,
  conversionEfficiency: [0.4, 0.7],
  matingEnergyThreshold: [70, 110],
  maxLitterSize: [1, 2],
};

export const DEFAULT_SCAVENGER_PARAMS: ScavengerParams = {
  initialEnergy: 60,
  carcassEnergy: 40,
  eatRate: 25,
  minLitterSize: 1,
  litterCostBase: 40,
  litterCostExponent: 1.5,
  childEnergyEfficiency: 0.55,
  reproductionCooldown: 40,
  matingRadius: 2,
  maxMatingDistance: 0.4,
  phenotypeRanges: DEFAULT_SCAVENGER_PHENOTYPE_RANGES,
  minCarrionWorthEating: 1,

  matureAge: 400,
  senescenceRate: 0.01,
  maxAge: 800,

  edgeMigrationPerTick: 0.004,
  migrantEnergyFraction: 0.6,
};

/**
 * SoA storage, same layout as HerbivorePopulation/PredatorPopulation. Scavengers feed on the
 * carrion left by every other species' dead (see World.carrion), so their energy comes from what
 * would otherwise just rot: they don't take it from any population's growth, which is what lets a
 * trophic level this high actually persist.
 */
const SNAPSHOT_COLUMNS = ['id', 'x', 'y', 'energy', 'cooldown', 'age', 'geneSpeed', 'geneVision', 'geneFertility', 'geneEfficiency', 'matingThreshold', 'maxLitterSize'] as const;

export class ScavengerPopulation {
  length = 0;
  /** Cumulative count of individuals that arrived via `migrateFromEdge` (diagnostic). */
  migrantCount = 0;
  private capacity = 0;
  private nextId = 0;
  /** Stable per-individual id, strictly increasing with index (see HerbivorePopulation.id). */
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
  matingThreshold: Float64Array = new Float64Array(0);
  maxLitterSize: Float64Array = new Float64Array(0);

  private grid: SpatialGrid | undefined;
  readonly params: ScavengerParams;

  constructor(params: ScavengerParams) {
    this.params = params;
  }

  traits(i: number): Phenotype {
    return derivePhenotype(this.geneSpeed[i], this.geneVision[i], this.geneFertility[i], this.geneEfficiency[i], this.params.phenotypeRanges);
  }

  color(i: number, hueOffset: number, hueSpan: number): string {
    return genomeToColor(this.geneSpeed[i], this.geneVision[i], this.geneFertility[i], this.geneEfficiency[i], hueOffset, hueSpan);
  }

  snapshot(): PopulationSnapshot {
    return snapshotColumns(this, SNAPSHOT_COLUMNS, this.length, this.nextId, this.migrantCount);
  }

  /** Replaces every individual with the ones in `snapshot`. */
  restore(snapshot: PopulationSnapshot): void {
    this.length = 0;
    this.ensureCapacity(snapshot.length);
    restoreColumns(this, SNAPSHOT_COLUMNS, snapshot);
    this.length = snapshot.length;
    this.nextId = snapshot.nextId;
    this.migrantCount = snapshot.migrantCount;
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

  /** Aging, movement toward the richest carrion in sight, feeding, and mating-cooldown tick-down. */
  moveAndFeed(world: World, rng: Rng): void {
    const minWorth = this.params.minCarrionWorthEating;
    const scoreAt = (_x: number, _y: number, idx: number) => (world.carrion[idx] >= minWorth ? world.carrion[idx] : 0);

    for (let i = 0; i < this.length; i++) {
      this.age[i]++;
      const traits = this.traits(i);
      const senescence = Math.max(0, this.age[i] - this.params.matureAge) * this.params.senescenceRate;
      this.energy[i] -= traits.restMetabolism + senescence;

      const [dx, dy] = chooseGreedyMove(world, this.x[i], this.y[i], traits.visionRadius, scoreAt, rng, 0.1);
      if (dx !== 0 || dy !== 0) {
        this.x[i] += dx;
        this.y[i] += dy;
        this.energy[i] -= world.isWater(this.x[i], this.y[i]) ? traits.swimCost : traits.moveCost;
      }

      if (!world.isWater(this.x[i], this.y[i])) {
        const eaten = world.consumeCarrion(this.x[i], this.y[i], this.params.eatRate);
        this.energy[i] += eaten * traits.conversionEfficiency;
      }

      if (this.cooldown[i] > 0) this.cooldown[i]--;
    }
  }

  /** Mating, death (starvation or old age), and spawning newborns. */
  reproduceAndCleanup(world: World, rng: Rng): void {
    const grid = this.rebuildGrid(world);
    const events = performMating(this, grid, world, this.params, (i) => this.matingThreshold[i], (i) => this.maxLitterSize[i], rng);

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

  private migrateFromEdge(world: World, rng: Rng): void {
    if (rng() >= this.params.edgeMigrationPerTick) return;

    const cell = randomBorderLandCell(world, rng);
    if (!cell) return;
    const [x, y] = cell;
    const energy = this.params.initialEnergy * this.params.migrantEnergyFraction;
    if (this.length === 0) {
      this.append(x, y, energy, seedGenes(rng));
    } else {
      const kin = Math.floor(rng() * this.length);
      const genes = mutateGenes(this.geneSpeed[kin], this.geneVision[kin], this.geneFertility[kin], this.geneEfficiency[kin], rng);
      this.append(x, y, energy, genes);
    }
    this.migrantCount++;
  }
}
