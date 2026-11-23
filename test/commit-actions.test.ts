import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { git, log } = require('../out/extension/git/index');
const { revisionNumbers, createRef, createPatch } = require('../out/extension/git/commit-actions');

test('copy revision numbers matches Rebased oldest-first, space-separated full hashes', () => {
  assert.equal(
    revisionNumbers(['a'.repeat(40), 'b'.repeat(40)]),
    'b'.repeat(40) + ' ' + 'a'.repeat(40),
  );
  assert.throws(() => revisionNumbers(['--all']));
});

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-commit-actions-'));
  const write = (name, data) => fs.writeFile(path.join(root, name), data);
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
    await write('base.txt', 'original\n');
    const base = await commit('base');
    await run({ root, write, commit, base });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('new branches and lightweight tags target the selected revision without implicit overwrite', () =>
  fixture(async ({ root, write, commit, base }) => {
    await write('base.txt', 'new\n');
    const head = await commit('new');
    await createRef(root, base, 'branch', { name: 'topic', checkout: false });
    assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), head);
    assert.equal((await git(root, ['rev-parse', 'topic'])).trim(), base);
    await assert.rejects(createRef(root, head, 'branch', { name: 'topic' }));
    await createRef(root, base, 'branch', { name: 'checkout-topic', checkout: true });
    assert.equal((await git(root, ['symbolic-ref', '--short', 'HEAD'])).trim(), 'checkout-topic');
    assert.equal(await fs.readFile(path.join(root, 'base.txt'), 'utf8'), 'original\n');
    await createRef(root, base, 'tag', { name: 'light' });
    assert.equal((await git(root, ['cat-file', '-t', 'light'])).trim(), 'commit');
    await assert.rejects(createRef(root, head, 'tag', { name: 'light' }));
    for (const name of ['--help', '../bad', 'a b', 'bad\0name'])
      await assert.rejects(createRef(root, base, 'tag', { name }));
    await assert.rejects(createRef(root, base, 'branch', { name: '@{-1}' }));
  }));

test('patch exports composed non-adjacent changes, binary data, modes and renames without touching the source index', () =>
  fixture(async ({ root, write, commit, base }) => {
    await write('base.txt', 'first\n');
    await write('binary.bin', Buffer.from([0, 255, 1, 2]));
    const first = await commit('first');
    await write('unselected.txt', 'unselected\n');
    await commit('unselected');
    await git(root, ['mv', 'base.txt', '中文 renamed.txt']);
    await fs.chmod(path.join(root, '中文 renamed.txt'), 0o755);
    await write('binary.bin', Buffer.from([0, 254, 10, 20]));
    const last = await commit('last');
    await write('dirty.txt', 'staged data');
    await git(root, ['add', 'dirty.txt']);
    const indexBefore = await fs.readFile(path.join(root, '.git/index'));
    const patch = await createPatch(root, [last, first]);
    assert.deepEqual(await fs.readFile(path.join(root, '.git/index')), indexBefore);
    assert.doesNotMatch(patch.toString(), /unselected|dirty/);
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-patch-apply-'));
    try {
      await git(target, ['clone', '--no-local', root, '.']);
      await git(target, ['checkout', '--detach', base]);
      const patchPath = path.join(target, 'test.patch');
      await fs.writeFile(patchPath, patch);
      await git(target, ['apply', '--index', patchPath]);
      assert.equal(await fs.readFile(path.join(target, '中文 renamed.txt'), 'utf8'), 'first\n');
      assert.deepEqual(
        await fs.readFile(path.join(target, 'binary.bin')),
        Buffer.from([0, 254, 10, 20]),
      );
      assert.ok((await fs.stat(path.join(target, '中文 renamed.txt'))).mode & 0o111);
      await assert.rejects(fs.stat(path.join(target, 'base.txt')));
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  }));

test('patch does not reintroduce inherited merge changes', () =>
  fixture(async ({ root, write, commit }) => {
    await git(root, ['checkout', '-b', 'topic']);
    await write('topic.txt', 'topic\n');
    const topic = await commit('topic');
    await git(root, ['checkout', 'main']);
    await write('main.txt', 'main\n');
    await commit('main');
    await git(root, ['merge', '--no-ff', 'topic', '-m', 'merge']);
    const merge = (await log(root))[0].hash;
    const patch = await createPatch(root, [merge, topic]);
    assert.equal((patch.toString().match(/diff --git /g) || []).length, 1);
    assert.match(patch.toString(), /topic.txt/);
    await assert.rejects(createPatch(root, [merge]), /no changes/);
  }));
