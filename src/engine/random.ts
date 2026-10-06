export type Rng = () => number;

/** An Rng whose internal state can be read and restored (to resume a saved simulation exactly). */
export interface SeededRng extends Rng {
  getState(): number;
  setState(state: number): void;
}

export function mulberry32(seed: number): SeededRng {
  let a = seed >>> 0;
  const rng = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  rng.getState = () => a;
  rng.setState = (state) => {
    a = state >>> 0;
  };
  return rng;
}

export function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
