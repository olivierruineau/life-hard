import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Simulation } from '../src/engine/simulation.ts';
import { fingerprint, makeParams } from './helpers.ts';

function runFingerprints(seed: string, checkpoints: number[]): string[] {
  const sim = new Simulation(makeParams({ seed }));
  const out: string[] = [];
  for (const target of checkpoints) {
    while (sim.tick < target) sim.step();
    out.push(fingerprint(sim));
  }
  return out;
}

test('same seed reproduces the exact same simulation', () => {
  const checkpoints = [1, 150, 600];
  assert.deepEqual(runFingerprints('determinism', checkpoints), runFingerprints('determinism', checkpoints));
});

test('different seeds diverge', () => {
  const [a] = runFingerprints('determinism-a', [200]);
  const [b] = runFingerprints('determinism-b', [200]);
  assert.notEqual(a, b);
});
