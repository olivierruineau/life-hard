import type { Rng } from './random.ts';

/** All genes are normalized to [0, 1]; phenotype mapping happens elsewhere. */
export interface Genome {
  speed: number;
  vision: number;
  fertility: number;
  efficiency: number;
}

const GENE_KEYS = ['speed', 'vision', 'fertility', 'efficiency'] as const;

const MUTATION_STRENGTH = 0.06;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Sum of three uniforms, recentered: an easy approximation of a bounded gaussian. */
function triangularNoise(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) / 1.5;
}

export function randomGenome(rng: Rng): Genome {
  return {
    speed: rng(),
    vision: rng(),
    fertility: rng(),
    efficiency: rng(),
  };
}

/**
 * A founder genome close to the species' average, with modest spread — the
 * initial population starts as one interbreeding species; later divergence
 * (drift + selection + mutation) is what can eventually split it in two.
 */
export function seedGenome(rng: Rng, spread = 0.12): Genome {
  const gene = () => clamp01(0.5 + triangularNoise(rng) * spread);
  return {
    speed: gene(),
    vision: gene(),
    fertility: gene(),
    efficiency: gene(),
  };
}

/** Normalized genetic distance in [0, 1]: 0 = identical, 1 = maximally different. */
export function genomeDistance(a: Genome, b: Genome): number {
  let sumSq = 0;
  for (const key of GENE_KEYS) {
    const d = a[key] - b[key];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / GENE_KEYS.length);
}

/**
 * Deterministic color from a genome, so visually similar individuals share a
 * similar color — genetic clusters ("species") become visible as the
 * population diverges.
 */
export function genomeToColor(genome: Genome): string {
  const hue = (genome.speed * 0.5 + genome.vision * 0.5) * 300;
  const saturation = 45 + genome.efficiency * 45;
  const lightness = 40 + genome.fertility * 25;
  return `hsl(${hue.toFixed(0)}, ${saturation.toFixed(0)}%, ${lightness.toFixed(0)}%)`;
}

/** Uniform blend-crossover of two parents' genes, no mutation applied. */
export function crossoverGenome(a: Genome, b: Genome, rng: Rng): Genome {
  const child = {} as Genome;
  for (const key of GENE_KEYS) {
    const blend = rng();
    child[key] = clamp01(a[key] * blend + b[key] * (1 - blend));
  }
  return child;
}

/** Applies independent small mutations to each gene. */
export function mutateGenome(g: Genome, rng: Rng): Genome {
  const mutated = {} as Genome;
  for (const key of GENE_KEYS) {
    mutated[key] = clamp01(g[key] + triangularNoise(rng) * MUTATION_STRENGTH);
  }
  return mutated;
}

/** Crossover followed by mutation — the full inheritance step for a single child. */
export function inheritGenome(a: Genome, b: Genome, rng: Rng): Genome {
  return mutateGenome(crossoverGenome(a, b, rng), rng);
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

export function derivePhenotype(genome: Genome, ranges: PhenotypeRanges): Phenotype {
  return {
    visionRadius: Math.round(lerp(...ranges.visionRadius, genome.vision)),
    moveCost: lerp(...ranges.moveCost, genome.speed),
    swimCost: lerp(...ranges.swimCost, genome.speed),
    restMetabolism:
      ranges.baseRestMetabolism +
      (genome.vision + genome.speed + genome.fertility + genome.efficiency) *
        ranges.restMetabolismGeneFactor,
    conversionEfficiency: lerp(...ranges.conversionEfficiency, genome.efficiency),
    matingEnergyThreshold: lerp(...ranges.matingEnergyThreshold, 1 - genome.fertility),
    maxLitterSize: Math.round(lerp(...ranges.maxLitterSize, genome.fertility)),
  };
}
