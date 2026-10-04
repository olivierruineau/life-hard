import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { makeParams } from './helpers.ts';

interface Column {
  length: number;
  x: Int32Array;
  y: Int32Array;
  energy: Float64Array;
  age: Int32Array;
  geneSpeed: Float64Array;
  geneVision: Float64Array;
  geneFertility: Float64Array;
  geneEfficiency: Float64Array;
}

function checkPopulation(label: string, pop: Column, sim: Simulation): void {
  const { width, height } = sim.world;
  for (let i = 0; i < pop.length; i++) {
    const where = `${label}[${i}] at tick ${sim.tick}`;
    assert.ok(pop.x[i] >= 0 && pop.x[i] < width && pop.y[i] >= 0 && pop.y[i] < height, `${where}: out of bounds`);
    assert.ok(Number.isFinite(pop.energy[i]), `${where}: non-finite energy`);
    assert.ok(pop.age[i] >= 0, `${where}: negative age`);
    for (const gene of [pop.geneSpeed[i], pop.geneVision[i], pop.geneFertility[i], pop.geneEfficiency[i]]) {
      assert.ok(gene >= 0 && gene <= 1, `${where}: gene ${gene} outside [0,1]`);
    }
  }
}

test('population and world state stay valid over a long run', () => {
  const sim = new Simulation(makeParams({ seed: 'invariants' }));
  for (let t = 0; t < 1500; t++) {
    sim.step();
    if (t % 100 !== 0) continue;
    for (const s of [...sim.herbivoreSpecies, ...sim.predatorSpecies]) checkPopulation(s.id, s.population, sim);
    for (let i = 0; i < sim.world.biomass.length; i++) {
      assert.ok(Number.isFinite(sim.world.biomass[i]) && sim.world.biomass[i] >= 0, `biomass[${i}] invalid at tick ${sim.tick}`);
      const f = sim.world.fertility[i];
      assert.ok(f > 0 && f <= 1, `fertility[${i}] = ${f} at tick ${sim.tick}`);
    }
  }
});
