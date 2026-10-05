export const GENE_KEYS = ['speed', 'vision', 'fertility', 'efficiency'] as const;
export type GeneKey = (typeof GENE_KEYS)[number];

export const GENE_LABELS: Record<GeneKey, string> = {
  speed: 'Vitesse',
  vision: 'Vision',
  fertility: 'Fécondité',
  efficiency: 'Efficacité',
};

export const GENE_COLORS: Record<GeneKey, string> = {
  speed: '#f2c14e',
  vision: '#4fc3f7',
  fertility: '#f06292',
  efficiency: '#81c784',
};

interface GenePopulation {
  length: number;
  geneSpeed: Float64Array;
  geneVision: Float64Array;
  geneFertility: Float64Array;
  geneEfficiency: Float64Array;
}

export interface GeneStats {
  mean: Record<GeneKey, number>;
  sd: Record<GeneKey, number>;
}

/** Mean and standard deviation of each gene (all NaN when the population is empty). */
export function geneStats(pop: GenePopulation): GeneStats {
  const columns: Record<GeneKey, Float64Array> = {
    speed: pop.geneSpeed,
    vision: pop.geneVision,
    fertility: pop.geneFertility,
    efficiency: pop.geneEfficiency,
  };
  const mean = {} as Record<GeneKey, number>;
  const sd = {} as Record<GeneKey, number>;
  for (const key of GENE_KEYS) {
    const column = columns[key];
    let sum = 0;
    for (let i = 0; i < pop.length; i++) sum += column[i];
    const m = pop.length > 0 ? sum / pop.length : NaN;
    let variance = 0;
    for (let i = 0; i < pop.length; i++) variance += (column[i] - m) ** 2;
    mean[key] = m;
    sd[key] = pop.length > 0 ? Math.sqrt(variance / pop.length) : NaN;
  }
  return { mean, sd };
}

/** Per-species time series of gene means and spreads, sampled every `sampleEvery` ticks. */
export class GeneHistory {
  readonly sampleEvery: number;
  private readonly series = new Map<string, Record<GeneKey, { mean: number[]; sd: number[] }>>();

  constructor(sampleEvery: number) {
    this.sampleEvery = sampleEvery;
  }

  record(speciesId: string, pop: GenePopulation): void {
    let entry = this.series.get(speciesId);
    if (!entry) {
      entry = {} as Record<GeneKey, { mean: number[]; sd: number[] }>;
      for (const key of GENE_KEYS) entry[key] = { mean: [], sd: [] };
      this.series.set(speciesId, entry);
    }
    const stats = geneStats(pop);
    for (const key of GENE_KEYS) {
      entry[key].mean.push(stats.mean[key]);
      entry[key].sd.push(stats.sd[key]);
    }
  }

  get(speciesId: string): Record<GeneKey, { mean: number[]; sd: number[] }> | undefined {
    return this.series.get(speciesId);
  }

  clear(): void {
    this.series.clear();
  }
}
