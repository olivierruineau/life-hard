export interface ChartSeries {
  id: string;
  /** One value per sample since the simulation started (NaN = gap, e.g. an extinct species). */
  values: number[];
  color: string;
  /** Optional half-width of a shaded band around each value (e.g. a standard deviation). */
  band?: number[];
}

export interface ChartOptions {
  /** Fixed top of the y axis; otherwise the largest data value rounded up to a "nice" number. */
  yMax?: number;
  /** Fit the y axis to the data (value +/- band, clamped to [0, 1], at least `MIN_AUTO_SPAN` tall). */
  autoRange?: boolean;
  /** Decimals shown on y labels. */
  yDecimals?: number;
  /** Ticks between two consecutive values (1 = one value per tick). */
  ticksPerPoint?: number;
}

const MAX_POINTS = 1000;
const MIN_AUTO_SPAN = 0.1;
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

/** Fill color of a series' band: the line color at low opacity. */
function bandColor(color: string): string {
  const hsl = color.match(/^hsl\((.+)\)$/);
  if (hsl) return `hsla(${hsl[1]}, 0.18)`;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 0.18)`;
  }
  return color;
}

/** Smallest "round" (1, 2, 5 x 10^k) value >= v, so axis labels stay readable. */
export function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * magnitude >= v) return m * magnitude;
  return 10 * magnitude;
}

/** Draws every series on one shared scale, with labelled axes. `windowTicks` null = whole history. */
export function drawLineChart(
  canvas: HTMLCanvasElement,
  series: ChartSeries[],
  windowTicks: number | null,
  options: ChartOptions = {},
): void {
  const ticksPerPoint = options.ticksPerPoint ?? 1;
  const yDecimals = options.yDecimals ?? 0;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const totalPoints = Math.max(0, ...series.map((s) => s.values.length));
  const startPoint = windowTicks === null ? 0 : Math.max(0, totalPoints - Math.ceil(windowTicks / ticksPerPoint));
  const displayed = series.map((s) => ({
    ...s,
    values: downsample(s.values.slice(startPoint), MAX_POINTS),
    band: s.band ? downsample(s.band.slice(startPoint), MAX_POINTS) : undefined,
  }));
  const dataMax = Math.max(1, ...displayed.map((s) => Math.max(0, ...s.values.filter(Number.isFinite))));
  let yMin = 0;
  let yMax = options.yMax ?? niceCeil(dataMax);
  if (options.autoRange) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of displayed) {
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        lo = Math.min(lo, v - (s.band?.[i] ?? 0));
        hi = Math.max(hi, v + (s.band?.[i] ?? 0));
      });
    }
    if (lo <= hi) {
      const span = Math.max(MIN_AUTO_SPAN, hi - lo);
      const pad = span * 0.1;
      yMin = Math.max(0, Math.floor((lo - pad) / 0.05) * 0.05);
      yMax = Math.min(1, Math.max(yMin + MIN_AUTO_SPAN, Math.ceil((hi + pad) / 0.05) * 0.05));
    }
  }

  const plotLeft = MARGIN.left;
  const plotRight = width - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = height - MARGIN.bottom;
  const yOf = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin)) * (plotBottom - plotTop);

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = AXIS_COLOR;
  ctx.lineWidth = 1;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const value = yMin + ((yMax - yMin) * k) / 4;
    const y = Math.round(yOf(value)) + 0.5;
    ctx.strokeStyle = GRID_COLOR;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(yDecimals), plotLeft - 6, y);
  }

  const startTick = startPoint * ticksPerPoint;
  const endTick = Math.max(startTick + 1, totalPoints * ticksPerPoint);
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

  for (const s of displayed) {
    if (s.values.length < 2) continue;
    const step = (plotRight - plotLeft) / (s.values.length - 1);
    const xOf = (i: number) => plotLeft + i * step;
    const clampY = (v: number) => Math.min(plotBottom, Math.max(plotTop, yOf(v)));

    const band = s.band;
    if (band) {
      ctx.fillStyle = bandColor(s.color);
      let run: number[] = [];
      const flush = () => {
        if (run.length > 1) {
          ctx.beginPath();
          run.forEach((i, k) => (k === 0 ? ctx.moveTo(xOf(i), clampY(s.values[i] + band[i])) : ctx.lineTo(xOf(i), clampY(s.values[i] + band[i]))));
          for (let k = run.length - 1; k >= 0; k--) ctx.lineTo(xOf(run[k]), clampY(s.values[run[k]] - band[run[k]]));
          ctx.closePath();
          ctx.fill();
        }
        run = [];
      };
      s.values.forEach((v, i) => (Number.isFinite(v) ? run.push(i) : flush()));
      flush();
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    let pen = false;
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      if (pen) ctx.lineTo(xOf(i), yOf(v));
      else ctx.moveTo(xOf(i), yOf(v));
      pen = true;
    });
    ctx.stroke();
  }
}
