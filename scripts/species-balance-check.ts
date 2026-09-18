import { Biome } from '../src/engine/biome.ts';
import { DEFAULT_SIMULATION_PARAMS, Simulation } from '../src/engine/simulation.ts';

const ticks = Number(process.argv[2] ?? 5000);
const logEvery = Number(process.argv[3] ?? 100);
const seed = process.argv[4] ?? 'species-balance';

const sim = new Simulation({ ...DEFAULT_SIMULATION_PARAMS, seed });
const forestIndex = Object.values(Biome).indexOf(Biome.Forest);
const extinctLogged = new Set<string>();

interface SoAPopulation {
  length: number;
  x: Int32Array;
  y: Int32Array;
  geneSpeed: Float32Array;
}

function avgSpeed(pop: SoAPopulation): number {
  if (!pop.length) return 0;
  let sum = 0;
  for (let i = 0; i < pop.length; i++) sum += pop.geneSpeed[i];
  return sum / pop.length;
}

function forestFraction(pop: SoAPopulation): number {
  if (!pop.length) return 0;
  let inForest = 0;
  for (let i = 0; i < pop.length; i++) {
    if (sim.world.biome[sim.world.index(pop.x[i], pop.y[i])] === forestIndex) inForest++;
  }
  return inForest / pop.length;
}

console.log(
  [
    'tick',
    ...sim.herbivoreSpecies.flatMap((s) => [`${s.id}_count`, `${s.id}_avgSpeed`, `${s.id}_forestFrac`]),
    ...sim.predatorSpecies.map((s) => `${s.id}_count`),
  ].join(','),
);

for (let t = 0; t <= ticks; t++) {
  if (t % logEvery === 0) {
    console.log(
      [
        t,
        ...sim.herbivoreSpecies.flatMap((s) => [
          s.population.length,
          avgSpeed(s.population).toFixed(3),
          forestFraction(s.population).toFixed(2),
        ]),
        ...sim.predatorSpecies.map((s) => s.population.length),
      ].join(','),
    );
  }
  for (const s of [...sim.herbivoreSpecies, ...sim.predatorSpecies]) {
    if (s.population.length === 0 && !extinctLogged.has(s.id)) {
      console.log(`EXTINCT: ${s.id} at tick ${t}`);
      extinctLogged.add(s.id);
    }
  }
  sim.step();
}
