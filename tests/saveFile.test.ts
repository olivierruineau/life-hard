import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { historyToCsv } from '../src/ui/csv.ts';
import { GeneHistory } from '../src/ui/geneStats.ts';
import { parseSave, serializeSave } from '../src/ui/saveFile.ts';
import { makeParams } from './helpers.ts';

function runWithHistory(ticks: number) {
  const sim = new Simulation(makeParams({ seed: 'save-1' }));
  const populations = new Map<string, number[]>();
  const hues = new Map<string, number>();
  const genes = new GeneHistory(5);
  const species = [...sim.herbivoreSpecies, ...sim.predatorSpecies, ...sim.scavengerSpecies];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (const s of species) {
      hues.set(s.id, s.hueOffset);
      const history = populations.get(s.id) ?? [];
      history.push(s.population.length);
      populations.set(s.id, history);
      if (sim.tick % 5 === 0) genes.record(s.id, s.population);
    }
  }
  return { sim, populations, hues, genes };
}

describe('save file', () => {
  it('round-trips the simulation and its history', () => {
    const { sim, populations, hues, genes } = runWithHistory(60);
    const loaded = parseSave(serializeSave(sim.snapshot(), populations, hues, genes));
    expect(loaded.simulation.tick).toBe(60);
    expect(loaded.history.populations['plains-grazer']).toEqual(populations.get('plains-grazer'));
    const restoredGenes = new GeneHistory(5);
    restoredGenes.load(loaded.history.genes);
    expect(restoredGenes.get('plains-grazer')!.speed.mean).toEqual(genes.get('plains-grazer')!.speed.mean);
  });

  it('refuses files that are not saves', () => {
    expect(() => parseSave('not json')).toThrow(/JSON/);
    expect(() => parseSave('{"hello": 1}')).toThrow(/life-hard/);
  });
});

describe('historyToCsv', () => {
  it('has one row per tick, population columns, and gene columns only on sampled ticks', () => {
    const { populations, genes } = runWithHistory(20);
    const lines = historyToCsv(populations, genes).trim().split('\n');
    const header = lines[0].split(',');
    expect(lines).toHaveLength(21);
    expect(header[0]).toBe('tick');
    expect(header).toContain('plains-grazer.population');
    expect(header).toContain('plains-grazer.speed.mean');
    const speedCol = header.indexOf('plains-grazer.speed.mean');
    expect(lines[4].split(',')[speedCol]).toBe('');
    expect(Number(lines[5].split(',')[speedCol])).toBeGreaterThan(0);
    expect(lines[5].split(',')).toHaveLength(header.length);
  });
});
