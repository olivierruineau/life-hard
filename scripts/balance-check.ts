import { Simulation, DEFAULT_SIMULATION_PARAMS } from '../src/engine/simulation.ts';

const ticks = Number(process.argv[2] ?? 2000);
const logEvery = Number(process.argv[3] ?? 50);

const sim = new Simulation({ ...DEFAULT_SIMULATION_PARAMS, seed: process.argv[4] ?? 'balance' });

console.log('tick,herbivores,predators,avgHerbEnergy,avgPredEnergy,avgBiomass');

function totalCount(species: { population: { length: number } }[]): number {
  return species.reduce((sum, s) => sum + s.population.length, 0);
}

function totalEnergy(species: { population: { length: number; energy: Float32Array } }[]): number {
  let sum = 0;
  for (const s of species) for (let i = 0; i < s.population.length; i++) sum += s.population.energy[i];
  return sum;
}

for (let t = 0; t <= ticks; t++) {
  const hCount = totalCount(sim.herbivoreSpecies);
  const pCount = totalCount(sim.predatorSpecies);
  if (t % logEvery === 0) {
    const avgH = hCount ? totalEnergy(sim.herbivoreSpecies) / hCount : 0;
    const avgP = pCount ? totalEnergy(sim.predatorSpecies) / pCount : 0;
    let biomassSum = 0;
    for (let i = 0; i < sim.world.biomass.length; i++) biomassSum += sim.world.biomass[i];
    const avgBiomass = biomassSum / sim.world.biomass.length;
    console.log(`${t},${hCount},${pCount},${avgH.toFixed(1)},${avgP.toFixed(1)},${avgBiomass.toFixed(2)}`);
  }
  if (hCount === 0 && pCount === 0) {
    console.log('EXTINCTION_TOTALE at tick', t);
    break;
  }
  sim.step();
}
