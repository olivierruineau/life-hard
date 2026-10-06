import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { makeParams } from './helpers.ts';

describe('snapshot / restore', () => {
  it('a simulation resumed from a JSON round-trip follows exactly the same trajectory', () => {
    const params = makeParams({ seed: 'snap-1', eventRatePerTick: 0.01 });
    const original = new Simulation(params);
    for (let t = 0; t < 400; t++) original.step();

    const saved = JSON.parse(JSON.stringify(original.snapshot()));
    const resumed = Simulation.fromSnapshot(saved);
    expect(resumed.tick).toBe(original.tick);

    for (let t = 0; t < 400; t++) {
      original.step();
      resumed.step();
    }
    expect(JSON.stringify(resumed.snapshot())).toBe(JSON.stringify(original.snapshot()));
  });

  it('keeps stable ids so a followed individual can still be found after loading', () => {
    const sim = new Simulation(makeParams({ seed: 'snap-2' }));
    for (let t = 0; t < 100; t++) sim.step();
    const resumed = Simulation.fromSnapshot(JSON.parse(JSON.stringify(sim.snapshot())));
    const pop = sim.herbivoreSpecies[0].population;
    const copy = resumed.herbivoreSpecies[0].population;
    const id = pop.id[Math.floor(pop.length / 2)];
    expect(copy.indexOfId(id)).toBe(pop.indexOfId(id));
  });

  it('rejects a snapshot from another format version', () => {
    const snap = new Simulation(makeParams({ seed: 'snap-3' })).snapshot();
    expect(() => Simulation.fromSnapshot({ ...snap, version: 999 })).toThrow(/version/);
  });
});
