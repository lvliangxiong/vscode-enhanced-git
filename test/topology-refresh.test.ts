import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const client = require('../out/extension/git/client');
const {
  readRepositoryTopology,
  joinRecentTopology,
} = require('../out/extension/git/topology-reader');
const { createHistoryCache } = require('../out/extension/git/history-cache');
const { createHistoryIndexStore } = require('../out/extension/git/history-index-store');
const { createPathIndexStore } = require('../out/extension/git/path-index-store');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-topology-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await client.git(root, ['init', '-b', 'main']);
  await client.git(root, ['config', 'user.name', 'Test']);
  await client.git(root, ['config', 'user.email', 'test@example.com']);
  return root;
}
async function append(root: string, branch: string, count: number, start: number, parent?: string) {
  parent ??= await client.git(root, ['rev-parse', '--verify', branch]).then(
    (s) => s.trim(),
    () => undefined,
  );
  const input =
    Array.from({ length: count }, (_, i) => {
      const message = `commit ${start + i}`;
      return `commit refs/heads/${branch}\ncommitter Test <test@example.com> ${1700000000 + start + i} +0000\ndata ${message.length}\n${message}\n${i === 0 && parent ? `from ${parent}\n` : ''}\n`;
    }).join('') + 'done\n';
  await client.git(root, ['fast-import', '--quiet'], { input });
}
async function assertGit(root: string, snapshot) {
  const raw = await client.git(root, [
    'log',
    '--all',
    '--date-order',
    '--decorate=full',
    '--format=%H %P%x00%D',
    '--',
  ]);
  const expected = raw
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ids, decorations] = line.split('\0');
      const [hash, ...parents] = ids.trim().split(' ');
      return { hash, parents, decorations };
    });
  assert.deepEqual(snapshot.commits, expected);
}

test('graph refresh joins 500/2500 recent rows and falls back for a longer disconnected block', async (t) => {
  const root = await fixture(t);
  await append(root, 'main', 4000, 0);
  const initial = await readRepositoryTopology(root);
  assert.equal(initial.mode, 'full');
  await append(root, 'main', 1, 4000);
  const next = await readRepositoryTopology(root);
  assert.equal(next.mode, 'joined');
  assert.equal(next.readCount, 500);
  assert.equal(initial.commits.length, 4000, 'published graph stays immutable');
  await assertGit(root, next);
  await append(root, 'main', 600, 4001);
  const expanded = await readRepositoryTopology(root);
  assert.equal(expanded.mode, 'joined');
  assert.equal(expanded.readCount, 3000);
  await assertGit(root, expanded);
  await append(root, 'main', 2600, 4601);
  const full = await readRepositoryTopology(root);
  assert.equal(full.mode, 'full');
  await assertGit(root, full);
});

test('joined graph updates old ref decorations, prunes deleted/rewritten history and handles merges', async (t) => {
  const root = await fixture(t);
  await append(root, 'main', 1200, 0);
  await readRepositoryTopology(root);
  const ancestor = (await client.git(root, ['rev-parse', 'main~900'])).trim();
  await client.git(root, ['branch', 'old-tip', ancestor]);
  await client.git(root, [
    '-c',
    'tag.gpgSign=false',
    'tag',
    '-a',
    'old-tag',
    ancestor,
    '-m',
    'old tag',
  ]);
  await assertGit(root, await readRepositoryTopology(root));
  await append(root, 'topic', 4, 1400, ancestor);
  await assertGit(root, await readRepositoryTopology(root));
  await client.git(root, ['branch', '-D', 'topic']);
  await client.git(root, ['tag', '-d', 'old-tag']);
  await client.git(root, ['update-ref', 'refs/heads/main', 'main~10']);
  await assertGit(root, await readRepositoryTopology(root));
  await append(root, 'topic', 4, 1500, ancestor);
  await readRepositoryTopology(root);
  const merged = (
    await client.git(
      root,
      ['commit-tree', 'main^{tree}', '-p', 'main', '-p', 'topic', '-m', 'merge'],
      {
        env: { GIT_COMMITTER_DATE: '1700001600 +0000', GIT_AUTHOR_DATE: '1700001600 +0000' },
      },
    )
  ).trim();
  await client.git(root, ['update-ref', 'refs/heads/main', merged]);
  await assertGit(root, await readRepositoryTopology(root));
  await client.git(root, ['checkout', '--detach', ancestor]);
  await assertGit(root, await readRepositoryTopology(root));
  const orphan = (
    await client.git(root, ['commit-tree', 'HEAD^{tree}', '-m', 'replacement'])
  ).trim();
  await client.git(root, ['replace', ancestor, orphan]);
  const replaced = await readRepositoryTopology(root);
  assert.equal(replaced.mode, 'full');
  await assertGit(root, replaced);
});

test('missing old-dated ref history is not hidden by a complete-looking recent block', async (t) => {
  const root = await fixture(t);
  await append(root, 'main', 3000, 5000);
  await readRepositoryTopology(root);
  await append(root, 'ancient', 10, 0);
  const result = await readRepositoryTopology(root);
  assert.equal(result.mode, 'full');
  await assertGit(root, result);
});

