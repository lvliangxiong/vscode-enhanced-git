import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import {
  createFileHistory,
  fileHistoryDiff,
  compareHistoryEntries,
} from '../src/extension/git/file-history';

async function fixture(
  run: (root: string, commit: (message: string) => Promise<string>) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-file-history-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'History Author']);
    await git(root, ['config', 'user.email', 'history@example.com']);
    await run(root, async (message) => {
      await git(root, ['add', '-A']);
      await git(root, ['commit', '-m', message]);
      return (await git(root, ['rev-parse', 'HEAD'])).trim();
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('file history paginates across rename boundaries, fixed revision and absent working-tree file', async () => {
  await fixture(async (root, commit) => {
    const oldPath = 'old [literal].txt',
      newPath = '中文 new\nfile.txt';
    await fs.writeFile(path.join(root, oldPath), 'one\n');
    const added = await commit('Added file');
    await fs.appendFile(path.join(root, oldPath), 'two\n');
    const modified = await commit('Changed file\n\nDetailed message');
    await fs.rename(path.join(root, oldPath), path.join(root, newPath));
    const renamed = await commit('Renamed file');
    await fs.appendFile(path.join(root, newPath), 'three\n');
    const end = await commit('History endpoint');
    const history = createFileHistory(root, end, newPath);
    await fs.rm(path.join(root, newPath));
    const deleted = await commit('Later deletion');
    const entries = [];
    for (let i = 0; i < 8; i++) {
      const page = await history.next(1);
      entries.push(...page.entries);
      if (!page.hasMore) break;
    }
    assert.deepEqual(
      entries.map((e) => e.hash),
      [end, renamed, modified, added],
    );
    assert.deepEqual(
      entries.map((e) => e.path),
      [newPath, newPath, oldPath, oldPath],
    );
    assert.equal(entries[2].message, 'Changed file\n\nDetailed message');
    const { projectGraph } = await import('../src/extension/git/topology');
    const projected = await projectGraph(root, entries, { revision: end });
    assert.ok(
      projected.find((entry) => entry.hash === renamed).graphParents.includes(modified),
      'renaming keeps the old-path graph connection',
    );
    const renameDiff = await fileHistoryDiff(root, entries[1]);
    assert.match(renameDiff.beforeLabel, /old \[literal\].txt/);
    assert.deepEqual(renameDiff.contents, ['one\ntwo\n', 'one\ntwo\n']);
    const endpoints = await compareHistoryEntries(root, entries[3], entries[0]);
    assert.deepEqual(endpoints.contents, ['one\n', 'one\ntwo\nthree\n']);
    const creationDiff = await fileHistoryDiff(root, entries[3]);
    assert.deepEqual(creationDiff.contents, ['', 'one\n']);
    const deletionHistory = await createFileHistory(root, deleted, newPath).next();
    assert.equal(deletionHistory.entries[0].hash, deleted);
    assert.deepEqual((await fileHistoryDiff(root, deletionHistory.entries[0])).contents, [
      'one\ntwo\nthree\n',
      '',
    ]);
  });
});

test('file history retains a resolved merge and compares its actual first parent', async () => {
  await fixture(async (root, commit) => {
    await fs.writeFile(path.join(root, 'file.txt'), 'base\n');
    await commit('Base');
    await git(root, ['checkout', '-b', 'feature']);
    await fs.writeFile(path.join(root, 'file.txt'), 'feature\n');
    await commit('Feature change');
    await git(root, ['checkout', 'main']);
    await fs.writeFile(path.join(root, 'file.txt'), 'main\n');
    const parent = await commit('Main change');
    await assert.rejects(git(root, ['merge', '--no-ff', 'feature', '-m', 'Merge']));
    await fs.writeFile(path.join(root, 'file.txt'), 'resolved\n');
    const merge = await commit('Resolved merge');
    const { entries } = await createFileHistory(root, merge, 'file.txt').next();
    assert.equal(entries[0].hash, merge);
    assert.equal(entries[0].parents[0], parent);
    assert.equal(entries[0].parents.length, 2);
    assert.deepEqual((await fileHistoryDiff(root, entries[0])).contents, ['main\n', 'resolved\n']);
    assert.ok(entries.some((e) => e.subject === 'Feature change'));
    const { projectGraph } = await import('../src/extension/git/topology');
    const projected = await projectGraph(root, entries, { revision: merge });
    assert.equal(projected[0].graphParents.length, 2, 'both visible merge branches are connected');
  });
});

test('file history uses literal paths and stops at a new creation of a reused name', async () => {
  await fixture(async (root, commit) => {
    const file = ':history *[x].txt';
    await fs.writeFile(path.join(root, file), 'old\n');
    await commit('Old unrelated lifetime');
    await fs.rm(path.join(root, file));
    await commit('Delete old file');
    await fs.writeFile(path.join(root, file), 'new\n');
    const added = await commit('New lifetime');
    await fs.writeFile(path.join(root, 'another.txt'), 'other\n');
    const head = await commit('Unrelated');
    const result = await createFileHistory(root, head, file).next();
    assert.deepEqual(
      result.entries.map((e) => e.hash),
      [added],
    );
    assert.equal(result.hasMore, false);
    assert.throws(() => createFileHistory(root, head, '../outside'), /Invalid history path/);
    assert.throws(() => createFileHistory(root, '--all', file), /Invalid commit/);
  });
});

test('file history projects skipped ancestors, page boundaries and an unreferenced fixed endpoint', async () => {
  const { projectGraph } = await import('../src/extension/git/topology');
  const { createRows } = await import('../src/shared/graph');
  await fixture(async (root, commit) => {
    await fs.writeFile(path.join(root, 'file.txt'), 'base\n');
    const base = await commit('Base file');
    await fs.writeFile(path.join(root, 'other.txt'), 'hidden\n');
    const hidden = await commit('Unrelated change');
    await fs.appendFile(path.join(root, 'file.txt'), 'edit\n');
    const tip = await commit('File edit');
    const history = createFileHistory(root, tip, 'file.txt');
    const first = await history.next(1);
    const initial = await projectGraph(root, first.entries, { hasMore: true, revision: tip });
    assert.deepEqual(initial[0].parents, [hidden], 'diff retains the actual parent');
    assert.deepEqual(initial[0].graphUnloadedParents, [hidden], 'pagination remains open');
    const rest = await history.next(1);
    const all = [...first.entries, ...rest.entries];
    const projected = await projectGraph(root, all, { hasMore: rest.hasMore, revision: tip });
    assert.deepEqual(
      projected.map((entry) => entry.hash),
      [tip, base],
    );
    assert.deepEqual(projected[0].graphParents, [base], 'graph skips the unrelated commit');
    assert.ok(
      createRows(projected)
        .get(0)
        .segments.some((segment) => segment.edge.dashed),
    );
    assert.deepEqual(
      projected[1].graphUnloadedParents,
      [],
      'completed history has no continuation arrow',
    );
    await git(root, ['checkout', '--orphan', 'replacement']);
    await git(root, ['rm', '-rf', '.']);
    await fs.writeFile(path.join(root, 'new.txt'), 'unrelated root');
    await commit('Replacement root');
    await git(root, ['branch', '-D', 'main']);
    const detached = await projectGraph(root, all, { revision: tip });
    assert.deepEqual(
      detached[0].graphParents,
      [base],
      'fixed history survives deletion of its branch',
    );
  });
});
