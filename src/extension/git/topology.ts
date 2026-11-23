import { readStashes } from './stashes';
import { layout as graphLayout } from '../../shared/graph';
import type { Commit } from '../../shared/model';
import { git, validHash } from './client';
import { readRepositoryTopology } from './topology-reader';
export { topologyIdentity } from './topology-identity';

const layouts = new WeakMap<
  object,
  {
    commits: Awaited<ReturnType<typeof readRepositoryTopology>>['commits'];
    layout: ReturnType<typeof graphLayout>;
  }
>();
async function repositoryTopology(root: string, revision?: string) {
  let { commits } = await readRepositoryTopology(root);
  // A fixed file-history endpoint can outlive a deleted branch or tag.
  if (revision && !commits.some((commit) => commit.hash === revision)) {
    const raw = await git(
      root,
      ['rev-list', '--date-order', '--parents', validHash(revision), '--'],
      { maxBuffer: Infinity },
    );
    commits = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, ...parents] = line.split(' ');
        return { hash, parents };
      });
  }
  let display = layouts.get(commits);
  if (!display) {
    const visible = (await readStashes(root)).visible(commits);
    display = { commits: visible, layout: graphLayout(visible) };
    layouts.set(commits, display);
  }
  return display;
}
function filteredGraph(commits: Commit[], topology: Commit[]) {
  const indices = new Map(topology.map((c, i) => [c.hash, i]));
  const visible = new Set(commits.map((c) => indices.get(c.hash)));
  const parents = topology.map((c) =>
    c.parents.map((p) => indices.get(p)).filter((i) => i !== undefined),
  );
  const children = topology.map(() => []);
  parents.forEach((list, i) => list.forEach((p) => children[p].push(i)));
  const edges = new Map(
    commits.map((c) => [c.hash, new Set(c.parents.filter((p) => visible.has(indices.get(p))))]),
  );
  const connect = (a, b) => {
    const [child, parent] = a < b ? [a, b] : [b, a];
    edges.get(topology[child].hash).add(topology[parent].hash);
  };
  // Propagate one nearest visible endpoint through hidden nodes. Comparing it
  // with the endpoint already represented by a direct edge avoids fan-out to
  // every reachable ancestor at hidden merges.
  for (const downward of [true, false]) {
    const empty = downward ? -Infinity : Infinity;
    const choose = downward ? Math.max : Math.min;
    const numbers = new Array(topology.length).fill(empty);
    const adjacent = downward ? children : parents;
    for (let step = 0; step < topology.length; step++) {
      const i = downward ? step : topology.length - 1 - step;
      let hidden = empty,
        direct = empty;
      for (const neighbor of adjacent[i]) {
        if (!visible.has(i)) {
          hidden = choose(hidden, visible.has(neighbor) ? neighbor : numbers[neighbor]);
        } else if (visible.has(neighbor)) {
          direct = choose(direct, numbers[neighbor]);
        } else {
          hidden = choose(hidden, numbers[neighbor]);
        }
      }
      if (!visible.has(i)) numbers[i] = hidden;
      else if (hidden === empty || hidden === direct) numbers[i] = direct;
      else {
        connect(i, hidden);
        numbers[i] = hidden;
      }
    }
  }
  return commits.map((c) => ({ ...c, graphParents: [...edges.get(c.hash)] }));
}

async function projectGraph(
  root: string,
  commits: Commit[],
  options: {
    project?: boolean;
    firstParent?: boolean;
    hasMore?: boolean;
    firstBlock?: boolean;
    revision?: string;
    sortByTopology?: boolean;
  } = {},
) {
  if (!commits.length) return [];
  if (options.firstBlock) {
    const layout = graphLayout(commits);
    const visible = new Set(commits.map((commit) => commit.hash));
    return commits.map((commit) => ({
      ...commit,
      ...layout.get(commit.hash),
      graphUnloadedParents: options.hasMore
        ? commit.parents.filter((parent) => !visible.has(parent))
        : [],
    }));
  }
  // Build permanent layout from the full repository, so filtering/pagination do
  // not assign a different column order or color to the same branch fragment.
  const { commits: topology, layout } = await repositoryTopology(root, options.revision);
  const indices = new Map(topology.map((c, i) => [c.hash, i]));
  const ordered = options.sortByTopology
    ? commits.toSorted(
        (a, b) => (indices.get(a.hash) ?? Infinity) - (indices.get(b.hash) ?? Infinity),
      )
    : commits;
  const display =
    options.project === false
      ? ordered
      : filteredGraph(
          ordered,
          options.firstParent
            ? topology.map((c) => ({ ...c, parents: c.parents.slice(0, 1) }))
            : topology,
        );
  const boundary = commits.reduce((max, c) => Math.max(max, indices.get(c.hash) ?? -1), -1);
  const visible = new Set(commits.map((c) => c.hash));
  return display.map((c) => ({
    ...c,
    ...layout.get(c.hash),
    graphUnloadedParents: options.hasMore
      ? (options.firstParent ? c.parents.slice(0, 1) : c.parents).filter(
          (p) => !visible.has(p) && (indices.get(p) ?? Infinity) > boundary,
        )
      : [],
  }));
}

export { filteredGraph, projectGraph };
