import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { inspect, pickAt } from '../src/ui/inspector.ts';
import { makeParams } from './helpers.ts';

test('individual ids stay strictly increasing and resolve to the same individual', () => {
  const sim = new Simulation(makeParams({ seed: 'inspector-ids' }));
  const tracked = sim.herbivoreSpecies[0].population;
  const id = tracked.id[tracked.length - 1];
  let alive = true;
  for (let t = 0; t < 300; t++) {
    sim.step();
    for (const s of [...sim.herbivoreSpecies, ...sim.predatorSpecies]) {
      const pop = s.population;
      for (let i = 1; i < pop.length; i++) assert.ok(pop.id[i] > pop.id[i - 1], `${s.id} ids not sorted at tick ${sim.tick}`);
      for (let i = 0; i < pop.length; i += 7) assert.equal(pop.indexOfId(pop.id[i]), i);
    }
    const index = tracked.indexOfId(id);
    if (index === -1) alive = false;
    else assert.ok(alive, 'a dead individual id must never come back');
  }
});

test('picking an individual follows it across ticks, then reports its death', () => {
  const sim = new Simulation(makeParams({ seed: 'inspector-pick' }));
  const pop = sim.herbivoreSpecies[0].population;
  const selection = pickAt(sim, pop.x[0], pop.y[0]);
  assert.ok(selection.kind === 'individual');
  const label = [...sim.herbivoreSpecies, ...sim.predatorSpecies].find((s) => s.id === selection.speciesId)!.label;

  for (let t = 0; t < 3; t++) sim.step();
  const result = inspect(sim, selection);
  expect(result.overlay.dead).toBe(false);
  expect(result.html).toContain(label);
  expect(result.html).toContain('Gènes');

  for (const s of [...sim.herbivoreSpecies, ...sim.predatorSpecies]) s.population.length = 0;
  const dead = inspect(sim, selection);
  expect(dead.overlay.dead).toBe(true);
  expect(dead.html).toContain('Décédé');
  expect(dead.html).toContain('Gènes');
});

test('picking an empty cell selects the cell and describes it', () => {
  const sim = new Simulation(makeParams({ seed: 'inspector-cell' }));
  for (const s of [...sim.herbivoreSpecies, ...sim.predatorSpecies]) s.population.length = 0;
  const selection = pickAt(sim, 10, 10);
  assert.equal(selection.kind, 'cell');
  const { html } = inspect(sim, selection);
  expect(html).toContain('Biome');
  expect(html).toContain('Biomasse');
});
