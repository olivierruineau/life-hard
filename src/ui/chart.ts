export interface ChartSeries {
  id: string;
  /** One value per tick since the simulation started. */
  values: number[];
  color: string;
}

const MAX_POINTS = 1000;
const MARGIN = { left: 48, right: 12, top: 10, bottom: 22 };
const AXIS_COLOR = '#9a9fae';
const GRID_COLOR = 'rgba(255, 255, 255, 0.08)';

function downsample(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const step = values.length / maxPoints;
  const result: number[] = [];
  for (let i = 0; i < maxPoints; i++) result.push(values[Math.floor(i * step)]);
  return result;
}

/** Smallest "round" (1, 2, 5 x 10^k) value >= v, so axis labels stay readable. */
export function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * magnitude >= v) return m * magnitude;
  return 10 * magnitude;
}

/** Draws every series on one shared scale, with labelled axes. `windowTicks` null = whole history. */
export function drawPopulationChart(canvas: HTMLCanvasElement, series: ChartSeries[], windowTicks: number | null): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const totalTicks = Math.max(0, ...series.map((s) => s.values.length));
  const startTick = windowTicks === null ? 0 : Math.max(0, totalTicks - windowTicks);
  const displayed = series.map((s) => ({ ...s, values: downsample(s.values.slice(startTick), MAX_POINTS) }));
  const dataMax = Math.max(1, ...displayed.map((s) => Math.max(0, ...s.values)));
  const yMax = niceCeil(dataMax);

  const plotLeft = MARGIN.left;
  const plotRight = width - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = height - MARGIN.bottom;
  const yOf = (v: number) => plotBottom - (v / yMax) * (plotBottom - plotTop);

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = AXIS_COLOR;
  ctx.lineWidth = 1;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const value = (yMax * k) / 4;
    const y = Math.round(yOf(value)) + 0.5;
    ctx.strokeStyle = GRID_COLOR;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(value)), plotLeft - 6, y);
  }

  const endTick = Math.max(startTick + 1, totalTicks);
  ctx.textBaseline = 'top';
  for (let k = 0; k <= 4; k++) {
    const x = plotLeft + ((plotRight - plotLeft) * k) / 4;
    ctx.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center';
    ctx.fillText(String(Math.round(startTick + ((endTick - startTick) * k) / 4)), x, plotBottom + 6);
    ctx.strokeStyle = GRID_COLOR;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, plotTop);
    ctx.lineTo(Math.round(x) + 0.5, plotBottom);
    ctx.stroke();
  }

  ctx.lineWidth = 2;
  for (const s of displayed) {
    if (s.values.length < 2) continue;
    const step = (plotRight - plotLeft) / (s.values.length - 1);
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    s.values.forEach((count, i) => {
      const x = plotLeft + i * step;
      const y = yOf(count);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
