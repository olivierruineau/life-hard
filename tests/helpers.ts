import { DEFAULT_SIMULATION_PARAMS, Simulation, type SimulationParams } from '../src/engine/simulation.ts';

export function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return { ...DEFAULT_SIMULATION_PARAMS, ...overrides };
}

interface Column {
  length: number;
  x: Int32Array;
  y: Int32Array;
  energy: Float64Array;
  age: Int32Array;
  geneSpeed: Float64Array;
}

function summarize(pop: Column): string {
  let x = 0;
  let y = 0;
  let energy = 0;
  let age = 0;
  let speed = 0;
  for (let i = 0; i < pop.length; i++) {
    x += pop.x[i];
    y += pop.y[i];
    energy += pop.energy[i];
    age += pop.age[i];
    speed += pop.geneSpeed[i];
  }
  return [pop.length, x, y, energy.toFixed(6), age, speed.toFixed(9)].join('/');
}

/** Exact, order-sensitive digest of the whole simulation state that matters for reproducibility. */
export function fingerprint(sim: Simulation): string {
  let biomass = 0;
  for (let i = 0; i < sim.world.biomass.length; i++) biomass += sim.world.biomass[i];
  return [
    sim.tick,
    biomass.toFixed(3),
    ...sim.herbivoreSpecies.map((s) => `${s.id}:${summarize(s.population)}`),
    ...sim.predatorSpecies.map((s) => `${s.id}:${summarize(s.population)}`),
    ...sim.scavengerSpecies.map((s) => `${s.id}:${summarize(s.population)}`),
  ].join('|');
}

export interface RunStats {
  /** Population count of every species at each sampled tick. */
  series: Map<string, number[]>;
  sim: Simulation;
}

export function run(params: SimulationParams, ticks: number, sampleEvery = 10): RunStats {
  const sim = new Simulation(params);
  const series = new Map<string, number[]>();
  const species = [...sim.herbivoreSpecies, ...sim.predatorSpecies, ...sim.scavengerSpecies];
  for (const s of species) series.set(s.id, []);
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (t % sampleEvery === 0) for (const s of species) series.get(s.id)!.push(s.population.length);
  }
  return { series, sim };
}

export function fractionZero(values: number[]): number {
  return values.filter((v) => v === 0).length / values.length;
}
