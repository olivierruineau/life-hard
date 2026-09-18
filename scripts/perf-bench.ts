// Wall-clock benchmark with a per-phase breakdown, so a perf change can be judged against where
// time actually goes instead of a single aggregate number. Usage:
//   npx tsx scripts/perf-bench.ts [ticks] [seed]
import { Simulation, DEFAULT_SIMULATION_PARAMS } from '../src/engine/simulation.ts';

const ticks = Number(process.argv[2] ?? 3000);
const seed = process.argv[3] ?? 'perf-bench';

const sim = new Simulation({ ...DEFAULT_SIMULATION_PARAMS, seed });

const phases = {
  worldStep: 0,
  moveAndFeed: 0,
  moveAndHunt: 0,
  herbReproduce: 0,
  predReproduce: 0,
};

// Mirrors Simulation.step()'s exact phase order — see src/engine/simulation.ts.
const rng = (sim as unknown as { rng: () => number }).rng;

const start = performance.now();
for (let t = 0; t < ticks; t++) {
  let t0 = performance.now();
  sim.world.step(sim.tick);
  phases.worldStep += performance.now() - t0;

  t0 = performance.now();
  for (const h of sim.herbivoreSpecies) h.population.moveAndFeed(sim.world, rng);
  phases.moveAndFeed += performance.now() - t0;

  t0 = performance.now();
  for (const p of sim.predatorSpecies) p.population.moveAndHunt(sim.world, p.prey, rng);
  phases.moveAndHunt += performance.now() - t0;

  t0 = performance.now();
  for (const h of sim.herbivoreSpecies) h.population.reproduceAndCleanup(sim.world, rng);
  phases.herbReproduce += performance.now() - t0;

  t0 = performance.now();
  for (const p of sim.predatorSpecies) p.population.reproduceAndCleanup(sim.world, rng);
  phases.predReproduce += performance.now() - t0;

  sim.tick++;
}
const totalMs = performance.now() - start;

const herbCount = sim.herbivoreSpecies.reduce((s, x) => s + x.population.length, 0);
const predCount = sim.predatorSpecies.reduce((s, x) => s + x.population.length, 0);

console.log(`ticks=${ticks} seed=${seed} finalHerb=${herbCount} finalPred=${predCount}`);
console.log(`total: ${totalMs.toFixed(0)}ms (${(ticks / (totalMs / 1000)).toFixed(1)} ticks/s)`);
for (const [name, ms] of Object.entries(phases)) {
  console.log(`  ${name}: ${ms.toFixed(0)}ms (${((ms / totalMs) * 100).toFixed(1)}%)`);
}
