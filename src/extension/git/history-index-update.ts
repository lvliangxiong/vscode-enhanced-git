import { setImmediate as yieldToHost } from 'node:timers/promises';
import { git } from './client';
import { graphMarkers, readRepositoryTopology } from './topology-reader';
import { historyIndexFormat, maxIndexCommits } from './history-index';

export async function updateHistoryIndexRaw(root: string, previous: string, compatible = false) {
  const records = new Map(
    previous
      .split('\0\n')
      .filter(Boolean)
      .map((row) => {
        const fields = row.replace(/^\n/, '').split('\0');
        return [fields[0], fields] as const;
      }),
  );
  // Share the recent-block graph with the renderer. Persisted details may seed
  // it after restart only when the caller validated content compatibility.
  // Short decorations cannot distinguish a branch named "grafted" from Git's
  // special marker. Let the graph reader obtain authoritative full names there.
  const seed =
    compatible && ![...records.values()].some((fields) => graphMarkers(fields[6]).length)
      ? [...records].map(([hash, fields]) => ({
          hash,
          parents: fields[1].split(' ').filter(Boolean),
        }))
      : undefined;
  const graph = await readRepositoryTopology(root, seed);
  const topology = graph.commits;
  // The index uses Git's short decorations; lane ranking uses full ref names.
  const decorated = await git(root, [
    'log',
    '--no-walk=unsorted',
    '--all',
    '--format=%H%x00%D',
    '--',
  ]);
  const decorations = new Map(
    decorated
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, names] = line.split('\0');
        return [hash, names] as const;
      }),
  );
  if (topology.length > maxIndexCommits) return undefined;
  const missing = topology.filter(({ hash }) => !records.has(hash)).map(({ hash }) => hash);
  for (let start = 0; start < missing.length; start += 512) {
    const raw = await git(
      root,
      ['log', '--no-walk=unsorted', historyIndexFormat, '--stdin', '--'],
      {
        input: missing.slice(start, start + 512).join('\n') + '\n',
      },
    );
    for (const row of raw.split('\0\n').filter(Boolean)) {
      const fields = row.replace(/^\n/, '').split('\0');
      records.set(fields[0], fields);
    }
  }
  const rows: string[] = [];
  let bytes = 0;
  for (const [i, { hash, parents, decorations: graphDecorations }] of topology.entries()) {
    if (i % 512 === 0) await yieldToHost();
    const fields = records.get(hash);
    if (!fields || fields.length !== 9) throw Error('Incomplete commit index record');
    fields[1] = parents.join(' ');
    fields[6] = [
      ...new Set([
        ...(decorations.get(hash) || '').split(', ').filter(Boolean),
        ...graphMarkers(graphDecorations),
      ]),
    ].join(', ');
    const row = fields.join('\0') + '\0\n';
    bytes += Buffer.byteLength(row);
    if (bytes > 32 * 1024 * 1024) return undefined;
    rows.push(row);
  }
  return {
    raw: rows.join(''),
    added: missing.length,
    reused: topology.length - missing.length,
    topologyMode: graph.mode,
    topologyRead: graph.readCount,
  };
}
