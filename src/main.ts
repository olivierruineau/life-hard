import './style.css';
import {
  DEFAULT_SIMULATION_PARAMS,
  HERBIVORE_SPECIES_PRESETS,
  PREDATOR_SPECIES_PRESETS,
  Simulation,
  type SimulationParams,
} from './engine/simulation.ts';
import { CanvasRenderer } from './render/canvasRenderer.ts';

const herbivoreControls = HERBIVORE_SPECIES_PRESETS.map(
  (p) => `<label class="control">${p.label}<input id="p-herb-${p.id}" type="number" min="0" max="2000" step="10" /></label>`,
).join('');
const predatorControls = PREDATOR_SPECIES_PRESETS.map(
  (p) => `<label class="control">${p.label}<input id="p-pred-${p.id}" type="number" min="0" max="500" step="1" /></label>`,
).join('');

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>life-hard — prototype</h1>
  <div id="controls">
    <label class="control">Largeur<input id="p-width" type="number" min="16" max="256" step="1" /></label>
    <label class="control">Hauteur<input id="p-height" type="number" min="16" max="256" step="1" /></label>
    <label class="control">Seed<input id="p-seed" type="text" /></label>
    <label class="control">Niveau d'eau<input id="p-water" type="number" min="0" max="0.9" step="0.05" /></label>
    <label class="control">Relief (octaves)<input id="p-relief" type="number" min="1" max="8" step="1" /></label>
    ${herbivoreControls}
    ${predatorControls}
    <div id="actions">
      <button id="btn-restart">Nouvelle simulation</button>
      <button id="btn-toggle">Pause</button>
      <button id="btn-step">+1 tick</button>
      <span class="speed-control">
        <button id="btn-speed-down">−</button>
        <span id="speed-label">x1</span>
        <button id="btn-speed-up">+</button>
      </span>
    </div>
  </div>
  <div id="canvas-wrap"><canvas id="sim-canvas"></canvas></div>
  <div id="stats">
    <span>Tick: <strong id="stat-tick">0</strong></span>
    <span id="stat-species"></span>
  </div>
  <div id="chart-controls">
    <button id="btn-chart-mode">Depuis le début</button>
  </div>
  <canvas id="population-chart"></canvas>
