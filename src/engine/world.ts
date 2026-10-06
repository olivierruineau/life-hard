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

// Decomposition: every dead body leaves organic matter (`carrion`, in energy units) on its cell.
// It rots at CARRION_DECAY_RATE per tick (half-life ~70 ticks) and what rots feeds the soil, so
// the nutrients taken out by grazing come back where animals die. Fertility is capped at 1, so
// this only matters on degraded soil — exactly where starvation deaths pile up.
const CARRION_DECAY_RATE = 0.01;
const FERTILITY_PER_DECOMPOSED_CARRION = 0.004;

// Climate events. A drought cuts the vegetation cap on a disc of cells for a while (full strength
// for most of its duration, then easing back), so biomass withers gradually through the normal
// regrowth rule. A fire wipes the biomass of a disc at once and leaves the soil to regrow; its
// `scorch` mark only fades for display.
const DROUGHT_MAX_CAP_LOSS = 0.8;
const DROUGHT_EASE_FRACTION = 0.3;
const SCORCH_DECAY = 0.985;

interface Drought {
  cx: number;
  cy: number;
  radius: number;
  startTick: number;
  endTick: number;
}

/** Everything in a World that changes after generation (terrain is rebuilt from the seed). */
export interface WorldSnapshot {
  biomass: number[];
  biomassMax: number[];
  fertility: number[];
  carrion: number[];
  consumedLastTick: number[];
  drought: number[];
  scorch: number[];
  droughts: Drought[];
}

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
  /** Organic matter (energy units) left by dead individuals, decomposing into soil fertility. */
  readonly carrion: Float32Array;
  /** Drought intensity (0-1) per cell, 0 outside any active drought. */
  readonly drought: Float32Array;
  /** Fire mark (0-1) per cell, 1 when just burnt and decaying afterwards. */
  readonly scorch: Float32Array;
  private readonly droughts: Drought[] = [];
  private scorchActive = false;
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
    this.carrion = new Float32Array(cellCount);
    this.drought = new Float32Array(cellCount);
    this.scorch = new Float32Array(cellCount);

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
    this.updateEvents(tick);
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

        const decomposed = this.carrion[i] * CARRION_DECAY_RATE;
        if (decomposed > 0) {
          this.carrion[i] -= decomposed;
          this.fertility[i] = Math.min(1, this.fertility[i] + decomposed * FERTILITY_PER_DECOMPOSED_CARRION);
        }

        const max = base * this.fertility[i] * seasonalFactor * (1 - DROUGHT_MAX_CAP_LOSS * this.drought[i]);
        this.biomassMax[i] = max;
        const deficit = max - this.biomass[i];
        this.biomass[i] += deficit * this.regrowRate[i];
      }
    }
  }

  /** Starts a drought on a disc centered on (cx, cy) lasting `duration` ticks from `tick`. */
  startDrought(cx: number, cy: number, radius: number, tick: number, duration: number): void {
    this.droughts.push({ cx, cy, radius, startTick: tick, endTick: tick + duration });
  }

  /** Burns every plant on a disc centered on (cx, cy): biomass drops to 0 and regrows from there. */
  startFire(cx: number, cy: number, radius: number): void {
    this.forEachCellInDisc(cx, cy, radius, (i) => {
      if (this.baseBiomassMax[i] <= 0) return;
      this.biomass[i] = 0;
      this.scorch[i] = 1;
      this.scorchActive = true;
    });
  }

  snapshot(): WorldSnapshot {
    return {
      biomass: Array.from(this.biomass),
      biomassMax: Array.from(this.biomassMax),
      fertility: Array.from(this.fertility),
      carrion: Array.from(this.carrion),
      consumedLastTick: Array.from(this.consumedLastTick),
      drought: Array.from(this.drought),
      scorch: Array.from(this.scorch),
      droughts: this.droughts.map((d) => ({ ...d })),
    };
  }

  restore(snapshot: WorldSnapshot): void {
    const arrays = {
      biomass: this.biomass,
      biomassMax: this.biomassMax,
      fertility: this.fertility,
      carrion: this.carrion,
      consumedLastTick: this.consumedLastTick,
      drought: this.drought,
      scorch: this.scorch,
    };
    for (const [name, target] of Object.entries(arrays)) {
      const values = snapshot[name as keyof typeof arrays];
      if (values.length !== target.length) throw new Error(`Snapshot does not match this world size ("${name}")`);
      target.set(values);
    }
    this.droughts.length = 0;
    this.droughts.push(...snapshot.droughts.map((d) => ({ ...d })));
    this.scorchActive = this.scorch.some((v) => v > 0);
  }

  get activeDroughtCount(): number {
    return this.droughts.length;
  }

  private forEachCellInDisc(cx: number, cy: number, radius: number, fn: (i: number) => void): void {
    const r2 = radius * radius;
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) fn(y * this.width + x);
      }
    }
  }

  private updateEvents(tick: number): void {
    if (this.droughts.length > 0) {
      this.drought.fill(0);
      for (let k = this.droughts.length - 1; k >= 0; k--) {
        const d = this.droughts[k];
        if (tick >= d.endTick) {
          this.droughts.splice(k, 1);
          continue;
        }
        const duration = d.endTick - d.startTick;
        const remaining = (d.endTick - tick) / (duration * DROUGHT_EASE_FRACTION);
        const intensity = Math.min(1, remaining);
        this.forEachCellInDisc(d.cx, d.cy, d.radius, (i) => {
          if (intensity > this.drought[i]) this.drought[i] = intensity;
        });
      }
      if (this.droughts.length === 0) this.drought.fill(0);
    }
    if (this.scorchActive) {
      let any = false;
      for (let i = 0; i < this.scorch.length; i++) {
        if (this.scorch[i] === 0) continue;
        this.scorch[i] *= SCORCH_DECAY;
        if (this.scorch[i] < 0.02) this.scorch[i] = 0;
        else any = true;
      }
      this.scorchActive = any;
    }
  }

  /** Leaves organic matter on a land cell (bodies that sink in water are simply lost). */
  depositCarrion(x: number, y: number, amount: number): void {
    const i = this.index(x, y);
    if (amount > 0 && this.isWaterMask[i] === 0) this.carrion[i] += amount;
  }

  /** Removes up to `amount` carrion from a cell and returns what was actually taken. */
  consumeCarrion(x: number, y: number, amount: number): number {
    const i = this.index(x, y);
    const taken = Math.min(this.carrion[i], amount);
    this.carrion[i] -= taken;
    return taken;
  }

  consume(x: number, y: number, amount: number): number {
    const i = this.index(x, y);
    const taken = Math.min(this.biomass[i], amount);
    this.biomass[i] -= taken;
    this.consumedLastTick[i] += taken;
    return taken;
  }
}
