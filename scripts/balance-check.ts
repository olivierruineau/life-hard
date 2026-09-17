import { Simulation, DEFAULT_SIMULATION_PARAMS } from '../src/engine/simulation.ts';

const ticks = Number(process.argv[2] ?? 2000);
const logEvery = Number(process.argv[3] ?? 50);

const sim = new Simulation({ ...DEFAULT_SIMULATION_PARAMS, seed: process.argv[4] ?? 'balance' });

console.log('tick,herbivores,predators,avgHerbEnergy,avgPredEnergy,avgBiomass');

for (let t = 0; t <= ticks; t++) {
  if (t % logEvery === 0) {
    const h = sim.herbivores.individuals;
    const p = sim.predators.individuals;
    const avgH = h.length ? h.reduce((s, i) => s + i.energy, 0) / h.length : 0;
    const avgP = p.length ? p.reduce((s, i) => s + i.energy, 0) / p.length : 0;
    let biomassSum = 0;
    for (let i = 0; i < sim.world.biomass.length; i++) biomassSum += sim.world.biomass[i];
    const avgBiomass = biomassSum / sim.world.biomass.length;
    console.log(`${t},${h.length},${p.length},${avgH.toFixed(1)},${avgP.toFixed(1)},${avgBiomass.toFixed(2)}`);
  }
  if (sim.herbivores.individuals.length === 0 && sim.predators.individuals.length === 0) {
    console.log('EXTINCTION_TOTALE at tick', t);
    break;
  }
  sim.step();
}
