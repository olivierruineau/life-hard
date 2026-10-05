import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { GENE_KEYS, GeneHistory, geneStats } from '../src/ui/geneStats.ts';
import { makeParams } from './helpers.ts';

describe('geneStats', () => {
  it('computes mean and standard deviation of a known column', () => {
    const column = new Float64Array([0.2, 0.4, 0.6]);
    const stats = geneStats({ length: 3, geneSpeed: column, geneVision: column, geneFertility: column, geneEfficiency: column });
    expect(stats.mean.speed).toBeCloseTo(0.4);
    expect(stats.sd.speed).toBeCloseTo(Math.sqrt(0.08 / 3));
  });

  it('returns NaN for an empty population', () => {
    const empty = new Float64Array(0);
    const stats = geneStats({ length: 0, geneSpeed: empty, geneVision: empty, geneFertility: empty, geneEfficiency: empty });
    expect(stats.mean.vision).toBeNaN();
    expect(stats.sd.vision).toBeNaN();
  });

  it('records bounded means for a running species', () => {
    const sim = new Simulation(makeParams({ seed: 'genes-1' }));
    const history = new GeneHistory(5);
    for (let t = 0; t < 100; t++) {
      sim.step();
      if ((t + 1) % 5 === 0) for (const s of sim.herbivoreSpecies) history.record(s.id, s.population);
    }
    const series = history.get(sim.herbivoreSpecies[0].id)!;
    for (const key of GENE_KEYS) {
      expect(series[key].mean).toHaveLength(20);
      for (const m of series[key].mean) {
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(1);
      }
    }
  });
});
