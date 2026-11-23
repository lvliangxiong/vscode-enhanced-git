import { readStashes } from '../src/extension/git/stashes';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { git } from '../src/extension/git/client';
import { log } from '../src/extension/git/history';
import { loadHistoryPage } from '../src/extension/git/history-page';
import {
  readHistoryIndex,
  readHistoryIndexRaw,
  buildHistoryIndex,
} from '../src/extension/git/history-index';
import { updateHistoryIndexRaw } from '../src/extension/git/history-index-update';
import { projectGraph } from '../src/extension/git/topology';
import { selectionDetails } from '../src/extension/git/changes';
import { readSelectionStats } from '../src/extension/git/selection-reader';
import { historyIdentity } from '../src/extension/git/history-identity';

test('stash history shows one node per entry with pagination, graph and complete file diffs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-stash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Fixture']);
  await git(root, ['config', 'user.email', 'fixture@example.com']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await fs.writeFile(path.join(root, 'tracked'), 'base\n');
  await git(root, ['add', '.']);
  // An ordinary commit with an internal-looking subject must survive.
  await git(root, ['commit', '-m', 'index on main: ordinary commit']);
  const base = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const hashes: string[] = [];
  for (const name of ['older', 'newer']) {
    await fs.writeFile(path.join(root, 'tracked'), `${name}\n`);
    await git(root, ['add', 'tracked']);
    await fs.writeFile(path.join(root, 'tracked'), `${name}\nunstaged\n`);
    await fs.writeFile(path.join(root, name), 'untracked\n');
    await git(root, ['stash', 'push', '-u', '-m', name]);
    hashes.unshift((await git(root, ['rev-parse', 'refs/stash'])).trim());
  }
  const commits = await log(root, '', 0);
  assert.equal(commits.length, 3);
  for (const hash of hashes) {
    const commit = commits.find((c) => c.hash === hash);
    assert.deepEqual(commit.parents, [base]);
    assert.match(commit.decorations, /stash@\{\d+\}/);
  }
  assert.deepEqual(
    (await log(root, 'main', 0)).map((c) => c.hash),
    [base],
  );
  const first = await loadHistoryPage(root, '', 1);
  assert.equal(first.history.length, 1);
  assert.equal(first.hasMore, true);
  const full = await loadHistoryPage(root, '', 3);
  assert.equal(full.hasMore, false);
  assert.equal(full.history.length, 3);
  assert.equal((await log(root, '', 0, { hideMerges: true })).length, 3);
  const graph = await projectGraph(root, commits, { project: false });
  for (const c of graph) assert.ok(c.parents.every((p) => p === base));
  const index = await readHistoryIndex(root);
  assert.deepEqual(
    (await index.search('', 0, {})).map((c) => c.hash),
    commits.map((c) => c.hash),
  );
  assert.equal((await index.search('', 0, { text: 'index on main' })).length, 1);
  const selection = await selectionDetails(root, [hashes[0]]);
  assert.equal(selection.items.length, 1);
  assert.deepEqual(selection.files.map((f) => f.path).sort(), ['newer', 'tracked']);
  assert.equal(selection.items[0].stats.files, 2);
  for (const file of selection.files) {
    const content = await git(root, ['show', `${file.after.hash}:${file.after.path}`]);
    assert.equal(content, file.path === 'tracked' ? 'newer\nunstaged\n' : 'untracked\n');
  }
  const lazy = await selectionDetails(root, [hashes[0]], { includeStats: false });
  assert.deepEqual((await readSelectionStats(root, lazy.items))[0].stats, selection.items[0].stats);
  const stashList = (await readStashes(root)).list;
  assert.deepEqual(
    stashList.map((stash) => stash.ref),
    ['stash@{0}', 'stash@{1}'],
  );
  assert.match(stashList[0].subject, /newer/);
  assert.match(stashList[1].subject, /older/);
  assert.equal(stashList[0].hash, (await git(root, ['rev-parse', 'stash@{0}'])).trim());
  const raw = await readHistoryIndexRaw(root),
    identity = await historyIdentity(root);
  await git(root, ['stash', 'drop', 'stash@{1}']);
  assert.notEqual(await historyIdentity(root), identity);
  const updated = await updateHistoryIndexRaw(root, raw, true);
  const rebuilt = await buildHistoryIndex(root, updated.raw);
  assert.equal((await rebuilt.search('', 0, {})).length, 2);
  assert.equal((await log(root, '', 0)).length, 2);
  await git(root, ['stash', 'clear']);
  assert.deepEqual((await readStashes(root)).list, []);
  assert.deepEqual(
    (await log(root, '', 0)).map((c) => c.hash),
    [base],
  );
  assert.equal((await git(root, ['status', '--porcelain'])).trim(), '');
});
