/** Serializable image of one population's live individuals (SoA columns trimmed to `length`). */
export interface PopulationSnapshot {
  length: number;
  nextId: number;
  migrantCount: number;
  columns: Record<string, number[]>;
}

type Column = Int32Array | Float64Array;

export function snapshotColumns(
  pop: object,
  names: readonly string[],
  length: number,
  nextId: number,
  migrantCount: number,
): PopulationSnapshot {
  const columns: Record<string, number[]> = {};
  for (const name of names) columns[name] = Array.from((pop as Record<string, Column>)[name].subarray(0, length));
  return { length, nextId, migrantCount, columns };
}

/** Copies a snapshot's columns into already-allocated arrays of `pop`. */
export function restoreColumns(pop: object, names: readonly string[], snapshot: PopulationSnapshot): void {
  for (const name of names) {
    const values = snapshot.columns[name];
    if (!values || values.length !== snapshot.length) throw new Error(`Corrupted snapshot: column "${name}"`);
    (pop as Record<string, Column>)[name].set(values);
  }
}
