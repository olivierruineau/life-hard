import { Biome } from './biome.ts';
import type { PhenotypeRanges } from './genetics.ts';
import {
  DEFAULT_HERBIVORE_PARAMS,
  DEFAULT_PHENOTYPE_RANGES,
  HerbivorePopulation,
  type BiomeAffinity,
  type HerbivoreParams,
} from './herbivore.ts';
import { DEFAULT_PREDATOR_PARAMS, DEFAULT_PREDATOR_PHENOTYPE_RANGES, PredatorPopulation, type PredatorParams } from './predator.ts';
import { hashStringToSeed, mulberry32, type Rng } from './random.ts';
import { World } from './world.ts';

export interface SpeciesSelection {
  id: string;
  initialCount: number;
}

export interface HerbivoreSpeciesPreset {
  id: string;
  label: string;
  /** Base hue (degrees) this species' individuals are colored around. */
  hueOffset: number;
  defaultInitialCount: number;
  params: HerbivoreParams;
}

export interface PredatorSpeciesPreset {
  id: string;
  label: string;
  hueOffset: number;
  defaultInitialCount: number;
  params: PredatorParams;
  /** id of the HerbivoreSpeciesPreset this predator hunts. */
  preyId: string;
}

export interface HerbivoreSpeciesInstance {
  id: string;
  label: string;
  hueOffset: number;
  population: HerbivorePopulation;
}

export interface PredatorSpeciesInstance {
  id: string;
  label: string;
  hueOffset: number;
  population: PredatorPopulation;
  prey: HerbivorePopulation;
}

// Biome preference (see HerbivoreParams.biomeAffinity): without this, every herbivore species
// chases the single richest biome on the map (Forest, biomassMax 140) regardless of niche, since
// chooseGreedyMove only ever sees raw biomass quantity. Weights are strong enough to flip the
// *preferred* biome's weighted score above Forest's despite Forest's raw abundance advantage
// (e.g. plains-grazer: 100 * 1.3 = 130 > 140 * 0.5 = 70), not just nudge it.
const PLAINS_GRAZER_AFFINITY: BiomeAffinity = {
  [Biome.Plains]: 1.3,
  [Biome.Hills]: 1.0,
  [Biome.Beach]: 0.8,
  [Biome.Forest]: 0.5,
  [Biome.Mountain]: 0.5,
};

const FOREST_BROWSER_AFFINITY: BiomeAffinity = {
  [Biome.Forest]: 1.3,
  [Biome.Hills]: 1.1,
  [Biome.Beach]: 0.6,
  [Biome.Plains]: 0.45,
  [Biome.Mountain]: 0.5,
};

// Vision-heavy, costlier-moving forest specialist: leans on spotting rich
// patches rather than covering ground cheaply, converts food better once it
// finds it, and breeds more conservatively — a different bet than the plains
// grazer's cheap-movement, high-throughput strategy. Foraging capability
// (eatRate, moveCost) is kept at parity with the grazer rather than strictly
// worse — a niche that's simply weaker at the same game reliably starved to
// extinction in isolation testing when both species converged on the same
// biome; the differentiation is a genuinely different strategy (wider
// vision, cheaper upkeep, pickier/slower reproduction, different preferred
// biome), not a handicap.
const FOREST_BROWSER_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [3, 8],
  moveCost: [0.9, 0.3],
  swimCost: [6, 2],
  baseRestMetabolism: 1.0,
  restMetabolismGeneFactor: 0.15,
  conversionEfficiency: [0.4, 0.7],
  matingEnergyThreshold: [75, 110],
  maxLitterSize: [1, 3],
};

const FOREST_BROWSER_PARAMS: HerbivoreParams = {
  ...DEFAULT_HERBIVORE_PARAMS,
  phenotypeRanges: FOREST_BROWSER_PHENOTYPE_RANGES,
  biomeAffinity: FOREST_BROWSER_AFFINITY,
  matureAge: 300,
  maxAge: 650,
};

// Sized down to match a smaller browser population: wider vision/hunt radius
// to compensate for sparser prey, lower metabolism, and a scarcity/immigration
// safety net scaled to the smaller prey base — the catch/interference/scarcity
// formulas themselves are untouched.
const FOREST_STALKER_PHENOTYPE_RANGES: PhenotypeRanges = {
  visionRadius: [4, 10],
  moveCost: [0.45, 0.2],
  swimCost: [3.5, 1.8],
  baseRestMetabolism: 0.45,
  restMetabolismGeneFactor: 0.07,
  conversionEfficiency: [0.55, 0.85],
  matingEnergyThreshold: [70, 100],
  maxLitterSize: [1, 3],
};

const FOREST_STALKER_PARAMS: PredatorParams = {
  ...DEFAULT_PREDATOR_PARAMS,
  phenotypeRanges: FOREST_STALKER_PHENOTYPE_RANGES,
  // A smaller starting predator count still lands enough simultaneous strikes early on (while prey
  // is naively abundant) to crash a browser population that dips as low as ~19 even on its own —
  // isolation testing needed catchBaseChance dialed down from the plains-courser baseline, not just
  // the population-scale-dependent safety nets (scarcity reference, immigration threshold), to stop
  // that early burst from pushing the browser population past its own recovery floor.
  catchBaseChance: 0.22,
  scarcityReferencePopulation: 130,
  immigrationThreshold: 4,
};