test('join refuses missing parents, changed ancestry and cycles', async () => {
  const root = { hash: 'root', parents: [] };
  assert.equal(
    await joinRecentTopology([root], [{ hash: 'new', parents: ['missing'] }], [{ hash: 'new' }]),
    undefined,
  );
  assert.equal(
    await joinRecentTopology([root], [{ hash: 'root', parents: ['new'] }], [root]),
    undefined,
  );
  // A malicious or corrupt cache must not be published as a complete DAG.
  assert.equal(
    await joinRecentTopology(
      [
        { hash: 'a', parents: ['b'] },
        { hash: 'b', parents: ['a'] },
      ],
      [],
      [{ hash: 'a' }],
    ),
    undefined,
  );
});

test('parallel histories with equal dates and clock skew retain Git ordering after ref moves', async (t) => {
  const root = await fixture(t);
  await append(root, 'main', 800, 0);
  const base = (await client.git(root, ['rev-parse', 'main~799'])).trim();
  for (const branch of ['a', 'b', 'c', 'd']) await append(root, branch, 250, 1, base);
  await readRepositoryTopology(root);
  await client.git(root, ['branch', '-m', 'a', 'z']);
  await assertGit(root, await readRepositoryTopology(root));
  await append(root, 'z', 1, 50);
  await assertGit(root, await readRepositoryTopology(root));
  await client.git(root, ['branch', '-D', 'c']);
  await assertGit(root, await readRepositoryTopology(root));
});

test('shallow boundary changes reload ancestry; unchanged shallow boundaries can join', async (t) => {
  const root = await fixture(t);
  await append(root, 'main', 900, 0);
  const clone = path.join(root, 'shallow-clone');
  await client.git(root, ['clone', '--depth=700', `file://${root}`, clone]);
  await readRepositoryTopology(clone);
  await client.git(clone, ['branch', 'new-name']);
  const joined = await readRepositoryTopology(clone);
  assert.equal(joined.mode, 'joined');
  await assertGit(clone, joined);
  await client.git(clone, ['fetch', '--deepen=100']);
  const deepened = await readRepositoryTopology(clone);
  assert.equal(deepened.mode, 'full');
  await assertGit(clone, deepened);
});

test('concurrent readers share a graph; racing refs are rejected and failed reads can retry', async (t) => {
  const root = await fixture(t);
  await append(root, 'main', 800, 0);
  const git = client.git;
  let reads = 0;
  let changeRefs = false;
  let fail = false;
  client.git = async (...args) => {
    if (args[1][0] === 'log' && args[1].includes('--date-order')) {
      reads++;
      if (fail) {
        fail = false;
        throw Error('fixture failure');
      }
      const raw = await git(...args);
      if (changeRefs) {
        changeRefs = false;
        await git(root, ['branch', 'racing-ref']);
      }
      return raw;
    }
    return git(...args);
  };
  t.after(() => {
    client.git = git;
  });
  const [one, two] = await Promise.all([
    readRepositoryTopology(root),
    readRepositoryTopology(root),
  ]);
  assert.strictEqual(one, two);
  assert.equal(reads, 1);
  await append(root, 'main', 1, 800);
  changeRefs = true;
  await assert.rejects(readRepositoryTopology(root), /Repository changed/);
  await assertGit(root, await readRepositoryTopology(root));
  await client.git(root, ['branch', 'retry-ref']);
  fail = true;
  await assert.rejects(readRepositoryTopology(root), /fixture failure/);
  await assertGit(root, await readRepositoryTopology(root));
});

test('manual Refresh replaces query data but retains text/path indexes and shares the incremental graph', async (t) => {
  const root = await fixture(t);
  await append(root, 'main', 800, 0);
  const git = client.git;
  const calls: string[][] = [];
  client.git = (...args) => {
    calls.push(args[1]);
    return git(...args);
  };
  t.after(() => {
    client.git = git;
  });
  const storage = path.join(root, 'cache');
  const store = createHistoryIndexStore(storage);
  const cache = createHistoryCache(store.load, createPathIndexStore(storage));
  const first = await cache.snapshot(root);
  await readRepositoryTopology(root);
  await first.prepareIndex();
  calls.length = 0;
  const manual = await cache.snapshot(root, 0, true);
  assert.notStrictEqual(manual, first);
  await manual.prepareIndex();
  assert.equal(
    calls.filter(
      (args) => args.includes('--split=replace') || args.some((arg) => arg.includes('%B')),
    ).length,
    0,
  );
  await append(root, 'main', 1, 800);
  calls.length = 0;
  await readRepositoryTopology(root);
  const changed = await cache.snapshot(root, 1, true);
  await changed.prepareIndex();
  const traversals = calls.filter(
    (args) => args[0] === 'log' && args.includes('--all') && args.includes('--date-order'),
  );
  assert.equal(traversals.length, 1, 'renderer and index share one recent-block read');
  assert.ok(traversals[0].includes('--max-count=500'));
  assert.equal(calls.filter((args) => args.includes('--split=replace')).length, 0);
  assert.equal(calls.filter((args) => args.includes('--split')).length, 1);
  assert.equal(
    calls.filter(
      (args) => args.includes('--no-walk=unsorted') && args.some((arg) => arg.includes('%B')),
    ).length,
    1,
  );
});
