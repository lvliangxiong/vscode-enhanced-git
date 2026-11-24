import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const client = require('../out/extension/git/client');
const {
  readSelectionItems,
  readSelectionStats,
  createSelectionReader,
} = require('../out/extension/git/selection-reader');
const { details } = require('../out/extension/git/changes');

test('batch details preserve roots, renames, binary and unusual paths across batch boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-batch-'));
  const git = client.git;
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'commit.gpgsign', 'false']);
    await fs.writeFile(path.join(root, 'old\n中文.txt'), 'old\n');
    await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'root\n\nmultiline message']);
    const first = (await git(root, ['rev-parse', 'HEAD'])).trim();
    await git(root, ['mv', 'old\n中文.txt', 'new\t中文.txt']);
    await git(root, ['commit', '-m', 'rename']);
    const rename = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const tree = (await git(root, ['rev-parse', 'HEAD^{tree}'])).trim();
    const hashes = [first, rename];
    for (let i = 0; i < 63; i++)
      hashes.push(
        (await git(root, ['commit-tree', tree, '-p', hashes.at(-1), '-m', `empty ${i}`])).trim(),
      );
    hashes.reverse();
    const calls: string[][] = [];
    client.git = (...args) => {
      calls.push(args[1]);
      return git(...args);
    };
    const result = await readSelectionItems(root, hashes);
    client.git = git;
    assert.equal(calls.length, 6, '65 commits need two batches of three processes');
    assert.deepEqual(
      result.map((item) => item.hash),
      hashes,
    );
    for (const item of [result[0], result[63], result[64]])
      assert.deepEqual(item, {
        hash: item.hash,
        ...(await details(root, item.hash, { mergeChanges: true })),
      });
    assert.equal(result[64].stats.binary, 1);
    assert.equal(result[63].files[0].status, 'R');
    const withoutStats = await readSelectionItems(root, hashes, false);
    assert.ok(withoutStats.every((item) => !('stats' in item)));
    const stats = await readSelectionStats(root, withoutStats);
    assert.deepEqual(
      withoutStats.map((item, i) => ({ ...item, stats: stats[i].stats })),
      result,
    );
    assert.deepEqual(await readSelectionItems(root, []), []);
    await assert.rejects(readSelectionItems(root, ['--all']), /Invalid commit/);
  } finally {
    client.git = git;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('selection reader reuses in-flight results, isolates roots/order and retries failures', async () => {
  let calls = 0;
  let fail = false;
  const read = createSelectionReader(async (root, hashes) => {
    calls++;
    if (fail) throw Error('failed');
    return { root, hashes };
  });
  const first = read('one', ['a', 'b']);
  assert.equal(read('one', ['a', 'b']), first);
  await first;
  assert.equal(read('one', ['a', 'b']), first);
  assert.equal(calls, 1);
  await read('one', ['b', 'a']);
  await read('two', ['b', 'a']);
  assert.equal(calls, 3);
  fail = true;
  await assert.rejects(read('three', ['a']));
  fail = false;
  assert.deepEqual(await read('three', ['a']), { root: 'three', hashes: ['a'] });
  assert.equal(calls, 5);
});
