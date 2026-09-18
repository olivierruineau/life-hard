import type { Rng } from './random.ts';

/**
 * Genes are normalized to [0, 1] and always handled as four named scalars — `speed, vision,
 * fertility, efficiency`, in that exact order everywhere below — rather than a `{...}` object.
 * Individuals live in SoA populations (parallel TypedArray columns, see herbivore.ts/predator.ts),
 * so a per-individual genome object would mean allocating and boxing on every read; scalars let
 * callers pass columns[i] directly. The fixed gene order matters for determinism: it's what keeps
 * the sequence of rng() draws identical to the pre-SoA object-keyed-by-GENE_KEYS version.
 */
export type Genes = readonly [speed: number, vision: number, fertility: number, efficiency: number];

const MUTATION_STRENGTH = 0.06;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Sum of three uniforms, recentered: an easy approximation of a bounded gaussian. */
function triangularNoise(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) / 1.5;
}

/**
 * A founder genome close to the species' average, with modest spread — the
 * initial population starts as one interbreeding species; later divergence
 * (drift + selection + mutation) is what can eventually split it in two.
 */
export function seedGenes(rng: Rng, spread = 0.12): Genes {
  const gene = () => clamp01(0.5 + triangularNoise(rng) * spread);
  return [gene(), gene(), gene(), gene()];
}

/** Normalized genetic distance in [0, 1]: 0 = identical, 1 = maximally different. */
export function genomeDistance(
  speedA: number,
  visionA: number,
  fertilityA: number,
  efficiencyA: number,
  speedB: number,
  visionB: number,
  fertilityB: number,
  efficiencyB: number,
): number {
  const dSpeed = speedA - speedB;
  const dVision = visionA - visionB;
  const dFertility = fertilityA - fertilityB;
  const dEfficiency = efficiencyA - efficiencyB;
  const sumSq = dSpeed * dSpeed + dVision * dVision + dFertility * dFertility + dEfficiency * dEfficiency;
  return Math.sqrt(sumSq / 4);
}

/**
 * Deterministic color from a genome, so visually similar individuals share a
 * similar color — genetic clusters ("species") become visible as the
 * population diverges. `hueOffset`/`hueSpan` let a species own a band of the
 * wheel instead of the full range, so distinct species stay visually
 * distinguishable from each other while still showing per-individual
 * genetic variation within their own band.
 */
export function genomeToColor(
  speed: number,
  vision: number,
  fertility: number,
  efficiency: number,
  hueOffset = 0,
  hueSpan = 300,
): string {
  const hue = (hueOffset + (speed * 0.5 + vision * 0.5) * hueSpan) % 360;
  const saturation = 45 + efficiency * 45;
  const lightness = 40 + fertility * 25;
  return `hsl(${hue.toFixed(0)}, ${saturation.toFixed(0)}%, ${lightness.toFixed(0)}%)`;
}

/** Uniform blend-crossover of two parents' genes, no mutation applied. */
export function crossoverGenes(
  speedA: number,
  visionA: number,
  fertilityA: number,
  efficiencyA: number,
  speedB: number,
  visionB: number,
  fertilityB: number,
  efficiencyB: number,
  rng: Rng,
): Genes {
  const blend = (a: number, b: number) => {
    const t = rng();
    return clamp01(a * t + b * (1 - t));
  };
  return [
    blend(speedA, speedB),
    blend(visionA, visionB),
    blend(fertilityA, fertilityB),
    blend(efficiencyA, efficiencyB),
  ];
}

/** Applies independent small mutations to each gene. */
export function mutateGenes(speed: number, vision: number, fertility: number, efficiency: number, rng: Rng): Genes {
  const mutate = (g: number) => clamp01(g + triangularNoise(rng) * MUTATION_STRENGTH);
  return [mutate(speed), mutate(vision), mutate(fertility), mutate(efficiency)];
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/** Physical/behavioral traits derived from a genome, at the ranges tuned in herbivore.ts. */
export interface Phenotype {
  visionRadius: number;
  moveCost: number;
  swimCost: number;
  restMetabolism: number;
  /** Efficiency at converting food (grazed biomass, or a caught prey's energy) into own energy. */
  conversionEfficiency: number;
  matingEnergyThreshold: number;
  maxLitterSize: number;
}

export interface PhenotypeRanges {
  visionRadius: readonly [number, number];
  moveCost: readonly [number, number];
  swimCost: readonly [number, number];
  baseRestMetabolism: number;
  restMetabolismGeneFactor: number;
  conversionEfficiency: readonly [number, number];
  matingEnergyThreshold: readonly [number, number];
  maxLitterSize: readonly [number, number];
}

export function derivePhenotype(
  speed: number,
  vision: number,
  fertility: number,
  efficiency: number,
  ranges: PhenotypeRanges,
): Phenotype {
  return {
    visionRadius: Math.round(lerp(...ranges.visionRadius, vision)),
    moveCost: lerp(...ranges.moveCost, speed),
    swimCost: lerp(...ranges.swimCost, speed),
    restMetabolism: ranges.baseRestMetabolism + (vision + speed + fertility + efficiency) * ranges.restMetabolismGeneFactor,
    conversionEfficiency: lerp(...ranges.conversionEfficiency, efficiency),
    matingEnergyThreshold: lerp(...ranges.matingEnergyThreshold, 1 - fertility),
    maxLitterSize: Math.round(lerp(...ranges.maxLitterSize, fertility)),
  };
}
