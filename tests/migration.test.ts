import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/engine/simulation.ts';
import { makeParams } from './helpers.ts';

test('an extinct predator population is refilled from the map border by migration', () => {
  const sim = new Simulation(makeParams({ seed: 'migration' }));
  const species = sim.predatorSpecies[0];
  const pop = species.population;
  pop.length = 0;
  const { width, height } = sim.world;

  for (let t = 0; t < 2000 && pop.migrantCount === 0; t++) sim.step();

  assert.ok(pop.migrantCount > 0, 'no migrant arrived in 2000 ticks');
  assert.ok(pop.length >= 1);
  assert.equal(pop.migrantCount, 1);
  const i = 0;
  const onBorder = pop.x[i] === 0 || pop.x[i] === width - 1 || pop.y[i] === 0 || pop.y[i] === height - 1;
  assert.ok(onBorder, 'migrant should appear on the border');
});
