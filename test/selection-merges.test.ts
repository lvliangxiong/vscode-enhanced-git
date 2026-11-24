import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {
  git,
  log,
  details,
  selectionDetails,
  selectionPatch,
} = require('../out/extension/git/index');

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-selection-merge-'));
  const write = (name, text) => fs.writeFile(path.join(root, name), text);
  const commit = async (message) => {
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', message]);
    return (await git(root, ['rev-parse', 'HEAD'])).trim();
  };
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'commit.gpgsign', 'false']);
    await write('base.txt', 'base\n');
    await commit('base');
    await run({ root, write, commit });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('multi-selection does not count inherited merge additions or renames twice', () =>
  fixture(async ({ root, write, commit }) => {
    await git(root, ['checkout', '-b', 'topic']);
    await write('中文 file.txt', 'added\n');
    await git(root, ['mv', 'base.txt', 'renamed.txt']);
    const added = await commit('topic additions and rename');
    await write('中文 file.txt', 'latest\n');
    const modified = await commit('topic modification');
    await git(root, ['checkout', 'main']);
    await write('main.txt', 'main\n');
    await commit('main');
    await git(root, ['merge', '--no-ff', 'topic', '-m', 'merge']);
    const merge = (await git(root, ['rev-parse', 'HEAD'])).trim();
    // The legacy explicit first-parent diff still contains the imported files.
    assert.equal((await details(root, merge)).files.length, 2);
    const hashes = (await log(root))
      .filter((c) => [merge, modified, added].includes(c.hash))
      .map((c) => c.hash);
    const result = await selectionDetails(root, hashes);
    assert.deepEqual(
      result.items,
      await Promise.all(
        hashes.map(async (hash) => ({
          hash,
          ...(await details(root, hash, { mergeChanges: true })),
        })),
      ),
    );
    assert.deepEqual(result.files.map((f) => f.path).sort(), ['renamed.txt', '中文 file.txt']);
    assert.equal(result.items.find((c) => c.hash === merge).files.length, 0);
    const addition = result.files.find((f) => f.path === '中文 file.txt');
    assert.equal(addition.before, null);
    assert.equal(addition.after.hash, modified);
    assert.match(await selectionPatch(root, addition), /\+latest/);
    const rename = result.files.find((f) => f.path === 'renamed.txt');
    assert.equal(rename.status, 'R');
    assert.equal(rename.before.path, 'base.txt');
    assert.deepEqual((await selectionDetails(root, [merge])).files, []);
  }));

test('merge conflict resolutions remain visible and compose with selected modifications', () =>
  fixture(async ({ root, write, commit }) => {
    await git(root, ['checkout', '-b', 'topic']);
    await write('base.txt', 'topic\n');
    await commit('topic');
    await git(root, ['checkout', 'main']);
    await write('base.txt', 'main\n');
    const main = await commit('main');
    await assert.rejects(git(root, ['merge', '--no-ff', 'topic', '-m', 'merge']));
    await write('base.txt', 'resolved\n');
    await write('resolution.txt', 'created during merge\n');
    const merge = await commit('resolved merge');
    const result = await selectionDetails(root, [merge, main]);
    assert.deepEqual(
      result.items,
      await Promise.all(
        [merge, main].map(async (hash) => ({
          hash,
          ...(await details(root, hash, { mergeChanges: true })),
        })),
      ),
    );
    assert.equal(result.files.length, 2);
    const file = result.files.find((f) => f.path === 'base.txt');
    const patch = await selectionPatch(root, file);
    assert.match(patch, /-base/);
    assert.match(patch, /\+resolved/);
    assert.equal(result.files.find((f) => f.path === 'resolution.txt').status, 'A');
  }));

test('automatic changes to the same file are combined changes even without a conflict', () =>
  fixture(async ({ root, write, commit }) => {
    await write('base.txt', 'first\n1\n2\n3\n4\n5\nlast\n');
    await commit('long base');
    await git(root, ['checkout', '-b', 'topic']);
    await write('base.txt', 'topic first\n1\n2\n3\n4\n5\nlast\n');
    await commit('topic');
    await git(root, ['checkout', 'main']);
    await write('base.txt', 'first\n1\n2\n3\n4\n5\nmain last\n');
    await commit('main');
    await git(root, ['merge', '--no-ff', 'topic', '-m', 'automatic merge']);
    const merge = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const result = await selectionDetails(root, [merge]);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].mergeParents.length, 2);
    assert.equal(result.parents.length, 2);
  }));

test('a conflict resolved to one parent has no combined change but retains both parent groups', () =>
  fixture(async ({ root, write, commit }) => {
    await git(root, ['checkout', '-b', 'topic']);
    await write('base.txt', 'topic\n');
    await commit('topic');
    await git(root, ['checkout', 'main']);
    await write('base.txt', 'main\n');
    await commit('main');
    await assert.rejects(git(root, ['merge', '--no-ff', 'topic', '-m', 'conflict']));
    await write('base.txt', 'main\n');
    const merge = await commit('keep main');
    const result = await selectionDetails(root, [merge]);
    assert.deepEqual(result.files, []);
    assert.deepEqual(
      result.parents.map((parent) => parent.files.length),
      [0, 1],
    );
    assert.equal(result.parents[1].files[0].status, 'M');
  }));

test('mixed added/modified merge status keeps absent parent revisions instead of reading nonexistent blobs', () =>
  fixture(async ({ root, write, commit }) => {
    await git(root, ['checkout', '-b', 'topic']);
    await write('new.txt', 'topic\n');
    await commit('addition');
    await git(root, ['checkout', 'main']);
    await write('other.txt', 'main\n');
    await commit('main');
    await git(root, ['merge', '--no-ff', '--no-commit', 'topic']);
    await write('new.txt', 'edited during merge\n');
    const merge = await commit('merge edit');
    const result = await selectionDetails(root, [merge]);
    assert.equal(result.files.length, 1);
    const file = result.files[0];
    assert.equal(file.status, 'M');
    assert.equal(file.before, null);
    assert.equal(file.mergeParents[0], null);
    assert.match(await selectionPatch(root, file), /edited during merge/);
  }));
