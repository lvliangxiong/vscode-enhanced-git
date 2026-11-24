import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const client = require('../out/extension/git/client');
const { createHistoryIndexStore } = require('../out/extension/git/history-index-store');
const { historyIdentity } = require('../out/extension/git/history-identity');
const { readHistoryIndexRaw } = require('../out/extension/git/history-index');
const { updateHistoryIndexRaw } = require('../out/extension/git/history-index-update');
const { log } = require('../out/extension/git/history');

test('incremental index reads only missing details and survives ref moves, rewrites, restart and replacement', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-incremental-'));
  const root = path.join(base, 'repo');
  const storage = path.join(base, 'cache');
  const git = client.git;
  const detailBatches: string[][] = [];
  let fullReads = 0;
  try {
    await fs.mkdir(root);
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Tester']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    const commit = async (subject: string) => {
      await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', subject]);
      return (await git(root, ['rev-parse', 'HEAD'])).trim();
    };
    const first = await commit('first needle');
    client.git = (...args) => {
      if (args[1].some((arg: string) => arg.includes('%B'))) {
        if (args[1].includes('--no-walk=unsorted'))
          detailBatches.push(args[2].input.trim().split('\n'));
        else fullReads++;
      }
      return git(...args);
    };
    const store = createHistoryIndexStore(storage);
    const initial = await store.load(root, await historyIdentity(root));
    const second = await commit('second needle');
    const updated = await store.load(root, await historyIdentity(root));
    assert.equal(fullReads, 1);
    assert.deepEqual(detailBatches, [[second]]);
    assert.equal(updated.seed.text.count, 2);
    assert.equal(initial.seed.text.count, 1, 'published snapshots are immutable');
    assert.equal((await initial.search('', 0, { text: 'needle' })).length, 1);
    const check = async (index) => {
      for (const text of ['', 'needle', 'first', 'second', 'rewritten'])
        assert.deepEqual(
          await index.search('', 0, { text }),
          await log(root, '', 0, { text }),
          text,
        );
    };
    await check(updated);
    await git(root, ['branch', 'topic']);
    await git(root, ['checkout', 'topic']);
    const moved = await store.load(root, await historyIdentity(root));
    await check(moved);
    assert.equal(detailBatches.length, 1, 'new branch/HEAD decorations need no body reads');
    await git(root, ['checkout', 'main']);
    await git(root, ['branch', '-D', 'topic']);
    await git(root, ['reset', '--hard', first]);
    const rewound = await store.load(root, await historyIdentity(root));
    await check(rewound);
    assert.equal(
      (await rewound.search('', 0, { text: 'second' })).length,
      0,
      'unreachable commits disappear',
    );
    const rewritten = await commit('rewritten needle');
    const nextHost = createHistoryIndexStore(storage);
    await check(await nextHost.load(root, await historyIdentity(root)));
    assert.equal(fullReads, 1, 'restart can incrementally update persisted data');
    assert.deepEqual(detailBatches.at(-1), [rewritten]);
    // Replace keeps the original object id while changing its effective details.
    const replacement = (
      await git(root, ['commit-tree', 'HEAD^{tree}', '-m', 'replacement needle'])
    ).trim();
    await git(root, ['replace', first, replacement]);
    const replaced = await nextHost.load(root, await historyIdentity(root));
    assert.equal(fullReads, 2, 'replacement refs invalidate immutable detail assumptions');
    await check(replaced);
  } finally {
    client.git = git;
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('shallow deepening retains Git ordering and refreshes cached parents', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-shallow-index-'));
  const root = path.join(base, 'source');
  const clone = path.join(base, 'clone');
  const git = client.git;
  try {
    await fs.mkdir(root);
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    for (const message of ['one', 'two', 'three'])
      await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', message]);
    await git(root, ['clone', '--depth=1', `file://${root}`, clone]);
    const before = await readHistoryIndexRaw(clone);
    await git(clone, ['fetch', '--deepen=2']);
    const delta = await updateHistoryIndexRaw(clone, before);
    assert.equal(delta.added, 2);
    assert.equal(delta.reused, 1);
    assert.equal(delta.raw, await readHistoryIndexRaw(clone));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
