// Does the herbivore population, starting as one tight-genome founder population, ever actually
// drift/select into two mutually-incompatible clusters (genomeDistance > maxMatingDistance)?
// Runs long and periodically reports genome spread + a crude 2-means split to see if a visible
// species boundary emerges, rather than just noisy drift around one blob.
import { Simulation, DEFAULT_SIMULATION_PARAMS } from '../src/engine/simulation.ts';
import { genomeDistance, type Genome } from '../src/engine/genetics.ts';
import { DEFAULT_HERBIVORE_PARAMS } from '../src/engine/herbivore.ts';

const GENE_KEYS = ['speed', 'vision', 'fertility', 'efficiency'] as const;

function mean(genomes: Genome[]): Genome {
  const m = { speed: 0, vision: 0, fertility: 0, efficiency: 0 };
  for (const g of genomes) for (const k of GENE_KEYS) m[k] += g[k];
  for (const k of GENE_KEYS) m[k] /= genomes.length;
  return m;
}

// One pass of 2-means on genomes (4D), returns centroids + assignment.
function twoMeans(genomes: Genome[], seedA: Genome, seedB: Genome, iters = 15) {
  let a = seedA;
  let b = seedB;
  let assign: number[] = [];
  for (let it = 0; it < iters; it++) {
    assign = genomes.map((g) => (genomeDistance(g, a) <= genomeDistance(g, b) ? 0 : 1));
    const groupA = genomes.filter((_, i) => assign[i] === 0);
    const groupB = genomes.filter((_, i) => assign[i] === 1);
    if (groupA.length === 0 || groupB.length === 0) break;
    a = mean(groupA);
    b = mean(groupB);
  }
  return { a, b, assign };
}

const ticks = Number(process.argv[2] ?? 30000);
const logEvery = Number(process.argv[3] ?? 2000);
const seed = process.argv[4] ?? 'spec1';

// Isolate the plains-grazer/plains-courser pair only, matching the original single-species
// scenario this diagnostic was built for (the multi-species default would mix in forest-browser's
// separate gene pool and predation from both predator species, confounding the drift measurement).
const sim = new Simulation({
  ...DEFAULT_SIMULATION_PARAMS,
  seed,
  herbivoreSpecies: DEFAULT_SIMULATION_PARAMS.herbivoreSpecies.map((s) => ({
    ...s,
    initialCount: s.id === 'plains-grazer' ? s.initialCount : 0,
  })),
  predatorSpecies: DEFAULT_SIMULATION_PARAMS.predatorSpecies.map((s) => ({
    ...s,
    initialCount: s.id === 'plains-courser' ? s.initialCount : 0,
  })),
});

console.log('tick,population,maxPairDist(sample),clusterSep,clusterSpreadA,clusterSpreadB,incompatibleFraction');

const grazers = sim.herbivoreSpecies[0].population;

for (let t = 0; t <= ticks; t++) {
  if (t % logEvery === 0) {
    const genomes = grazers.individuals.map((h) => h.genome);
    if (genomes.length < 4) {
      console.log(`${t},${genomes.length},-,-,-,-,-`);
      sim.step();
      continue;
    }

    // Sample-based max pairwise distance (full O(n^2) too slow at large n).
    const sampleSize = Math.min(200, genomes.length);
    const sample = genomes.slice(0, sampleSize);
    let maxDist = 0;
    let incompatiblePairs = 0;
    let totalPairs = 0;
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        const d = genomeDistance(sample[i], sample[j]);
        if (d > maxDist) maxDist = d;
        totalPairs++;
        if (d > DEFAULT_HERBIVORE_PARAMS.maxMatingDistance) incompatiblePairs++;
      }
    }

    // Seed 2-means from the two most distant sampled genomes to encourage finding a real split.
    let seedA = sample[0];
    let seedB = sample[1];
    let bestD = -1;
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        const d = genomeDistance(sample[i], sample[j]);
        if (d > bestD) { bestD = d; seedA = sample[i]; seedB = sample[j]; }
      }
    }
    const { a, b, assign } = twoMeans(genomes, seedA, seedB);
    const groupA = genomes.filter((_, i) => assign[i] === 0);
    const groupB = genomes.filter((_, i) => assign[i] === 1);
    const spreadA = groupA.length ? groupA.reduce((s, g) => s + genomeDistance(g, a), 0) / groupA.length : 0;
    const spreadB = groupB.length ? groupB.reduce((s, g) => s + genomeDistance(g, b), 0) / groupB.length : 0;
    const clusterSep = genomeDistance(a, b);

    console.log(
      `${t},${genomes.length},${maxDist.toFixed(3)},${clusterSep.toFixed(3)},${spreadA.toFixed(3)},${spreadB.toFixed(3)},${(incompatiblePairs / totalPairs).toFixed(3)}`,
    );
  }
  sim.step();
}
