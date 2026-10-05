import assert from 'node:assert/strict';
import { test } from 'vitest';
import { HERBIVORE_SPECIES_PRESETS, PREDATOR_SPECIES_PRESETS, SCAVENGER_SPECIES_PRESETS } from '../src/engine/simulation.ts';
import { fractionZero, makeParams, run } from './helpers.ts';

const TICKS = 2500;
const SEEDS = ['audit-1', 'audit-2', 'audit-3'];

function dump(label: string, series: Map<string, number[]>): string {
  return `${label}: ` + [...series].map(([id, v]) => `${id} min=${Math.min(...v)} end=${v[v.length - 1]}`).join(', ');
}

for (const seed of SEEDS) {
  test(`default world, seed ${seed}: every species is still alive and no one explodes`, () => {
    const { series } = run(makeParams({ seed }), TICKS);
    const hint = dump(seed, series);
    for (const h of HERBIVORE_SPECIES_PRESETS) {
      const s = series.get(h.id)!;
      assert.ok(s[s.length - 1] >= 30, `${h.id} nearly extinct at the end. ${hint}`);
      assert.ok(Math.max(...s) < 1500, `${h.id} exploded. ${hint}`);
    }
    for (const p of PREDATOR_SPECIES_PRESETS) {
      const s = series.get(p.id)!;
      assert.ok(fractionZero(s) < 0.1, `${p.id} absent too often. ${hint}`);
    }
    for (const c of SCAVENGER_SPECIES_PRESETS) {
      const s = series.get(c.id)!;
      assert.ok(fractionZero(s) < 0.05, `${c.id} absent too often. ${hint}`);
      assert.ok(Math.max(...s) < 600, `${c.id} exploded. ${hint}`);
    }
  });
}

for (const herb of HERBIVORE_SPECIES_PRESETS) {
  test(`${herb.id} alone persists without predators`, () => {
    const { series } = run(
      makeParams({
        seed: 'audit-0',
        herbivoreSpecies: [{ id: herb.id, initialCount: herb.defaultInitialCount }],
        predatorSpecies: [],
      }),
      TICKS,
    );
    const s = series.get(herb.id)!;
    assert.ok(s[s.length - 1] >= 30, dump('alone', series));
  });
}

for (const pred of PREDATOR_SPECIES_PRESETS) {
  const herb = HERBIVORE_SPECIES_PRESETS.find((h) => h.id === pred.preyId)!;
  test(`${pred.id} + ${herb.id} pair coexists`, () => {
    const { series } = run(
      makeParams({
        seed: 'audit-1',
        herbivoreSpecies: [{ id: herb.id, initialCount: herb.defaultInitialCount }],
        predatorSpecies: [{ id: pred.id, initialCount: pred.defaultInitialCount }],
      }),
      TICKS,
    );
    const hint = dump('pair', series);
    const h = series.get(herb.id)!;
    const p = series.get(pred.id)!;
    assert.ok(h[h.length - 1] >= 30, `prey nearly extinct. ${hint}`);
    assert.ok(fractionZero(p) < 0.1, `predator absent too often. ${hint}`);
  });
}
