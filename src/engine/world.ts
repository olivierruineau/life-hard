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

  private readonly biomeList = Object.values(Biome);

  constructor(params: WorldParams) {
    const { width, height, rng, waterLevel, reliefOctaves, soilProductivity } = params;
    this.width = width;
    this.height = height;

    const cellCount = width * height;
    this.elevation = new Float32Array(cellCount);
    this.moisture = new Float32Array(cellCount);
    this.biome = new Uint8Array(cellCount);
    this.biomass = new Float32Array(cellCount);
    this.biomassMax = new Float32Array(cellCount);
    this.regrowRate = new Float32Array(cellCount);

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
        this.biomassMax[i] = profile.biomassMax * soilProductivity;
        this.regrowRate[i] = profile.regrowRate;
        this.biomass[i] = this.biomassMax[i] * 0.5;
      }
    }
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
    const b = this.biomeAt(x, y);
    return b === Biome.DeepWater || b === Biome.ShallowWater;
  }

  /** Advances vegetation regrowth by one tick. */
  step(): void {
    for (let i = 0; i < this.biomass.length; i++) {
      const max = this.biomassMax[i];
      if (max <= 0) continue;
      const deficit = max - this.biomass[i];
      this.biomass[i] += deficit * this.regrowRate[i];
    }
  }

  consume(x: number, y: number, amount: number): number {
    const i = this.index(x, y);
    const taken = Math.min(this.biomass[i], amount);
    this.biomass[i] -= taken;
    return taken;
  }
}
