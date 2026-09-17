import { Biome } from '../engine/biome.ts';
import { genomeToColor } from '../engine/genetics.ts';
import type { Simulation } from '../engine/simulation.ts';

const BIOME_COLORS: Record<Biome, string> = {
  [Biome.DeepWater]: '#1b4f72',
  [Biome.ShallowWater]: '#3a8fc4',
  [Biome.Beach]: '#e0d18f',
  [Biome.Plains]: '#8bb14c',
  [Biome.Forest]: '#356e35',
  [Biome.Hills]: '#a08a5c',
  [Biome.Mountain]: '#8a8a8a',
};

const BIOME_LIST = Object.values(Biome);

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cellSize = 1;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  private resize(width: number, height: number): void {
    const maxWidth = this.canvas.parentElement?.clientWidth ?? 960;
    this.cellSize = Math.max(1, Math.floor(maxWidth / width));
    this.canvas.width = width * this.cellSize;
    this.canvas.height = height * this.cellSize;
  }

  render(sim: Simulation): void {
    const { world, herbivores } = sim;
    if (this.canvas.width !== world.width * this.cellSize) {
      this.resize(world.width, world.height);
    }

    const cs = this.cellSize;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const i = world.index(x, y);
        const biome = BIOME_LIST[world.biome[i]];
        this.ctx.fillStyle = BIOME_COLORS[biome];
        this.ctx.fillRect(x * cs, y * cs, cs, cs);

        const max = world.biomassMax[i];
        if (max > 0) {
          const fraction = world.biomass[i] / max;
          this.ctx.fillStyle = `rgba(20, 90, 20, ${fraction * 0.45})`;
          this.ctx.fillRect(x * cs, y * cs, cs, cs);
        }
      }
    }

    const radius = Math.max(0.6, cs * 0.32);
    for (const h of herbivores.individuals) {
      this.ctx.fillStyle = genomeToColor(h.genome);
      this.ctx.beginPath();
      this.ctx.arc(h.x * cs + cs / 2, h.y * cs + cs / 2, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    const predatorRadius = Math.max(0.9, cs * 0.42);
    for (const p of sim.predators.individuals) {
      this.ctx.fillStyle = genomeToColor(p.genome);
      this.ctx.beginPath();
      this.ctx.arc(p.x * cs + cs / 2, p.y * cs + cs / 2, predatorRadius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.lineWidth = Math.max(0.5, cs * 0.08);
      this.ctx.strokeStyle = '#0a0a0a';
      this.ctx.stroke();
    }
  }
}
