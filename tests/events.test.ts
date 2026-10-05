import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { fingerprint, makeParams } from './helpers.ts';

function landCell(sim: Simulation): { x: number; y: number } {
  const w = sim.world;
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) if (w.baseBiomassMax[w.index(x, y)] > 0) return { x, y };
  }
  throw new Error('no land');
}

describe('climate events', () => {
  it('a fire zeroes biomass in its disc, leaves the outside alone, and the vegetation regrows', () => {
    const sim = new Simulation(makeParams({ seed: 'ev-fire', eventRatePerTick: 0, herbivoreSpecies: [], predatorSpecies: [], scavengerSpecies: [] }));
    const { x, y } = landCell(sim);
    const w = sim.world;
    const i = w.index(x, y);
    const far = w.index(w.width - 1, w.height - 1);
    const farBefore = w.biomass[far];
    sim.triggerEvent('fire', x, y);
    expect(w.biomass[i]).toBe(0);
    expect(w.scorch[i]).toBe(1);
    expect(w.biomass[far]).toBe(farBefore);
    for (let t = 0; t < 300; t++) sim.step();
    expect(w.biomass[i]).toBeGreaterThan(0.5 * w.biomassMax[i]);
    expect(w.scorch[i]).toBe(0);
  });

  it('a drought cuts the vegetation cap while it lasts, then it is back to normal', () => {
    const sim = new Simulation(makeParams({ seed: 'ev-drought', eventRatePerTick: 0, seasonAmplitude: 0, herbivoreSpecies: [], predatorSpecies: [], scavengerSpecies: [] }));
    const { x, y } = landCell(sim);
    const w = sim.world;
    const i = w.index(x, y);
    sim.step();
    const normalMax = w.biomassMax[i];
    sim.triggerEvent('drought', x, y);
    for (let t = 0; t < 100; t++) sim.step();
    expect(w.drought[i]).toBeGreaterThan(0);
    expect(w.biomassMax[i]).toBeLessThan(0.5 * normalMax);
    expect(w.biomass[i]).toBeLessThan(normalMax);
    for (let t = 0; t < 700; t++) sim.step();
    expect(w.drought[i]).toBe(0);
    expect(w.activeDroughtCount).toBe(0);
    expect(w.biomassMax[i]).toBeCloseTo(normalMax, 3);
  });

  it('random events fire at the configured rate and stay deterministic', () => {
    const params = makeParams({ seed: 'ev-rand', eventRatePerTick: 0.02, herbivoreSpecies: [], predatorSpecies: [], scavengerSpecies: [] });
    const a = new Simulation(params);
    const b = new Simulation(params);
    let burnt = 0;
    for (let t = 0; t < 400; t++) {
      a.step();
      b.step();
      if (a.world.scorch.some((v) => v > 0.9)) burnt++;
    }
    expect(burnt).toBeGreaterThan(0);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});
