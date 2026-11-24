import { readStashes } from './stashes';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import { git } from './client';
import { topologyCompatibility, topologyIdentity } from './topology-identity';

export interface TopologyCommit {
  hash: string;
  parents: string[];
  decorations?: string;
}
interface TopologySnapshot {
  commits: TopologyCommit[];
  mode: 'full' | 'joined';
  readCount: number;
}
const format = '--format=%H %P%x00%D';
const caches = new Map<string, { identity: string; value: Promise<TopologySnapshot> }>();
const nodeIndexes = new WeakMap<
  TopologyCommit[],
  { nodes: Map<string, TopologyCommit>; heads: Set<string> }
>();

function nodeIndex(commits: TopologyCommit[]) {
  let index = nodeIndexes.get(commits);
  if (!index) {
    const nodes = new Map(commits.map((commit) => [commit.hash, commit]));
    const heads = new Set(nodes.keys());
    for (const commit of commits) for (const parent of commit.parents) heads.delete(parent);
    index = { nodes, heads };
    nodeIndexes.set(commits, index);
  }
  return index;
}

export function graphMarkers(decorations = '') {
  return decorations.split(', ').filter((name) => name === 'grafted' || name === 'replaced');
}

function parse(raw: string): TopologyCommit[] {
  return raw
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ids, decorations] = line.split('\0');
      const [hash, ...parents] = ids.trim().split(' ');
      return { hash, parents, decorations };
    });
}

/**
 * Rebased's recent-block join/fallback strategy, using hash-keyed reachability.
 * Keep Git's freshly read prefix and the surviving cached tail. A missing link
 * means the block is insufficient, never that the missing history can be dropped.
 */
export async function joinRecentTopology(
  saved: TopologyCommit[],
  recent: TopologyCommit[],
  tips: TopologyCommit[],
): Promise<TopologyCommit[] | undefined> {
  const { nodes, heads } = nodeIndex(saved);
  const freshNodes = new Map(recent.map((commit) => [commit.hash, commit]));
  for (const commit of recent) {
    const old = nodes.get(commit.hash);
    if (old && old.parents.join(' ') !== commit.parents.join(' ')) return;
  }
  const decorations = new Map(tips.map((commit) => [commit.hash, commit.decorations]));
  const decorate = (commit: TopologyCommit): TopologyCommit => {
    const refs = decorations.get(commit.hash) || '';
    if (refs === (commit.decorations || '')) return commit;
    const names = [
      ...new Set([...refs.split(', ').filter(Boolean), ...graphMarkers(commit.decorations)]),
    ].join(', ');
    return { ...commit, decorations: names };
  };
  const fresh = new Set(freshNodes.keys());
  // Common fast-forward case: if the new tips link to every old graph head,
  // the entire old graph is still reachable. Only traverse new nodes to prove
  // this, rather than walking tens of thousands of unchanged ancestors again.
  const frontier = new Set<string>();
  const seen = new Set<string>();
  const links = tips.map((commit) => commit.hash);
  while (links.length) {
    const hash = links.pop()!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    if (nodes.has(hash)) {
      frontier.add(hash);
      continue;
    }
    const commit = freshNodes.get(hash);
    if (!commit) return;
    links.push(...commit.parents);
  }
  if (heads.size && [...heads].every((head) => frontier.has(head))) {
    // Git's prefix must contain only reachable nodes, and every new node must
    // be linked to the captured tips. Missing/changed ancestry falls back.
    if (recent.some((commit) => !nodes.has(commit.hash) && !seen.has(commit.hash))) return;
    return [
      ...recent.map(decorate),
      ...saved.filter((commit) => !fresh.has(commit.hash)).map(decorate),
    ];
  }
  const reachable = new Set<string>();
  const pending = tips.map((commit) => commit.hash);
  while (pending.length) {
    const hash = pending.pop()!;
    if (reachable.has(hash)) continue;
    const commit = freshNodes.get(hash) || nodes.get(hash);
    if (!commit) return;
    reachable.add(hash);
    pending.push(...commit.parents);
    if (reachable.size % 2048 === 0) await yieldToHost();
  }
  // A recent row not reachable from the captured refs indicates a racing read.
  if (recent.some((commit) => !reachable.has(commit.hash))) return;
  const ordered = [
    ...recent,
    ...saved.filter((commit) => reachable.has(commit.hash) && !fresh.has(commit.hash)),
  ];
  const positions = new Map(ordered.map((commit, index) => [commit.hash, index]));
  if (positions.size !== reachable.size) return;
  const result: TopologyCommit[] = [];
  for (const [index, commit] of ordered.entries()) {
    if (index % 2048 === 0) await yieldToHost();
    // Never publish a cycle, missing parent or parent-before-child ordering.
    if (commit.parents.some((parent) => (positions.get(parent) ?? -1) <= index)) return;
    result.push(decorate(commit));
  }
  return result;
}

export async function readRepositoryTopology(
  root: string,
  compatibleSeed?: TopologyCommit[],
): Promise<TopologySnapshot> {
  const identity = await topologyIdentity(root);
  const cached = caches.get(root);
  if (cached?.identity === identity) {
    caches.delete(root);
    caches.set(root, cached);
    return cached.value;
  }
  const value = (async () => {
    const stashes = await readStashes(root);
    let readCount = 0;
    const previous =
      cached && topologyCompatibility(cached.identity) === topologyCompatibility(identity)
        ? (await cached.value.catch(() => undefined))?.commits
        : compatibleSeed;
    if (previous) {
      // No traversal: read all current commit tips, including old branches and
      // peeled tags outside the recent block, and refresh their decorations.
      const tips = parse(
        await git(
          root,
          [
            'log',
            '--no-walk=unsorted',
            '--all',
            ...stashes.revisions,
            '--decorate=full',
            format,
            '--',
          ],
          {
            maxBuffer: Infinity,
          },
        ),
      );
      for (const limit of [500, 2500]) {
        const recent = parse(
          await git(
            root,
            [
              'log',
              '--date-order',
              '--all',
              ...stashes.revisions,
              '--decorate=full',
              `--max-count=${limit}`,
              format,
              '--',
            ],
            { maxBuffer: Infinity },
          ),
        );
        readCount += recent.length;
        const commits = await joinRecentTopology(previous, recent, tips);
        if (commits) return { commits, mode: 'joined' as const, readCount };
      }
    }
    const commits = parse(
      await git(
        root,
        ['log', '--date-order', '--decorate=full', format, '--all', ...stashes.revisions, '--'],
        {
          maxBuffer: Infinity,
        },
      ),
    );
    return { commits, mode: 'full' as const, readCount: readCount + commits.length };
  })().then(async (result) => {
    // Do not let an in-flight fetch publish under an obsolete identity.
    if ((await topologyIdentity(root)) !== identity) {
      if (caches.get(root) === entry) caches.delete(root);
      throw Error('Repository changed while reading commit graph; retry refresh.');
    }
    nodeIndex(result.commits);
    return result;
  });
  const entry = { identity, value };
  caches.delete(root);
  caches.set(root, entry);
  while (caches.size > 3) caches.delete(caches.keys().next().value);
  void entry.value.catch(() => {
    if (caches.get(root) === entry) caches.delete(root);
  });
  return entry.value;
}
