import { BIOME_PROFILES, Biome, classifyBiome } from './biome.ts';
import { ValueNoise2D } from './noise.ts';
import type { Rng } from './random.ts';

export interface WorldParams {
  width: number;
  height: number;
  rng: Rng;
  /** Fraction of the elevation range treated as water, in [0, 1]. */
  waterLevel: number;
  /** Roughness of the terrain: higher = more varied relief. */
  reliefOctaves: number;
  /** Global multiplier on every biome's max biomass, applied uniformly. */
  soilProductivity: number;
  /** Ticks for one full seasonal cycle. 0 disables seasons. */
  seasonPeriod: number;
  /** Max fractional swing (0-1) a seasonal cycle applies to biomassMax at the map's edges. */
  seasonAmplitude: number;
}

// Overgrazing feedback: a cell's `fertility` (soil health, 0-1) is a slow-moving multiplier on
// top of its biome's base biomassMax. It erodes when a cell is consumed faster than it can
// naturally regrow (grazing pressure outpacing regrowth), and recovers slowly when left alone —
// semi-permanent by design (erosion/recovery rates are an order of magnitude slower than
// regrowRate itself), so a hotspot that gets hammered stays visibly poorer for a long time rather
// than bouncing back next tick. MIN_FERTILITY keeps a floor so no cell becomes a permanent dead
// zone a population could starve against with no way back.
const OVERGRAZE_PRESSURE_THRESHOLD = 1.2;
const UNDERGRAZE_PRESSURE_THRESHOLD = 0.4;
const FERTILITY_EROSION_RATE = 0.015;
const FERTILITY_RECOVERY_RATE = 0.004;
const MIN_FERTILITY = 0.15;

export class World {
  readonly width: number;
  readonly height: number;

  readonly elevation: Float32Array;
  readonly moisture: Float32Array;
  readonly biome: Uint8Array;
  readonly biomass: Float32Array;
  readonly biomassMax: Float32Array;
  readonly regrowRate: Float32Array;
  /** Fixed per-cell cap from biome profile * soilProductivity, before fertility/season erosion. */
  readonly baseBiomassMax: Float32Array;
  /** Soil health multiplier (0-1) eroded by overgrazing and slowly recovered when ungrazed. */
  readonly fertility: Float32Array;
  /** 1 where the cell is DeepWater/ShallowWater, 0 otherwise — precomputed once so `isWater` and
   * the movement hot loop (`chooseGreedyMove`, scanning up to a few hundred cells per individual
   * per tick) are a single flat read instead of a biome-array lookup + string comparison. */
  readonly isWaterMask: Uint8Array;
  private readonly consumedLastTick: Float32Array;
  private readonly seasonPeriod: number;
  private readonly seasonAmplitude: number;
  private readonly equatorY: number;

  private readonly biomeList = Object.values(Biome);

