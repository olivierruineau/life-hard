import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { makeParams } from './helpers.ts';

// audit-0 is mostly plains (4623 of 5636 land cells) and so hosts the biggest herbivore population
// of the audit seeds (~2700). That is not a runaway: the herd saturates at a carrying capacity
// proportional to the land area (~0.5 herbivore per land cell on every audit seed) and the
// vegetation stays healthy there. The raw "more than 1500 herbivores" threshold only reflects the
// map size, so the guard is on density and on the state of the vegetation.
describe('herbivore carrying capacity', () => {
  it('a plains-heavy map saturates at a bounded density without wrecking the vegetation', () => {
    const sim = new Simulation(makeParams({ seed: 'audit-0' }));
    const w = sim.world;
    let land = 0;
    for (let i = 0; i < w.biomass.length; i++) if (w.baseBiomassMax[i] > 0) land++;

    const densities: number[] = [];
    for (let t = 1; t <= 8000; t++) {
      sim.step();
      if (t >= 6000 && t % 250 === 0) densities.push(sim.herbivoreSpecies.reduce((n, s) => n + s.population.length, 0) / land);
    }

    expect(Math.max(...densities)).toBeLessThan(0.65);

    let biomass = 0;
    let max = 0;
    let fertility = 0;
    for (let i = 0; i < w.biomass.length; i++) {
      if (w.baseBiomassMax[i] <= 0) continue;
      biomass += w.biomass[i];
      max += w.biomassMax[i];
      fertility += w.fertility[i];
    }
    expect(biomass / max).toBeGreaterThan(0.4);
    expect(fertility / land).toBeGreaterThan(0.8);
  });
});
