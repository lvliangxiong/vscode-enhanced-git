import { readStashes } from './stashes';
import { randomUUID } from 'node:crypto';
import { git, validHash } from './client';
import { mergeFileStatuses, type ChangedFile } from './merge-changes';
interface CommitInfo {
  hash: string;
  parents: string[];
  message: string;
}

// Explicit parent pairs retain the same merge/rename semantics as individual
// diff-tree calls. Git echoes non-revision input lines, delimiting even empty
// diffs. A per-call random marker cannot be confused with ordinary file names.
async function treeBatch(root: string, pairs: string[], kind: '--name-status' | '--numstat') {
  if (!pairs.length) return [];
  const marker = `vscode-git-${randomUUID()}:`;
  const input = pairs.map((pair, i) => `${marker}${i}\n${pair}\n`).join('');
  const output = await git(
    root,
    [
      'diff-tree',
      '--stdin',
      '--root',
      '-r',
      '-M',
      '-z',
      '--no-commit-id',
      '--no-ext-diff',
      '--no-textconv',
      kind,
    ],
    { input },
  );
  const sections = output.split(marker).slice(1);
  if (sections.length !== pairs.length) throw Error('Incomplete selected commit changes');
  return sections.map((section, i) => {
    const header = `${i}\n`;
    if (!section.startsWith(header)) throw Error('Invalid selected commit changes');
    return section.slice(header.length);
  });
}

function parseFiles(raw: string): ChangedFile[] {
  const parts = raw.split('\0'),
    files: ChangedFile[] = [];
  for (let i = 0; i < parts.length - 1;) {
    const status = parts[i++],
      oldPath = parts[i++];
    const path = /^[RC]/.test(status) ? parts[i++] : oldPath;
    files.push({ status: status[0], path, oldPath });
  }
  return files;
}

function parseStats(raw: string, files: ChangedFile[]) {
  const parts = raw.split('\0'),
    visible = new Set(files.map((file) => file.path));
  const stats = { files: files.length, insertions: 0, deletions: 0, binary: 0 };
  for (let i = 0; i < parts.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[i]);
    if (!match) continue;
    let path = match[3];
    if (!path) {
      i++;
      path = parts[++i];
    }
    if (!visible.has(path)) continue;
    if (match[1] === '-') stats.binary++;
    else {
      stats.insertions += Number(match[1]);
      stats.deletions += Number(match[2]);
    }
  }
  return stats;
}

/** Three Git processes per bounded batch, instead of four or more per commit. */
export async function readSelectionItems(root: string, hashes: string[], includeStats = true) {
  hashes.forEach(validHash);
  let stashes: Awaited<ReturnType<typeof readStashes>> | undefined;
  const items = [];
  for (let offset = 0; offset < hashes.length; offset += 64) {
    const batch = hashes.slice(offset, offset + 64);
    const raw = await git(
      root,
      ['log', '--no-walk=unsorted', '--stdin', '--format=%H%x00%P%x00%B%x00', '--'],
      { input: batch.join('\n') + '\n' },
    );
    const fields = raw.split('\0'),
      metadata = new Map<string, CommitInfo>();
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const hash = fields[i].trim();
      metadata.set(hash, {
        hash,
        parents: fields[i + 1].split(' ').filter(Boolean),
        message: fields[i + 2].trim(),
      });
    }
    if (!stashes && [...metadata.values()].some((commit) => commit.parents.length > 1))
      stashes = await readStashes(root);
    const commits = batch.map((hash) => {
      const info = metadata.get(hash);
      if (!info) throw Error('Selected commit no longer exists');
      return stashes?.entries.has(hash) ? { ...info, parents: info.parents.slice(0, 1) } : info;
    });
    const pairs = (commit: CommitInfo) =>
      commit.parents.length
        ? commit.parents.map((parent) => `${commit.hash} ${parent}`)
        : [commit.hash];
    const [changes, stats] = await Promise.all([
      treeBatch(root, commits.flatMap(pairs), '--name-status'),
      includeStats
        ? treeBatch(
            root,
            commits.map((commit) => pairs(commit)[0]),
            '--numstat',
          )
        : Promise.resolve(null),
    ]);
    let index = 0;
    for (const [i, commit] of commits.entries()) {
      const all = Array.from({ length: Math.max(1, commit.parents.length) }, () =>
        parseFiles(changes[index++]),
      );
      const files = mergeFileStatuses(all);
      const untracked = stashes?.entries.get(commit.hash)?.parents[2];
      const extra = untracked
        ? (await readSelectionItems(root, [untracked], includeStats))[0]
        : undefined;
      const totals = stats ? parseStats(stats[i], files) : undefined;
      if (extra) {
        files.push(...extra.files.map((file) => ({ ...file, afterHash: untracked })));
        if (totals)
          for (const key of ['files', 'insertions', 'deletions', 'binary'])
            totals[key] += extra.stats[key];
      }
      items.push({
        ...commit,
        files,
        ...(commit.parents.length > 1 ? { changesToParents: all } : {}),
        ...(totals ? { stats: totals } : {}),
      });
    }
  }
  return items;
}

/** Line counts require reading blobs; they must not hold up file navigation. */
export async function readSelectionStats(
  root: string,
  items: (CommitInfo & { files: ChangedFile[] })[],
) {
  const result = [];
  for (let offset = 0; offset < items.length; offset += 64) {
    const batch = items.slice(offset, offset + 64);
    const raw = await treeBatch(
      root,
      batch.map((item) => (item.parents.length ? `${item.hash} ${item.parents[0]}` : item.hash)),
      '--numstat',
    );
    result.push(
      ...batch.map((item, i) => ({ hash: item.hash, stats: parseStats(raw[i], item.files) })),
    );
  }
  for (const [i, item] of items.entries()) {
    const untracked = item.files.find((file) => file.afterHash)?.afterHash;
    if (!untracked) continue;
    const raw = await treeBatch(root, [untracked], '--numstat');
    const extra = parseStats(
      raw[0],
      item.files.filter((file) => file.afterHash),
    );
    // The base count already includes these files; only add their line statistics.
    for (const key of ['insertions', 'deletions', 'binary']) result[i].stats[key] += extra[key];
  }
  return result;
}

/** One immutable selection per log pane; includes in-flight requests and retries failures. */
export function createSelectionReader<T>(read: (root: string, hashes: string[]) => Promise<T>) {
  let cached: { key: string; result: Promise<T> } | undefined;
  return (root: string, hashes: string[]) => {
    const key = JSON.stringify([root, hashes]);
    if (cached?.key === key) return cached.result;
    const result = read(root, hashes);
    cached = { key, result };
    void result.catch(() => {
      if (cached?.result === result) cached = undefined;
    });
    return result;
  };
}
