import type { Rng } from './random.ts';

/** Value noise on an integer lattice, seeded, tileable-free (fine for a bounded map). */
export class ValueNoise2D {
  private readonly lattice: Float32Array;
  private readonly size: number;

  constructor(rng: Rng, latticeSize = 64) {
    this.size = latticeSize;
    this.lattice = new Float32Array(latticeSize * latticeSize);
    for (let i = 0; i < this.lattice.length; i++) this.lattice[i] = rng();
  }

  private sample(ix: number, iy: number): number {
    const s = this.size;
    const x = ((ix % s) + s) % s;
    const y = ((iy % s) + s) % s;
    return this.lattice[y * s + x];
  }

  private static smooth(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /** Bilinear-interpolated noise at continuous coordinates, in [0, 1). */
  at(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = ValueNoise2D.smooth(x - x0);
    const ty = ValueNoise2D.smooth(y - y0);

    const v00 = this.sample(x0, y0);
    const v10 = this.sample(x0 + 1, y0);
    const v01 = this.sample(x0, y0 + 1);
    const v11 = this.sample(x0 + 1, y0 + 1);

    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  }

  /** Fractal sum of several octaves, normalized to [0, 1). */
  fractal(x: number, y: number, octaves: number, frequency: number, persistence: number): number {
    let amplitude = 1;
    let freq = frequency;
    let sum = 0;
    let maxSum = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.at(x * freq, y * freq) * amplitude;
      maxSum += amplitude;
      amplitude *= persistence;
      freq *= 2;
    }
    return sum / maxSum;
  }
}
