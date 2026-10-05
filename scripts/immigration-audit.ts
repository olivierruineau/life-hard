import { DEFAULT_SIMULATION_PARAMS, HERBIVORE_SPECIES_PRESETS, PREDATOR_SPECIES_PRESETS, SCAVENGER_SPECIES_PRESETS, Simulation } from '../src/engine/simulation.ts';

// Usage: tsx scripts/immigration-audit.ts [ticks=8000] [seedStart=0] [seedEnd=6] [immigration=on|off]
// PRED_OVERRIDE='{"catchBaseChance":0.3,"plains-courser":{...}}' merges PredatorParams into every preset (or one, via its id key).
const ticks = Number(process.argv[2] ?? 8000);
const seedStart = Number(process.argv[3] ?? 0);
const seedEnd = Number(process.argv[4] ?? 6);
const immigration = (process.argv[5] ?? 'on') === 'on';

if (!immigration) for (const p of PREDATOR_SPECIES_PRESETS) p.params.edgeMigrationPerTick = 0;
if (process.env.PRED_OVERRIDE) {
  const override = JSON.parse(process.env.PRED_OVERRIDE);
  for (const p of PREDATOR_SPECIES_PRESETS) {
    const { 'plains-courser': courser, 'forest-stalker': stalker, ...shared } = override;
    Object.assign(p.params, shared, p.id === 'plains-courser' ? courser : stalker);
  }
}

if (process.env.CURVE !== undefined) {
  // Overrides geneCostCurvature (0 = old linear upkeep) on every species' phenotype ranges.
  const curvature = Number(process.env.CURVE);
  for (const p of [...HERBIVORE_SPECIES_PRESETS, ...PREDATOR_SPECIES_PRESETS, ...SCAVENGER_SPECIES_PRESETS]) {
    p.params.phenotypeRanges.geneCostCurvature = curvature;
  }
}

if (process.env.HERB_OVERRIDE) {
  // JSON merged into every herbivore preset's params; keys 'plains-grazer'/'forest-browser' target one species.
  const { 'plains-grazer': grazer, 'forest-browser': browser, ...shared } = JSON.parse(process.env.HERB_OVERRIDE);
  for (const p of HERBIVORE_SPECIES_PRESETS) Object.assign(p.params, shared, p.id === 'plains-grazer' ? grazer : browser);
}
if (process.env.COST_SCALE) {
  const f = Number(process.env.COST_SCALE);
  for (const p of PREDATOR_SPECIES_PRESETS) {
    const r = p.params.phenotypeRanges;
    p.params.phenotypeRanges = {
      ...r,
      baseRestMetabolism: r.baseRestMetabolism * f,
      restMetabolismGeneFactor: r.restMetabolismGeneFactor * f,
      moveCost: [r.moveCost[0] * f, r.moveCost[1] * f],
      swimCost: [r.swimCost[0] * f, r.swimCost[1] * f],
    };
  }
}
for (let k = seedStart; k < seedEnd; k++) {
  const seed = `audit-${k}`;
  const eventRatePerTick = process.env.EVENT_RATE !== undefined ? Number(process.env.EVENT_RATE) : DEFAULT_SIMULATION_PARAMS.eventRatePerTick;
  const sim = new Simulation({ ...DEFAULT_SIMULATION_PARAMS, seed, eventRatePerTick });
  const stats = sim.predatorSpecies.map(() => ({ extinctAt: -1, min: Infinity, sum: 0, zeroTicks: 0 }));
  let herbMin = Infinity;
  let herbMax = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.predatorSpecies.forEach((s, i) => {
      const n = s.population.length;
      const st = stats[i];
      if (n === 0 && st.extinctAt < 0) st.extinctAt = t;
      if (n === 0) st.zeroTicks++;
      if (t >= 500) st.min = Math.min(st.min, n);
      st.sum += n;
    });
    for (const h of sim.herbivoreSpecies) herbMax = Math.max(herbMax, h.population.length);
    if (t >= 500) for (const h of sim.herbivoreSpecies) herbMin = Math.min(herbMin, h.population.length);
  }
  let fertilitySum = 0;
  let landCells = 0;
  let carrionTotal = 0;
  for (let c = 0; c < sim.world.biomass.length; c++) {
    carrionTotal += sim.world.carrion[c];
    if (sim.world.isWaterMask[c] === 0) {
      fertilitySum += sim.world.fertility[c];
      landCells++;
    }
  }
  const meanFertility = fertilitySum / landCells;
  sim.predatorSpecies.forEach((s, i) => {
    const st = stats[i];
    console.log([seed, s.id, st.extinctAt, st.min, (st.sum / ticks).toFixed(1), s.population.migrantCount, herbMin, (st.zeroTicks / ticks).toFixed(3), herbMax, ...sim.herbivoreSpecies.map((h) => h.population.length), meanFertility.toFixed(3), carrionTotal.toFixed(0)].join(','));
  });
}
