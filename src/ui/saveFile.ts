import { SNAPSHOT_VERSION, type SimulationSnapshot } from '../engine/simulation.ts';
import type { GeneHistory, GeneSeries } from './geneStats.ts';

const FORMAT = 'life-hard-save';

/** What the charts show, saved with the simulation so a loaded run keeps its history. */
export interface SavedHistory {
  populations: Record<string, number[]>;
  hues: Record<string, number>;
  genes: Record<string, GeneSeries>;
}

export interface SaveFile {
  format: typeof FORMAT;
  simulation: SimulationSnapshot;
  history: SavedHistory;
}

export function serializeSave(
  simulation: SimulationSnapshot,
  populations: Map<string, number[]>,
  hues: Map<string, number>,
  genes: GeneHistory,
): string {
  const file: SaveFile = {
    format: FORMAT,
    simulation,
    history: {
      populations: Object.fromEntries(populations),
      hues: Object.fromEntries(hues),
      genes: genes.toJSON(),
    },
  };
  return JSON.stringify(file);
}

export function parseSave(text: string): SaveFile {
  let data: Partial<SaveFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde valide (JSON illisible).");
  }
  if (data.format !== FORMAT || !data.simulation || !data.history) {
    throw new Error("Ce fichier n'est pas une sauvegarde life-hard.");
  }
  if (data.simulation.version !== SNAPSHOT_VERSION) {
    throw new Error(`Version de sauvegarde non prise en charge (${data.simulation.version}).`);
  }
  return data as SaveFile;
}