`;

function readParams(): SimulationParams {
  const num = (id: string) => Number((document.getElementById(id) as HTMLInputElement).value);
  const text = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  return {
    width: num('p-width'),
    height: num('p-height'),
    seed: text('p-seed'),
    waterLevel: num('p-water'),
    reliefOctaves: num('p-relief'),
    herbivoreSpecies: HERBIVORE_SPECIES_PRESETS.map((p) => ({ id: p.id, initialCount: num(`p-herb-${p.id}`) })),
    predatorSpecies: PREDATOR_SPECIES_PRESETS.map((p) => ({ id: p.id, initialCount: num(`p-pred-${p.id}`) })),
  };
}

function writeParams(params: SimulationParams): void {
  (document.getElementById('p-width') as HTMLInputElement).value = String(params.width);
  (document.getElementById('p-height') as HTMLInputElement).value = String(params.height);
  (document.getElementById('p-seed') as HTMLInputElement).value = params.seed;
  (document.getElementById('p-water') as HTMLInputElement).value = String(params.waterLevel);
  (document.getElementById('p-relief') as HTMLInputElement).value = String(params.reliefOctaves);
  for (const s of params.herbivoreSpecies) {
    (document.getElementById(`p-herb-${s.id}`) as HTMLInputElement).value = String(s.initialCount);
  }
  for (const s of params.predatorSpecies) {
    (document.getElementById(`p-pred-${s.id}`) as HTMLInputElement).value = String(s.initialCount);
  }
}

writeParams(DEFAULT_SIMULATION_PARAMS);

const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);

const chartCanvas = document.getElementById('population-chart') as HTMLCanvasElement;
const chartCtx = chartCanvas.getContext('2d')!;
const speciesHistory = new Map<string, number[]>();
const speciesHue = new Map<string, number>();
const CHART_WINDOW = 500;
const CHART_MAX_POINTS = 1000;
let chartMode: 'window' | 'full' = 'window';

function downsample(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const step = values.length / maxPoints;
  const result: number[] = [];
  for (let i = 0; i < maxPoints; i++) result.push(values[Math.floor(i * step)]);
  return result;
}

function drawSeries(values: number[], max: number, color: string): void {
  if (values.length < 2) return;
  const step = chartCanvas.width / (values.length - 1);
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  values.forEach((count, i) => {
    const x = i * step;
    const y = chartCanvas.height - (count / max) * (chartCanvas.height - 8) - 4;
    if (i === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();
}

function drawChart(): void {
  const rect = chartCanvas.getBoundingClientRect();
  chartCanvas.width = rect.width;
  chartCanvas.height = rect.height;

  chartCtx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  const displayed = [...speciesHistory.entries()].map(([id, values]) => {
    const windowed = chartMode === 'window' ? values.slice(-CHART_WINDOW) : values;
    return [id, downsample(windowed, CHART_MAX_POINTS)] as const;
  });
  const max = Math.max(1, ...displayed.map(([, values]) => Math.max(0, ...values)));
  for (const [id, values] of displayed) {
    drawSeries(values, max, `hsl(${speciesHue.get(id) ?? 0}, 70%, 55%)`);
  }
}

let sim = new Simulation(readParams());
let running = true;

function restart(): void {
  sim = new Simulation(readParams());
  speciesHistory.clear();
  speciesHue.clear();
  tickAccumulator = 0;
  renderFrame();
}

function renderFrame(): void {
  renderer.render(sim);
  (document.getElementById('stat-tick') as HTMLElement).textContent = String(sim.tick);
  const statSpecies = document.getElementById('stat-species') as HTMLElement;
  statSpecies.innerHTML = [...sim.herbivoreSpecies, ...sim.predatorSpecies]
    .map(
      (s) =>
        `<span style="color: hsl(${s.hueOffset}, 70%, 55%)">${s.label}: <strong>${s.population.individuals.length}</strong></span>`,
    )
    .join('');
  drawChart();
}

document.getElementById('btn-restart')!.addEventListener('click', restart);

document.getElementById('btn-chart-mode')!.addEventListener('click', (e) => {
  chartMode = chartMode === 'window' ? 'full' : 'window';
  (e.target as HTMLButtonElement).textContent = chartMode === 'window' ? 'Depuis le début' : 'Fenêtre glissante';
  drawChart();
});

document.getElementById('btn-toggle')!.addEventListener('click', (e) => {
  running = !running;
  (e.target as HTMLButtonElement).textContent = running ? 'Pause' : 'Reprendre';
});

function recordHistory(): void {
  for (const s of [...sim.herbivoreSpecies, ...sim.predatorSpecies]) {
    speciesHue.set(s.id, s.hueOffset);
    const history = speciesHistory.get(s.id) ?? [];
    history.push(s.population.individuals.length);
    speciesHistory.set(s.id, history);
  }
}

document.getElementById('btn-step')!.addEventListener('click', () => {
  sim.step();
  recordHistory();
  renderFrame();
});

const SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
let speedIndex = SPEED_STEPS.indexOf(1);
let tickAccumulator = 0;

function updateSpeedLabel(): void {
  const value = SPEED_STEPS[speedIndex];
  (document.getElementById('speed-label') as HTMLElement).textContent = `x${value}`;
}

document.getElementById('btn-speed-up')!.addEventListener('click', () => {
  speedIndex = Math.min(speedIndex + 1, SPEED_STEPS.length - 1);
  updateSpeedLabel();
});

document.getElementById('btn-speed-down')!.addEventListener('click', () => {
  speedIndex = Math.max(speedIndex - 1, 0);
  updateSpeedLabel();
});

function loop(): void {
  if (running) {
    tickAccumulator += SPEED_STEPS[speedIndex];
    while (tickAccumulator >= 1) {
      sim.step();
      recordHistory();
      tickAccumulator -= 1;
    }
    renderFrame();
  }
  requestAnimationFrame(loop);
}

renderFrame();
requestAnimationFrame(loop);
