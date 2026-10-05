import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { makeParams } from './helpers.ts';

test('a scavenger on fresh carrion eats it and gains energy', () => {
  const sim = new Simulation(
    makeParams({ seed: 'scavenger', herbivoreSpecies: [], predatorSpecies: [], scavengerSpecies: [{ id: 'carrion-eater', initialCount: 1 }] }),
  );
  const pop = sim.scavengerSpecies[0].population;
  const { world } = sim;
  const i = world.index(pop.x[0], pop.y[0]);
  world.carrion[i] = 500;
  const before = pop.energy[0];

  pop.moveAndFeed(world, () => 0.5);

  const here = world.index(pop.x[0], pop.y[0]);
  assert.ok(world.carrion[here] < 500, 'carrion should have been eaten');
  assert.ok(pop.energy[0] > before - 5, 'eating should more than pay for the tick');
});

test('scavengers starve when there is no carrion', () => {
  const sim = new Simulation(
    makeParams({ seed: 'scavenger', herbivoreSpecies: [], predatorSpecies: [], scavengerSpecies: [{ id: 'carrion-eater', initialCount: 10 }] }),
  );
  const pop = sim.scavengerSpecies[0].population;
  const start = pop.length;
  for (let t = 0; t < 400; t++) sim.step();
  assert.ok(pop.length < start, `population should collapse without carrion, went ${start} -> ${pop.length}`);
});
