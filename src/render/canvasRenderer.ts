import { Biome } from '../engine/biome.ts';
import type { Simulation } from '../engine/simulation.ts';
import type { Overlay } from '../ui/inspector.ts';

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

/** Degrees of hue variation visible within one species' own color band. */
const SPECIES_HUE_SPAN = 50;

/** Carrion amount at which a cross is fully opaque (about one herbivore body); below, it fades out as the body rots. */
const CARRION_FULL_OPACITY = 40;
const CARRION_MIN_VISIBLE = 0.5;

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

  /** Map cell under a viewport point (client coordinates), or null when outside the map. */
  cellAt(clientX: number, clientY: number, width: number, height: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * height);
    return x >= 0 && x < width && y >= 0 && y < height ? { x, y } : null;
  }

  render(sim: Simulation, overlay: Overlay | null = null): void {
    const { world } = sim;
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

        const fertility = world.fertility[i];
        if (fertility < 1) {
          this.ctx.fillStyle = `rgba(120, 90, 40, ${(1 - fertility) * 0.5})`;
          this.ctx.fillRect(x * cs, y * cs, cs, cs);
        }

        const max = world.biomassMax[i];
        if (max > 0) {
          const fraction = world.biomass[i] / max;
          this.ctx.fillStyle = `rgba(20, 90, 20, ${fraction * 0.45})`;
          this.ctx.fillRect(x * cs, y * cs, cs, cs);
        }

        const drought = world.drought[i];
        if (drought > 0) {
          this.ctx.fillStyle = `rgba(215, 150, 40, ${drought * 0.4})`;
          this.ctx.fillRect(x * cs, y * cs, cs, cs);
        }
        const scorch = world.scorch[i];
        if (scorch > 0) {
          this.ctx.fillStyle = `rgba(170, 40, 10, ${scorch * 0.6})`;
          this.ctx.fillRect(x * cs, y * cs, cs, cs);
        }

        const carrion = world.carrion[i];
        if (carrion >= CARRION_MIN_VISIBLE) this.drawCarrionCross(x, y, Math.min(1, carrion / CARRION_FULL_OPACITY));
      }
    }

    const radius = Math.max(0.6, cs * 0.32);
    for (const species of sim.herbivoreSpecies) {
      const pop = species.population;
      for (let i = 0; i < pop.length; i++) {
        this.ctx.fillStyle = pop.color(i, species.hueOffset, SPECIES_HUE_SPAN);
        this.ctx.beginPath();
        this.ctx.arc(pop.x[i] * cs + cs / 2, pop.y[i] * cs + cs / 2, radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    const predatorRadius = Math.max(0.9, cs * 0.42);
    for (const species of sim.predatorSpecies) {
      const pop = species.population;
      for (let i = 0; i < pop.length; i++) {
        this.ctx.fillStyle = pop.color(i, species.hueOffset, SPECIES_HUE_SPAN);
        this.ctx.beginPath();
        this.ctx.arc(pop.x[i] * cs + cs / 2, pop.y[i] * cs + cs / 2, predatorRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.lineWidth = Math.max(0.5, cs * 0.08);
        this.ctx.strokeStyle = '#0a0a0a';
        this.ctx.stroke();
      }
    }

    const scavengerRadius = Math.max(0.8, cs * 0.4);
    for (const species of sim.scavengerSpecies) {
      const pop = species.population;
      this.ctx.lineWidth = Math.max(0.5, cs * 0.08);
      this.ctx.strokeStyle = '#0a0a0a';
      for (let i = 0; i < pop.length; i++) {
        const cx = pop.x[i] * cs + cs / 2;
        const cy = pop.y[i] * cs + cs / 2;
        this.ctx.fillStyle = pop.color(i, species.hueOffset, SPECIES_HUE_SPAN);
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy - scavengerRadius);
        this.ctx.lineTo(cx + scavengerRadius, cy);
        this.ctx.lineTo(cx, cy + scavengerRadius);
        this.ctx.lineTo(cx - scavengerRadius, cy);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
      }
    }

    if (overlay) this.drawOverlay(overlay);
  }

  private drawCarrionCross(x: number, y: number, opacity: number): void {
    const cs = this.cellSize;
    const ctx = this.ctx;
    const margin = cs * 0.22;
    const x0 = x * cs + margin;
    const y0 = y * cs + margin;
    const x1 = (x + 1) * cs - margin;
    const y1 = (y + 1) * cs - margin;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.moveTo(x1, y0);
      ctx.lineTo(x0, y1);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(20, 15, 10, ${opacity * 0.7})`;
    ctx.lineWidth = Math.max(2, cs * 0.28);
    path();
    ctx.strokeStyle = `rgba(245, 235, 215, ${opacity})`;
    ctx.lineWidth = Math.max(1, cs * 0.14);
    path();
    ctx.lineCap = 'butt';
  }

  private drawOverlay(o: Overlay): void {
    const cs = this.cellSize;
    const ctx = this.ctx;
    ctx.lineWidth = Math.max(1, cs * 0.15);
    if (o.visionRadius > 0) {
      const r = o.visionRadius;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.setLineDash([cs * 0.4, cs * 0.3]);
      ctx.strokeRect((o.x - r) * cs, (o.y - r) * cs, (2 * r + 1) * cs, (2 * r + 1) * cs);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = o.dead ? 'rgba(255, 90, 90, 0.9)' : '#ffffff';
    ctx.strokeRect(o.x * cs - cs * 0.25, o.y * cs - cs * 0.25, cs * 1.5, cs * 1.5);
  }
}