export const HERBIVORE_SPECIES_PRESETS: HerbivoreSpeciesPreset[] = [
  {
    id: 'plains-grazer',
    label: 'Herbivores (plaine)',
    hueOffset: 0,
    defaultInitialCount: 150,
    params: { ...DEFAULT_HERBIVORE_PARAMS, phenotypeRanges: DEFAULT_PHENOTYPE_RANGES, biomeAffinity: PLAINS_GRAZER_AFFINITY },
  },
  {
    id: 'forest-browser',
    label: 'Herbivores (forêt)',
    hueOffset: 90,
    defaultInitialCount: 130,
    params: FOREST_BROWSER_PARAMS,
  },
];

export const PREDATOR_SPECIES_PRESETS: PredatorSpeciesPreset[] = [
  {
    id: 'plains-courser',
    label: 'Prédateurs (plaine)',
    hueOffset: 180,
    defaultInitialCount: 15,
    params: { ...DEFAULT_PREDATOR_PARAMS, phenotypeRanges: DEFAULT_PREDATOR_PHENOTYPE_RANGES },
    preyId: 'plains-grazer',
  },
  {
    id: 'forest-stalker',
    label: 'Prédateurs (forêt)',
    hueOffset: 270,
    // Re-validated with the current catchBaseChance/scarcityReferencePopulation/immigrationThreshold
    // tuning (see FOREST_STALKER_PARAMS above): stable across 8000+ ticks both in isolation with
    // forest-browser and alongside the plains pair, in and out of scarcity dips, thanks to the
    // low-rate immigration trickle recovering it after near-extinctions rather than the population
    // ever hard-crashing to 0.
    defaultInitialCount: 15,
    params: FOREST_STALKER_PARAMS,
    preyId: 'forest-browser',
  },
];

export interface SimulationParams {
  width: number;
  height: number;
  seed: string;
  waterLevel: number;
  reliefOctaves: number;
  /** Global multiplier on every biome's max biomass (soil fertility), applied uniformly. */
  soilProductivity: number;
  /** Ticks for one full seasonal cycle. 0 disables seasons. */
  seasonPeriod: number;
  /** Max fractional swing (0-1) a seasonal cycle applies to biomassMax at the map's edges. */
  seasonAmplitude: number;
  herbivoreSpecies: SpeciesSelection[];
  predatorSpecies: SpeciesSelection[];
}

export const DEFAULT_SIMULATION_PARAMS: SimulationParams = {
  width: 96,
  height: 64,
  seed: 'life-hard',
  waterLevel: 0.35,
  reliefOctaves: 5,
  soilProductivity: 1,
  seasonPeriod: 1200,
  seasonAmplitude: 0.15,
  herbivoreSpecies: HERBIVORE_SPECIES_PRESETS.map((p) => ({ id: p.id, initialCount: p.defaultInitialCount })),
  predatorSpecies: PREDATOR_SPECIES_PRESETS.map((p) => ({ id: p.id, initialCount: p.defaultInitialCount })),
};

export class Simulation {
  readonly world: World;
  readonly herbivoreSpecies: HerbivoreSpeciesInstance[];
  readonly predatorSpecies: PredatorSpeciesInstance[];
  private readonly rng: Rng;
  readonly params: SimulationParams;
  tick = 0;

  constructor(params: SimulationParams) {
    this.params = params;
    this.rng = mulberry32(hashStringToSeed(params.seed));
    this.world = new World({
      width: params.width,
      height: params.height,
      rng: this.rng,
      waterLevel: params.waterLevel,
      reliefOctaves: params.reliefOctaves,
      soilProductivity: params.soilProductivity,
      seasonPeriod: params.seasonPeriod,
      seasonAmplitude: params.seasonAmplitude,
    });

    this.herbivoreSpecies = [];
    for (const preset of HERBIVORE_SPECIES_PRESETS) {
      const count = params.herbivoreSpecies.find((s) => s.id === preset.id)?.initialCount ?? 0;
      if (count <= 0) continue;
      const population = new HerbivorePopulation(preset.params);
      population.spawnRandom(this.world, count, this.rng);
      this.herbivoreSpecies.push({ id: preset.id, label: preset.label, hueOffset: preset.hueOffset, population });
    }

    this.predatorSpecies = [];
    for (const preset of PREDATOR_SPECIES_PRESETS) {
      const count = params.predatorSpecies.find((s) => s.id === preset.id)?.initialCount ?? 0;
      if (count <= 0) continue;
      const preyInstance = this.herbivoreSpecies.find((h) => h.id === preset.preyId);
      if (!preyInstance) {
        console.warn(`Predator species "${preset.id}" skipped: prey species "${preset.preyId}" is not active.`);
        continue;
      }
      const population = new PredatorPopulation(preset.params);
      population.spawnRandom(this.world, count, this.rng);
      this.predatorSpecies.push({
        id: preset.id,
        label: preset.label,
        hueOffset: preset.hueOffset,
        population,
        prey: preyInstance.population,
      });
    }
  }

  step(): void {
    this.world.step(this.tick);
    for (const h of this.herbivoreSpecies) h.population.moveAndFeed(this.world, this.rng);
    for (const p of this.predatorSpecies) p.population.moveAndHunt(this.world, p.prey, this.rng);
    for (const h of this.herbivoreSpecies) h.population.reproduceAndCleanup(this.world, this.rng);
    for (const p of this.predatorSpecies) p.population.reproduceAndCleanup(this.world, this.rng);
    this.tick++;
  }
}
