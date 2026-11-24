import { git, validHash } from './client';
import { readSelectionItems } from './selection-reader';
import type { FileChange, ParentChanges } from '../../shared/model';
async function details(root, hash, { mergeChanges = false } = {}) {
  validHash(hash);
  if (mergeChanges) {
    const [{ hash: _, ...item }] = await readSelectionItems(root, [hash]);
    return item;
  }
  const [message, parentsRaw] = await Promise.all([
    git(root, ['show', '-s', '--format=%B', hash, '--']),
    git(root, ['show', '-s', '--format=%P', hash, '--']),
  ]);
  const parents = parentsRaw.trim().split(' ').filter(Boolean);
  const args = ['diff-tree', '-M', '--no-commit-id', '--name-status', '-r', '-z'];
  const revisions = [parents[0]];
  const changes = await Promise.all(
    revisions.map(async (parent) => {
      const raw = await git(
        root,
        parent ? [...args, parent, hash, '--'] : [...args, '--root', hash, '--'],
      );
      const parts = raw.split('\0'),
        files = [];
      for (let i = 0; i < parts.length - 1;) {
        const status = parts[i++];
        const oldPath = parts[i++];
        const path = status.startsWith('R') || status.startsWith('C') ? parts[i++] : oldPath;
        files.push({ status: status[0], path, oldPath });
      }
      return files;
    }),
  );
  // Explicit first-parent callers (for example patch export) keep their existing
  // meaning. Log selection uses the merged reader above instead.
  const files = changes[0];
  const rawStats = await git(root, [
    'diff-tree',
    '-M',
    '--no-commit-id',
    '--numstat',
    '-r',
    '-z',
    ...(parents.length ? [parents[0], hash] : ['--root', hash]),
    '--',
  ]);
  const parts = rawStats.split('\0'),
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
  return { message: message.trim(), parents, files, stats };
}

async function patch(root, hash, path) {
  const info = await details(root, hash);
  if (!info.files.some((f) => f.path === path)) throw new Error('Unknown changed file');
  return git(
    root,
    info.parents.length
      ? [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          info.parents[0],
          hash,
          '--',
          `:(literal)${path}`,
        ]
      : ['show', '--format=', '--no-ext-diff', '--no-textconv', hash, '--', `:(literal)${path}`],
  );
}
// Compose selected changes in oldest-to-newest log order, like Rebased's zipChanges.

async function selectionDetails(root, hashes, { includeStats = true } = {}) {
  const items = await readSelectionItems(root, hashes, includeStats);
  const toChange = (item, file, parent = 0): Omit<FileChange, 'index'> => ({
    path: file.path,
    status: file.status,
    before:
      file.status === 'A' ? null : { hash: item.parents[parent], path: file.oldPath || file.path },
    after: file.status === 'D' ? null : { hash: file.afterHash || item.hash, path: file.path },
  });
  if (items.length === 1 && items[0].parents.length > 1) {
    const item = items[0];
    const files: FileChange[] = item.files.map((file, index) => ({
      ...toChange(item, file.sources[0]),
      status: file.status,
      index,
      mergeParents: file.sources.map((source, parent) => toChange(item, source, parent).before),
    }));
    let index = files.length;
    const parents: ParentChanges[] = item.changesToParents.map((files, parent) => ({
      hash: item.parents[parent],
      files: files.map((file) => ({ ...toChange(item, file, parent), index: index++ })),
    }));
    return { items, files, parents };
  }
  const buckets = new Map();
  for (const item of [...items].reverse())
    for (const file of item.files) {
      const { before, after } = toChange(item, file.sources?.[0] || file);
      const bucket = before ? buckets.get(before.path) : null;
      let change = { before, after };
      if (bucket?.length) {
        const previous = bucket.shift();
        change = { before: previous.before, after };
      }
      if (!change.before && !change.after) continue;
      const key = after?.path || null;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(change);
    }
  const files = [...buckets.values()].flat().map((change, index) => ({
    ...change,
    index,
    path: change.after?.path || change.before.path,
    status: !change.before
      ? 'A'
      : !change.after
        ? 'D'
        : change.before.path !== change.after.path
          ? 'R'
          : 'M',
  }));
  return { items, files };
}

async function selectionPatch(
  root,
  change,
  contextLines = 3,
  contents?: [string, string],
  algorithm?: 'histogram',
) {
  if (change.mergeParents?.length === 2) {
    const patches = await Promise.all(
      change.mergeParents.map(
        async (before, parent) =>
          `Parent ${parent + 1} (${before?.hash.slice(0, 8) || 'Absent'}) → Merge Result\n` +
          (await selectionPatch(root, { ...change, before, mergeParents: undefined })),
      ),
    );
    return patches.join('\n');
  }
  const fs = require('node:fs/promises'),
    os = require('node:os'),
    path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-diff-'));
  try {
    const before = path.join(dir, 'before'),
      after = path.join(dir, 'after');
    await Promise.all([
      fs.writeFile(
        before,
        contents
          ? contents[0]
          : change.before
            ? await git(root, ['show', `${change.before.hash}:${change.before.path}`])
            : '',
      ),
      fs.writeFile(
        after,
        contents
          ? contents[1]
          : change.after
            ? await git(root, ['show', `${change.after.hash}:${change.after.path}`])
            : '',
      ),
    ]);
    let text;
    try {
      text = await git(root, [
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-textconv',
        ...(algorithm ? [`--diff-algorithm=${algorithm}`] : []),
        `--unified=${contextLines}`,
        '--no-color',
        '--',
        change.before ? before : '/dev/null',
        change.after ? after : '/dev/null',
      ]);
    } catch (error) {
      if (error.code !== 1) throw error;
      text = error.stdout;
    }
    return text.split(before).join(change.path).split(after).join(change.path);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
// Resolve branch choices before any comparison or mutation. HEAD represents the current branch.

export function selectionChange(
  result: Awaited<ReturnType<typeof selectionDetails>>,
  index: number,
) {
  return (
    result.files.find((file) => file.index === index) ||
    result.parents?.flatMap((parent) => parent.files).find((file) => file.index === index)
  );
}
export { details, patch, selectionDetails, selectionPatch };
