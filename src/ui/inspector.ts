import { Biome } from '../engine/biome.ts';
import type { HerbivorePopulation } from '../engine/herbivore.ts';
import type { PredatorPopulation } from '../engine/predator.ts';
import type { ScavengerPopulation } from '../engine/scavenger.ts';
import type { Simulation } from '../engine/simulation.ts';

export type Selection =
  | { kind: 'cell'; x: number; y: number }
  | {
      kind: 'individual';
      speciesId: string;
      id: number;
      /** Last position/vision seen while alive, kept so the marker stays where it died. */
      x: number;
      y: number;
      visionRadius: number;
      diedAtTick: number | null;
      /** Last rendered details, shown (dimmed) after death. */
      lastHtml: string;
    };

export interface Overlay {
  x: number;
  y: number;
  visionRadius: number;
  dead: boolean;
}

const BIOME_LABELS: Record<Biome, string> = {
  [Biome.DeepWater]: 'Eau profonde',
  [Biome.ShallowWater]: 'Eau peu profonde',
  [Biome.Beach]: 'Plage',
  [Biome.Plains]: 'Plaine',
  [Biome.Forest]: 'Forêt',
  [Biome.Hills]: 'Collines',
  [Biome.Mountain]: 'Montagne',
};
const BIOME_LIST = Object.values(Biome);

type AnyPopulation = HerbivorePopulation | PredatorPopulation | ScavengerPopulation;

interface SpeciesRef {
  id: string;
  label: string;
  hueOffset: number;
  population: AnyPopulation;
  predator: boolean;
}

function allSpecies(sim: Simulation): SpeciesRef[] {
  return [
    ...sim.herbivoreSpecies.map((s) => ({ ...s, predator: false })),
    ...sim.predatorSpecies.map((s) => ({ ...s, predator: true })),
    ...sim.scavengerSpecies.map((s) => ({ ...s, predator: false })),
  ];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number, digits = 1) => v.toFixed(digits);

function row(label: string, value: string): string {
  return `<tr><th>${label}</th><td>${value}</td></tr>`;
}

/** Picks the individual closest to (x, y) within one cell (predators win ties), else the cell itself. */
export function pickAt(sim: Simulation, x: number, y: number): Selection {
  let best: { species: SpeciesRef; index: number; dist: number } | null = null;
  for (const species of allSpecies(sim)) {
    const pop = species.population;
    for (let i = 0; i < pop.length; i++) {
      const dx = pop.x[i] - x;
      const dy = pop.y[i] - y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
      const dist = dx * dx + dy * dy - (species.predator ? 0.5 : 0);
      if (!best || dist < best.dist) best = { species, index: i, dist };
    }
  }
  if (!best) return { kind: 'cell', x, y };
  const { species, index } = best;
  return {
    kind: 'individual',
    speciesId: species.id,
    id: species.population.id[index],
    x: species.population.x[index],
    y: species.population.y[index],
    visionRadius: species.population.traits(index).visionRadius,
    diedAtTick: null,
    lastHtml: '',
  };
}

function cellHtml(sim: Simulation, x: number, y: number): string {
  const { world } = sim;
  const c = world.index(x, y);
  const counts = allSpecies(sim)
    .map((s) => {
      let n = 0;
      for (let i = 0; i < s.population.length; i++) if (s.population.x[i] === x && s.population.y[i] === y) n++;
      return n > 0 ? `${s.label}: ${n}` : '';
    })
    .filter(Boolean)
    .join(', ');
  return `<table>${[
    row('Cellule', `(${x}, ${y})`),
    row('Biome', BIOME_LABELS[BIOME_LIST[world.biome[c]]]),
    row('Altitude', num(world.elevation[c], 2)),
    row('Humidité', num(world.moisture[c], 2)),
    row('Biomasse', `${num(world.biomass[c], 0)} / ${num(world.biomassMax[c], 0)}`),
    row('Fertilité du sol', pct(world.fertility[c])),
    row('Matière organique', num(world.carrion[c], 0)),
    row('Individus', counts || 'aucun'),
  ].join('')}</table>`;
}

function individualHtml(sim: Simulation, species: SpeciesRef, i: number): string {
  const pop = species.population;
  const t = pop.traits(i);
  const rows = [
    row('Espèce', `<span style="color: hsl(${species.hueOffset}, 70%, 55%)">${species.label}</span> #${pop.id[i]}`),
    row('Âge', `${pop.age[i]} / ${pop.params.maxAge}`),
    row('Énergie', num(pop.energy[i])),
    row('Position', `(${pop.x[i]}, ${pop.y[i]}) — ${BIOME_LABELS[BIOME_LIST[sim.world.biome[sim.world.index(pop.x[i], pop.y[i])]]]}`),
    row('Reproduction', pop.cooldown[i] > 0 ? `repos (${pop.cooldown[i]} ticks)` : `prêt dès ${num(t.matingEnergyThreshold, 0)} d'énergie`),
  ];
  if ('huntCooldown' in pop) {
    rows.push(row('Digestion', pop.huntCooldown[i] > 0 ? `${pop.huntCooldown[i]} ticks` : 'prêt à chasser'));
  }
  rows.push(
    row('Gènes', `vitesse ${pct(pop.geneSpeed[i])} · vision ${pct(pop.geneVision[i])} · fertilité ${pct(pop.geneFertility[i])} · efficacité ${pct(pop.geneEfficiency[i])}`),
    row('Vision', `${t.visionRadius} cases`),
    row('Coût déplacement', num(t.moveCost, 3)),
    row('Métabolisme', num(t.restMetabolism, 3)),
    row('Conversion', pct(t.conversionEfficiency)),
    row('Portée max', String(t.maxLitterSize)),
  );
  return `<table>${rows.join('')}</table>`;
}

/** Refreshes the selection from the live simulation; returns the panel HTML and the map overlay. */
export function inspect(sim: Simulation, selection: Selection): { html: string; overlay: Overlay } {
  if (selection.kind === 'cell') {
    return {
      html: cellHtml(sim, selection.x, selection.y),
      overlay: { x: selection.x, y: selection.y, visionRadius: 0, dead: false },
    };
  }

  const species = allSpecies(sim).find((s) => s.id === selection.speciesId);
  const index = species ? species.population.indexOfId(selection.id) : -1;
  if (species && index >= 0) {
    const pop = species.population;
    selection.x = pop.x[index];
    selection.y = pop.y[index];
    selection.visionRadius = pop.traits(index).visionRadius;
    selection.lastHtml = individualHtml(sim, species, index);
    return {
      html: selection.lastHtml + cellHtml(sim, selection.x, selection.y),
      overlay: { x: selection.x, y: selection.y, visionRadius: selection.visionRadius, dead: false },
    };
  }

  selection.diedAtTick ??= sim.tick;
  return {
    html: `<p class="inspector-dead">Décédé au tick ${selection.diedAtTick}. Dernier état connu :</p>${selection.lastHtml}`,
    overlay: { x: selection.x, y: selection.y, visionRadius: 0, dead: true },
  };
}
