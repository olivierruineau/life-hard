import { describe, expect, it } from 'vitest';
import { convexGeneCost, derivePhenotype } from '../src/engine/genetics.ts';
import { DEFAULT_PHENOTYPE_RANGES } from '../src/engine/herbivore.ts';

describe('convexGeneCost', () => {
  it('is 0 at gene 0, increasing, and convex', () => {
    const cost = (g: number) => convexGeneCost(g, 0.2, 3);
    expect(cost(0)).toBe(0);
    for (let g = 0.1; g <= 1; g += 0.1) expect(cost(g)).toBeGreaterThan(cost(g - 0.1));
    expect(cost(0.5) - cost(0.4)).toBeLessThan(cost(1) - cost(0.9));
  });

  it('keeps the legacy cost at mid-range so the average population is not shifted', () => {
    expect(convexGeneCost(0.5, 0.2, 3)).toBeCloseTo(0.1, 10);
    expect(convexGeneCost(0.5, 0.2, 6)).toBeCloseTo(0.1, 10);
  });

  it('degenerates to the linear cost when curvature is 0', () => {
    expect(convexGeneCost(0.7, 0.2, 0)).toBeCloseTo(0.14, 10);
  });

  it('makes a maxed speed or efficiency clearly dearer than a mid-range one', () => {
    const ranges = DEFAULT_PHENOTYPE_RANGES;
    const mid = derivePhenotype(0.5, 0.5, 0.5, 0.5, ranges).restMetabolism;
    expect(derivePhenotype(1, 0.5, 0.5, 0.5, ranges).restMetabolism - mid).toBeGreaterThan(0.2 * 0.5 * 1.5);
    expect(derivePhenotype(0.5, 0.5, 0.5, 1, ranges).restMetabolism - mid).toBeGreaterThan(0.2 * 0.5 * 1.5);
    expect(mid).toBeCloseTo(ranges.baseRestMetabolism + 4 * 0.5 * ranges.restMetabolismGeneFactor, 10);
  });
});
