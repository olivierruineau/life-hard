import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { makeParams } from './helpers.ts';

function landCell(sim: Simulation): { x: number; y: number } {
  const { world } = sim;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) if (!world.isWater(x, y)) return { x, y };
  }
  throw new Error('no land');
}

test('carrion rots away and restores fertility on degraded soil', () => {
  const sim = new Simulation(makeParams({ seed: 'carrion', herbivoreSpecies: [], predatorSpecies: [] }));
  const { world } = sim;
  const { x, y } = landCell(sim);
  const i = world.index(x, y);
  world.fertility[i] = 0.5;
  world.depositCarrion(x, y, 100);

  for (let t = 0; t < 300; t++) world.step(t);

  assert.ok(world.carrion[i] < 10, `carrion should mostly be gone, got ${world.carrion[i]}`);
  assert.ok(world.fertility[i] > 0.5, 'decomposition should have fertilized the soil');
  assert.ok(world.fertility[i] <= 1);
});

test('bodies sinking in water leave nothing behind', () => {
  const sim = new Simulation(makeParams({ seed: 'carrion', herbivoreSpecies: [], predatorSpecies: [] }));
  const { world } = sim;
  for (let c = 0; c < world.isWaterMask.length; c++) {
    if (world.isWaterMask[c] === 1) {
      world.depositCarrion(c % world.width, Math.floor(c / world.width), 50);
      assert.equal(world.carrion[c], 0);
      return;
    }
  }
});

test('deaths in a running simulation deposit organic matter', () => {
  const sim = new Simulation(makeParams({ seed: 'carrion' }));
  for (let t = 0; t < 400; t++) sim.step();
  let total = 0;
  for (let c = 0; c < sim.world.carrion.length; c++) total += sim.world.carrion[c];
  assert.ok(total > 0);
});
