import { GENE_KEYS, type GeneHistory } from './geneStats.ts';

/**
 * One row per tick: population of each species, then the mean and standard deviation of each
 * gene per species. Genes are only sampled every `geneHistory.sampleEvery` ticks, so those cells
 * are empty on the other rows.
 */
export function historyToCsv(populations: Map<string, number[]>, geneHistory: GeneHistory): string {
  const ids = [...populations.keys()];
  const header = ['tick'];
  for (const id of ids) header.push(`${id}.population`);
  for (const id of ids) for (const gene of GENE_KEYS) header.push(`${id}.${gene}.mean`, `${id}.${gene}.sd`);

  const rows = [header.join(',')];
  const ticks = Math.max(0, ...[...populations.values()].map((v) => v.length));
  const every = geneHistory.sampleEvery;
  for (let i = 0; i < ticks; i++) {
    const tick = i + 1;
    const row: (string | number)[] = [tick];
    for (const id of ids) row.push(populations.get(id)![i] ?? '');
    const geneIndex = tick % every === 0 ? tick / every - 1 : -1;
    for (const id of ids) {
      const series = geneHistory.get(id);
      for (const gene of GENE_KEYS) {
        const mean = geneIndex >= 0 ? series?.[gene].mean[geneIndex] : undefined;
        const sd = geneIndex >= 0 ? series?.[gene].sd[geneIndex] : undefined;
        row.push(mean === undefined || Number.isNaN(mean) ? '' : mean.toFixed(4), sd === undefined || Number.isNaN(sd) ? '' : sd.toFixed(4));
      }
    }
    rows.push(row.join(','));
  }
  return rows.join('\n') + '\n';
}
