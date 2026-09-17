import { Biome } from '../src/engine/biome.ts';
import { DEFAULT_SIMULATION_PARAMS, Simulation } from '../src/engine/simulation.ts';

const ticks = Number(process.argv[2] ?? 5000);
const logEvery = Number(process.argv[3] ?? 100);
const seed = process.argv[4] ?? 'species-balance';

const sim = new Simulation({ ...DEFAULT_SIMULATION_PARAMS, seed });
const forestIndex = Object.values(Biome).indexOf(Biome.Forest);
const extinctLogged = new Set<string>();

function avgSpeed(inds: { genome: { speed: number } }[]): number {
  return inds.length ? inds.reduce((s, i) => s + i.genome.speed, 0) / inds.length : 0;
}

function forestFraction(inds: { x: number; y: number }[]): number {
  if (!inds.length) return 0;
  return inds.filter((i) => sim.world.biome[sim.world.index(i.x, i.y)] === forestIndex).length / inds.length;
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
          s.population.individuals.length,
          avgSpeed(s.population.individuals).toFixed(3),
          forestFraction(s.population.individuals).toFixed(2),
        ]),
        ...sim.predatorSpecies.map((s) => s.population.individuals.length),
      ].join(','),
    );
  }
  for (const s of [...sim.herbivoreSpecies, ...sim.predatorSpecies]) {
    if (s.population.individuals.length === 0 && !extinctLogged.has(s.id)) {
      console.log(`EXTINCT: ${s.id} at tick ${t}`);
      extinctLogged.add(s.id);
    }
  }
  sim.step();
}
