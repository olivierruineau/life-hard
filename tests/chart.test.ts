import { expect, test } from 'vitest';
import { niceCeil } from '../src/ui/chart.ts';

test('niceCeil rounds up to 1, 2 or 5 times a power of ten', () => {
  expect(niceCeil(0)).toBe(1);
  expect(niceCeil(1)).toBe(1);
  expect(niceCeil(1.5)).toBe(2);
  expect(niceCeil(3)).toBe(5);
  expect(niceCeil(7)).toBe(10);
  expect(niceCeil(100)).toBe(100);
  expect(niceCeil(101)).toBe(200);
  expect(niceCeil(1380)).toBe(2000);
  expect(niceCeil(2831)).toBe(5000);
});
