export const Biome = {
  DeepWater: 'deep_water',
  ShallowWater: 'shallow_water',
  Beach: 'beach',
  Plains: 'plains',
  Forest: 'forest',
  Hills: 'hills',
  Mountain: 'mountain',
} as const;

export type Biome = (typeof Biome)[keyof typeof Biome];

export interface BiomeProfile {
  /** Max biomass the cell can hold. */
  biomassMax: number;
  /** Biomass regrown per tick, scaled toward biomassMax. */
  regrowRate: number;
}

export const BIOME_PROFILES: Record<Biome, BiomeProfile> = {
  [Biome.DeepWater]: { biomassMax: 0, regrowRate: 0 },
  [Biome.ShallowWater]: { biomassMax: 0, regrowRate: 0 },
  [Biome.Beach]: { biomassMax: 20, regrowRate: 0.02 },
  [Biome.Plains]: { biomassMax: 100, regrowRate: 0.06 },
  [Biome.Forest]: { biomassMax: 140, regrowRate: 0.05 },
  [Biome.Hills]: { biomassMax: 70, regrowRate: 0.03 },
  [Biome.Mountain]: { biomassMax: 15, regrowRate: 0.01 },
};

/** Derives a biome from elevation and moisture, both in [0, 1]. */
export function classifyBiome(elevation: number, moisture: number, waterLevel: number): Biome {
  if (elevation < waterLevel * 0.6) return Biome.DeepWater;
  if (elevation < waterLevel) return Biome.ShallowWater;
  if (elevation < waterLevel + 0.03) return Biome.Beach;
  if (elevation > 0.85) return Biome.Mountain;
  if (elevation > 0.65) return Biome.Hills;
  if (moisture > 0.5) return Biome.Forest;
  return Biome.Plains;
}
