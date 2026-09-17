import './style.css';
import { DEFAULT_SIMULATION_PARAMS, Simulation, type SimulationParams } from './engine/simulation.ts';
import { CanvasRenderer } from './render/canvasRenderer.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>life-hard — prototype</h1>
  <div id="controls">
    <label class="control">Largeur<input id="p-width" type="number" min="16" max="256" step="1" /></label>
    <label class="control">Hauteur<input id="p-height" type="number" min="16" max="256" step="1" /></label>
    <label class="control">Seed<input id="p-seed" type="text" /></label>
    <label class="control">Niveau d'eau<input id="p-water" type="number" min="0" max="0.9" step="0.05" /></label>
    <label class="control">Relief (octaves)<input id="p-relief" type="number" min="1" max="8" step="1" /></label>
    <label class="control">Herbivores initiaux<input id="p-herbivores" type="number" min="0" max="2000" step="10" /></label>
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
    <span>Herbivores: <strong id="stat-herbivores">0</strong></span>
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
    initialHerbivores: num('p-herbivores'),
  };
}

function writeParams(params: SimulationParams): void {
  (document.getElementById('p-width') as HTMLInputElement).value = String(params.width);
  (document.getElementById('p-height') as HTMLInputElement).value = String(params.height);
  (document.getElementById('p-seed') as HTMLInputElement).value = params.seed;
  (document.getElementById('p-water') as HTMLInputElement).value = String(params.waterLevel);
  (document.getElementById('p-relief') as HTMLInputElement).value = String(params.reliefOctaves);
  (document.getElementById('p-herbivores') as HTMLInputElement).value = String(params.initialHerbivores);
}

writeParams(DEFAULT_SIMULATION_PARAMS);

const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);

const chartCanvas = document.getElementById('population-chart') as HTMLCanvasElement;
const chartCtx = chartCanvas.getContext('2d')!;
const populationHistory: number[] = [];

function drawChart(): void {
  const rect = chartCanvas.getBoundingClientRect();
  chartCanvas.width = rect.width;
  chartCanvas.height = rect.height;

  chartCtx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  if (populationHistory.length < 2) return;

  const max = Math.max(...populationHistory, 1);
  const step = chartCanvas.width / (populationHistory.length - 1);

  chartCtx.strokeStyle = '#d6304a';
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  populationHistory.forEach((count, i) => {
    const x = i * step;
    const y = chartCanvas.height - (count / max) * (chartCanvas.height - 8) - 4;
    if (i === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();
}

let sim = new Simulation(readParams());
let running = true;

function restart(): void {
  sim = new Simulation(readParams());
  populationHistory.length = 0;
  tickAccumulator = 0;
  renderFrame();
}

function renderFrame(): void {
  renderer.render(sim);
  (document.getElementById('stat-tick') as HTMLElement).textContent = String(sim.tick);
  (document.getElementById('stat-herbivores') as HTMLElement).textContent = String(sim.herbivores.individuals.length);
  drawChart();
}

document.getElementById('btn-restart')!.addEventListener('click', restart);

document.getElementById('btn-toggle')!.addEventListener('click', (e) => {
  running = !running;
  (e.target as HTMLButtonElement).textContent = running ? 'Pause' : 'Reprendre';
});

document.getElementById('btn-step')!.addEventListener('click', () => {
  sim.step();
  populationHistory.push(sim.herbivores.individuals.length);
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
      populationHistory.push(sim.herbivores.individuals.length);
      if (populationHistory.length > 500) populationHistory.shift();
      tickAccumulator -= 1;
    }
    renderFrame();
  }
  requestAnimationFrame(loop);
}

renderFrame();
requestAnimationFrame(loop);
