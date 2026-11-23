import type { HistoryFilters } from '../src/shared/model';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { git } = require('../out/extension/git/client');
const { createHistoryCache, HistorySnapshot } = require('../out/extension/git/history-cache');
const { loadHistoryPage } = require('../out/extension/git/history-page');
const { projectGraph } = require('../out/extension/git/topology');

test('history snapshots invalidate for external refs, HEAD, config, shallow history and explicit refresh', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-filter-cache-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Alice']);
    await git(root, ['config', 'user.email', 'alice@example.com']);
    const cache = createHistoryCache();
    const empty = await cache.snapshot(root);
    assert.deepEqual(await empty.branches(), []);
    assert.strictEqual(await cache.snapshot(root), empty, 'unborn repositories are cacheable');
    await fs.writeFile(path.join(root, 'one.txt'), 'first');
    await git(root, ['add', '.']);
    await git(root, [
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'first',
      '-m',
      'Hidden body needle',
    ]);
    await git(root, ['branch', 'topic']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'second']);
    const snapshot = await cache.snapshot(root);
    assert.notStrictEqual(snapshot, empty);
    assert.strictEqual(await cache.snapshot(root), snapshot);
    assert.strictEqual(
      snapshot.branches(),
      snapshot.branches(),
      'metadata requests share promises',
    );
    const cases: [string | string[], HistoryFilters][] = [
      ['', { text: 'body needle' }],
      ['', { text: '^Hidden.*needle', regex: true, matchCase: true }],
      ['', { authorQueries: ['me'] }],
      ['main', { paths: ['one.txt'] }],
      [['topic..main'], { firstParent: true, hideMerges: true }],
      ['', { since: '2000-01-01', until: '2099-01-01', sort: 'topological' }],
      ['', { text: 'no results here' }],
    ];
    for (const [ref, filters] of cases) {
      const expected = await loadHistoryPage(root, ref, 1, filters);
      const actual = await loadHistoryPage(root, ref, 1, filters, undefined, 500, snapshot.context);
      assert.deepEqual(actual, expected, JSON.stringify([ref, filters]));
      const key = JSON.stringify([ref, filters]);
      let reads = 0;
      const read = async () => {
        reads++;
        return {
          ...actual,
          history: await projectGraph(root, actual.history, {
            ...filters,
            hasMore: actual.hasMore,
          }),
        };
      };
      const first = await snapshot.history(key, read);
      assert.strictEqual(await snapshot.history(key, read), first);
      assert.equal(reads, 1, 'repeated filters reuse Git results and projected graph');
    }
    await git(root, ['branch', 'same-head']);
    const afterBranch = await cache.snapshot(root);
    assert.notStrictEqual(afterBranch, snapshot);
    await git(root, ['checkout', 'same-head']);
    const afterCheckout = await cache.snapshot(root);
    assert.notStrictEqual(afterCheckout, afterBranch, 'same hash but different HEAD decoration');
    await git(root, ['config', 'user.email', 'different@example.com']);
    const afterConfig = await cache.snapshot(root);
    assert.notStrictEqual(afterConfig, afterCheckout);
    assert.equal((await afterConfig.user())[0].trim(), 'different@example.com');
    const forced = await cache.snapshot(root, 0, true);
    assert.notStrictEqual(forced, afterConfig);
    const changed = await cache.snapshot(root, 1);
    assert.notStrictEqual(changed, forced);
    cache.clear();
    assert.notStrictEqual(await cache.snapshot(root, 1), changed);
    const clone = path.join(root, 'shallow-clone');
    await git(root, ['clone', '--depth=1', `file://${root}`, clone]);
    const shallow = await cache.snapshot(clone);
    assert.notStrictEqual(shallow, changed, 'repository isolation');
    await git(clone, ['fetch', '--deepen=1']);
    assert.notStrictEqual(await cache.snapshot(clone), shallow);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('history result cache deduplicates pending work, retries failures and bounds entries and rows', async () => {
  const cache = new HistorySnapshot('/fixture', 2, 3);
  const page = (count: number) => ({
    history: Array.from({ length: count }, (_, i) => ({ hash: String(i) })),
  });
  let finish;
  const pending = cache.history(
    'a',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.strictEqual(
    cache.history('a', () => {
      throw Error('duplicate');
    }),
    pending,
  );
  finish(page(1));
  await pending;
  const b = await cache.history('b', async () => page(1));
  await cache.history('c', async () => page(1));
  assert.strictEqual(
    await cache.history('b', async () => {
      throw Error('evicted recent result');
    }),
    b,
  );
  let reads = 0;
  await cache.history('a', async () => {
    reads++;
    return page(1);
  });
  assert.equal(reads, 1, 'oldest result evicted');
  await cache.history('large', async () => page(4));
  await cache.history('large', async () => {
    reads++;
    return page(4);
  });
  assert.equal(reads, 2, 'oversized result not retained');
  await cache.history('three', async () => page(3));
  await cache.history('one', async () => page(1));
  await cache.history('three', async () => {
    reads++;
    return page(3);
  });
  assert.equal(reads, 3, 'total row budget evicts old results');
  await assert.rejects(
    cache.history('error', async () => {
      throw Error('transient');
    }),
    /transient/,
  );
  await cache.history('error', async () => page(0));
});

test('background text index matches Git full messages, case folding, limits and falls back for complex filters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-text-index-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    for (const [i, message] of [
      'First\n\nHidden BODY needle 中文正文',
      'second FIX(swg)',
      'third résumé K ſ',
      'newest body needle',
    ].entries()) {
      const author = [
        'Test <test@example.com>',
        'Other <other@example.com>',
        'TEST <TEST@example.com>',
        'Test.Other <someone@example.com>',
      ][i];
      await git(root, [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        `--author=${author}`,
        '-m',
        message,
      ]);
    }
    const { readHistoryIndex } = require('../out/extension/git/history-index');
    const { log } = require('../out/extension/git/history');
    const index = await readHistoryIndex(root);
    for (const text of ['body needle', 'FIX(swg)', '中文正文', 'k', 'S', 'not found', '']) {
      for (const matchCase of [true, false]) {
        for (const limit of [0, 1, 3]) {
          const filters = { text, matchCase };
          const indexed = await index.search('', limit, filters);
          assert.notEqual(indexed, undefined, 'ordinary text uses the index');
          assert.deepEqual(
            indexed,
            await log(root, '', limit, filters),
            JSON.stringify({ filters, limit }),
          );
        }
      }
    }
    for (const filters of [
      { text: 'résumé' },
      { text: 'a.*', regex: true },
      { paths: ['x'] },
      { sinceHours: 24 },
      { firstParent: true },
      { sort: 'topological' },
      { showSignature: true },
      { text: 'abcd' },
    ])
      assert.equal(
        await index.search('', 500, filters),
        undefined,
        'non-equivalent filters use Git',
      );
    assert.equal(await index.search('main', 500, { text: 'body' }), undefined);
    const snapshot = new HistorySnapshot(root);
    assert.equal(
      snapshot.context.indexed('', 500, { text: 'body' }),
      undefined,
      'index never blocks first query',
    );
    await snapshot.prepareIndex();
    for (const authorQueries of [
      ['me'],
      ['test'],
      ['other@example.com'],
      ['test other'],
      ['missing'],
      ['Test', 'Other'],
    ]) {
      for (const text of ['', 'body needle', '中文正文']) {
        for (const matchCase of [false, true]) {
          const filters = { authorQueries, text, matchCase };
          const indexed = await snapshot.context.indexed('', 0, filters);
          assert.notEqual(indexed, undefined);
          assert.deepEqual(indexed, await log(root, '', 0, filters), JSON.stringify(filters));
        }
      }
    }
    assert.deepEqual(
      await loadHistoryPage(root, '', 1, { text: 'body' }, undefined, 500, snapshot.context),
      await loadHistoryPage(root, '', 1, { text: 'body' }),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('oversized or unavailable text indexes fall back without publishing incomplete results', async () => {
  const client = require('../out/extension/git/client');
  const original = client.git;
  const { readHistoryIndex } = require('../out/extension/git/history-index');
  try {
    client.git = async () => 'row\0\n'.repeat(100_001);
    assert.equal(await readHistoryIndex('/fixture'), undefined);
    client.git = async () => {
      throw Error('stdout maxBuffer length exceeded');
    };
    const snapshot = new HistorySnapshot('/fixture');
    await snapshot.prepareIndex();
    assert.equal(snapshot.context.indexed('', 500, { text: 'body' }), undefined);
  } finally {
    client.git = original;
  }
});