  constructor(params: WorldParams) {
    const { width, height, rng, waterLevel, reliefOctaves, soilProductivity, seasonPeriod, seasonAmplitude } = params;
    this.width = width;
    this.height = height;
    this.seasonPeriod = seasonPeriod;
    this.seasonAmplitude = seasonAmplitude;
    this.equatorY = height / 2;

    const cellCount = width * height;
    this.elevation = new Float32Array(cellCount);
    this.moisture = new Float32Array(cellCount);
    this.biome = new Uint8Array(cellCount);
    this.biomass = new Float32Array(cellCount);
    this.biomassMax = new Float32Array(cellCount);
    this.regrowRate = new Float32Array(cellCount);
    this.baseBiomassMax = new Float32Array(cellCount);
    this.fertility = new Float32Array(cellCount).fill(1);
    this.isWaterMask = new Uint8Array(cellCount);
    this.consumedLastTick = new Float32Array(cellCount);

    const elevationNoise = new ValueNoise2D(rng);
    const moistureNoise = new ValueNoise2D(rng);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const elevation = elevationNoise.fractal(x, y, reliefOctaves, 1 / 24, 0.5);
        const moisture = moistureNoise.fractal(x, y, 3, 1 / 32, 0.5);
        const biome = classifyBiome(elevation, moisture, waterLevel);
        const profile = BIOME_PROFILES[biome];

        this.elevation[i] = elevation;
        this.moisture[i] = moisture;
        this.biome[i] = this.biomeList.indexOf(biome);
        this.isWaterMask[i] = biome === Biome.DeepWater || biome === Biome.ShallowWater ? 1 : 0;
        this.baseBiomassMax[i] = profile.biomassMax * soilProductivity;
        this.regrowRate[i] = profile.regrowRate;
        this.biomassMax[i] = this.baseBiomassMax[i] * this.seasonalFactorAt(y, 0);
        this.biomass[i] = this.biomassMax[i] * 0.5;
      }
    }
  }

  /** Seasonal biomassMax multiplier: hemispheres (split at the map's vertical center) swing in
   * opposite phase, strongest at the top/bottom edges and ~flat at the equator row, mirroring how
   * real seasonality is muted near the equator and pronounced toward the poles. Squaring the
   * latitude falloff (instead of linear) keeps most of the map mild and confines the strong swing
   * to a band near the edges — a full-strength gradient across the whole height was dragging
   * entire populations to whichever edge currently peaked, instead of a partial, gradual pull.
   * The floor is also raised well above bare survival so the losing hemisphere stays viable
   * enough that migrating away is a preference, not the only way to avoid starving. */
  private seasonalFactorAt(y: number, tick: number): number {
    if (this.seasonAmplitude <= 0 || this.seasonPeriod <= 0) return 1;
    const half = this.height / 2;
    const linearDist = half > 0 ? Math.abs(y - this.equatorY) / half : 0;
    const distFromEquator = linearDist * linearDist;
    const hemisphereSign = y < this.equatorY ? -1 : 1;
    const phase = (2 * Math.PI * (tick % this.seasonPeriod)) / this.seasonPeriod;
    const factor = 1 + this.seasonAmplitude * distFromEquator * hemisphereSign * Math.sin(phase);
    return Math.max(0.4, factor);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  biomeAt(x: number, y: number): Biome {
    return this.biomeList[this.biome[this.index(x, y)]];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isWater(x: number, y: number): boolean {
    return this.isWaterMask[this.index(x, y)] === 1;
  }

  /** Updates fertility from last tick's grazing pressure, applies season, and regrows vegetation. */
  step(tick: number): void {
    for (let y = 0; y < this.height; y++) {
      const seasonalFactor = this.seasonalFactorAt(y, tick);
      for (let x = 0; x < this.width; x++) {
        const i = this.index(x, y);
        const base = this.baseBiomassMax[i];
        if (base <= 0) continue;

        const referenceRegrow = base * this.regrowRate[i];
        if (referenceRegrow > 0) {
          const pressure = this.consumedLastTick[i] / referenceRegrow;
          if (pressure > OVERGRAZE_PRESSURE_THRESHOLD) {
            this.fertility[i] = Math.max(
              MIN_FERTILITY,
              this.fertility[i] - FERTILITY_EROSION_RATE * (pressure - OVERGRAZE_PRESSURE_THRESHOLD),
            );
          } else if (pressure < UNDERGRAZE_PRESSURE_THRESHOLD) {
            this.fertility[i] = Math.min(1, this.fertility[i] + FERTILITY_RECOVERY_RATE);
          }
        }
        this.consumedLastTick[i] = 0;

        const max = base * this.fertility[i] * seasonalFactor;
        this.biomassMax[i] = max;
        const deficit = max - this.biomass[i];
        this.biomass[i] += deficit * this.regrowRate[i];
      }
    }
  }

  consume(x: number, y: number, amount: number): number {
    const i = this.index(x, y);
    const taken = Math.min(this.biomass[i], amount);
    this.biomass[i] -= taken;
    this.consumedLastTick[i] += taken;
    return taken;
  }
}
