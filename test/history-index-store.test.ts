import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const { createMessageIndex } = require('../out/extension/git/message-index');
const { createHistoryIndexStore } = require('../out/extension/git/history-index-store');
const { historyIdentity } = require('../out/extension/git/history-identity');
const { createHistoryCache } = require('../out/extension/git/history-cache');
const client = require('../out/extension/git/client');

test('bounded trigram candidates never lose exact matches, including overflow and Unicode', async () => {
  const messages = ['needle', '中文正文', 'another needle', 'x'.repeat(50) + 'needle', 'other'];
  for (const budget of [{}, { maxPostings: 1 }, { maxKeys: 1 }, { maxLength: 10 }]) {
    const index = await createMessageIndex(messages, budget);
    for (const query of ['needle', '正文', '中文正文', 'another', 'none', '']) {
      const candidates = index.candidates(query) ?? [...messages.keys()];
      const actual = candidates.filter((row: number) => messages[row].includes(query));
      assert.deepEqual(
        actual,
        [...messages.keys()].filter((row) => messages[row].includes(query)),
      );
    }
  }
  const selective = await createMessageIndex(['apple', 'banana', 'pineapple']);
  assert.deepEqual(selective.candidates('banana'), [1], 'unrelated messages are not scanned');
});

test('search index persists, shares across views, invalidates and recovers from corrupt storage', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-git-index-store-'));
  const root = path.join(base, 'repo');
  const storage = path.join(base, 'storage');
  const git = client.git;
  let reads = 0;
  try {
    await fs.mkdir(root);
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    const commit = (message: string) =>
      git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', message]);
    await commit('first needle');
    client.git = (...args) => {
      if (args[1].includes('--max-count=100001')) reads++;
      return git(...args);
    };
    const identity = await historyIdentity(root);
    const store = createHistoryIndexStore(storage);
    const a = store.load(root, identity);
    assert.strictEqual(store.load(root, identity), a, 'concurrent views share one build');
    const index = await a;
    assert.equal(index.count, 1);
    assert.equal(reads, 1);
    const firstView = await createHistoryCache(store.load).snapshot(root);
    const secondView = await createHistoryCache(store.load).snapshot(root);
    await Promise.all([firstView.prepareIndex(), secondView.prepareIndex()]);
    assert.equal(reads, 1, 'new Log views reuse the repository index');
    assert.deepEqual(
      await firstView.context.indexed('', 500, { authorQueries: ['me'] }),
      await index.search('', 500, {}),
    );
    const reopened = await createHistoryIndexStore(storage).load(root, identity);
    assert.equal(reads, 1, 'new host reads persisted commit data without git log');
    assert.deepEqual(
      await reopened.search('', 500, { text: 'needle' }),
      await index.search('', 500, { text: 'needle' }),
    );
    const files = await fs.readdir(path.join(storage, 'history-index'));
    const cacheFile = path.join(storage, 'history-index', files[0]);
    assert.equal((await fs.stat(cacheFile)).mode & 0o777, 0o600);
    await fs.writeFile(cacheFile, 'corrupt');
    assert.equal((await createHistoryIndexStore(storage).load(root, identity)).count, 1);
    assert.equal(reads, 2, 'corrupt file rebuilds automatically');
    await createHistoryIndexStore(storage).load(root, identity, true);
    assert.equal(reads, 3, 'explicit index rebuild bypasses persisted data');
    await commit('second');
    const newer = await store.load(root, await historyIdentity(root));
    assert.equal(newer.count, 2);
    assert.equal(reads, 3, 'ref changes join recent history without a full index read');
    assert.equal(
      await createHistoryIndexStore(storage).load(root, identity),
      undefined,
      'a ref change during background work cannot publish a stale snapshot',
    );
    const unwritable = path.join(base, 'not-a-directory');
    await fs.writeFile(unwritable, 'file');
    assert.equal(
      (await createHistoryIndexStore(unwritable).load(root, await historyIdentity(root))).count,
      2,
      'storage failure leaves the in-memory index usable',
    );
  } finally {
    client.git = git;
    await fs.rm(base, { recursive: true, force: true });
  }
});
