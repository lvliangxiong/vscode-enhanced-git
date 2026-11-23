import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const { git, refs, branchAction, branchBatchAction } = require('../out/extension/git/index');

async function commit(root: string, message: string) {
  await git(root, ['add', '.']);
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
  return (await git(root, ['rev-parse', 'HEAD'])).trim();
}
async function snapshot(root: string) {
  return Promise.all([
    git(root, ['symbolic-ref', 'HEAD']),
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['diff', '--cached']),
    git(root, ['diff']),
    git(root, ['status', '--porcelain']),
  ]);
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-update-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'main'),
    remote = path.join(dir, 'remote.git');
  const target = path.join(dir, '工作 tree\nquoted "path"');
  await fs.mkdir(root);
  await fs.mkdir(remote);
  await git(remote, ['init', '--bare']);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Fixture']);
  await git(root, ['config', 'user.email', 'fixture@example.com']);
  await git(root, ['config', 'merge.autoStash', 'false']);
  await fs.writeFile(path.join(root, 'shared'), 'base\n');
  await fs.writeFile(path.join(root, 'local'), 'base\n');
  const base = await commit(root, 'base');
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['branch', 'topic']);
  // Tracking branch deliberately has a different name.
  await git(root, ['push', '-u', 'origin', 'topic:upstream']);
  await git(root, ['worktree', 'add', target, 'topic']);
  await fs.writeFile(path.join(root, 'shared'), 'remote\n');
  const next = await commit(root, 'remote update');
  await git(root, ['push', 'origin', 'HEAD:upstream']);
  await fs.writeFile(path.join(root, 'local'), 'staged\n');
  await git(root, ['add', 'local']);
  await fs.writeFile(path.join(root, 'local'), 'unstaged\n');
  const before = await snapshot(root);
  return { root, remote, target, base, next, before };
}

test('Update fast-forwards an occupied branch without switching or changing either worktree’s unrelated edits', async (t) => {
  const { root, target, next, before } = await fixture(t);
  await fs.writeFile(path.join(target, 'local'), 'staged target\n');
  await git(target, ['add', 'local']);
  await fs.writeFile(path.join(target, 'local'), 'unstaged target\n');
  const dirty = (await snapshot(target)).slice(2);
  await branchAction(root, 'refs/heads/topic', 'update');
  assert.deepEqual(await snapshot(root), before);
  assert.deepEqual((await snapshot(target)).slice(2), dirty);
  assert.equal((await git(target, ['rev-parse', 'HEAD'])).trim(), next);
  assert.equal(await fs.readFile(path.join(target, 'shared'), 'utf8'), 'remote\n');
  assert.equal((await refs(root)).find((b) => b.name === 'topic').behind, 0);
  await branchAction(root, 'refs/heads/topic', 'update'); // already up to date
  assert.deepEqual(await snapshot(root), before);
});

test('Update reports the target worktree when local changes block fast-forward, without abort/reset', async (t) => {
  const { root, target, before, base } = await fixture(t);
  await fs.writeFile(path.join(target, 'shared'), 'user edit\n');
  const targetBefore = await snapshot(target);
  await assert.rejects(branchAction(root, 'refs/heads/topic', 'update'), (error: Error) => {
    assert.ok(error.message.includes(target));
    assert.match(error.message, /topic/);
    assert.match(error.message, /overwritten/);
    return true;
  });
  assert.deepEqual(await snapshot(target), targetBefore);
  assert.deepEqual(await snapshot(root), before);
  assert.equal((await git(target, ['rev-parse', 'HEAD'])).trim(), base);
  await assert.rejects(git(target, ['rev-parse', '--verify', 'MERGE_HEAD']));
});

test('Update rejects divergent worktree history without starting a merge', async (t) => {
  const { root, target, before } = await fixture(t);
  await fs.writeFile(path.join(target, 'local'), 'local commit\n');
  await commit(target, 'local commit');
  const targetBefore = await snapshot(target);
  await assert.rejects(branchAction(root, 'refs/heads/topic', 'update'), /fast-forward/);
  assert.deepEqual(await snapshot(target), targetBefore);
  assert.deepEqual(await snapshot(root), before);
  await assert.rejects(git(target, ['rev-parse', '--verify', 'MERGE_HEAD']));
});

test('Update leaves a pre-existing conflicted merge untouched', async (t) => {
  const { root, target, before, next } = await fixture(t);
  await fs.writeFile(path.join(target, 'shared'), 'conflicting commit\n');
  await commit(target, 'conflicting commit');
  await assert.rejects(git(target, ['merge', next]));
  const targetBefore = await snapshot(target);
  const mergeHead = await git(target, ['rev-parse', 'MERGE_HEAD']);
  const contents = await fs.readFile(path.join(target, 'shared'), 'utf8');
  await assert.rejects(branchAction(root, 'refs/heads/topic', 'update'));
  assert.deepEqual(await snapshot(target), targetBefore);
  assert.equal(await git(target, ['rev-parse', 'MERGE_HEAD']), mergeHead);
  assert.equal(await fs.readFile(path.join(target, 'shared'), 'utf8'), contents);
  assert.deepEqual(await snapshot(root), before);
});

test('batch Update accepts occupied targets; Delete still rejects them', async (t) => {
  const { root, target, next, before } = await fixture(t);
  await assert.rejects(branchBatchAction(root, ['refs/heads/topic'], 'delete'), /checked-out/);
  assert.deepEqual(await branchBatchAction(root, ['refs/heads/topic'], 'update'), ['topic']);
  assert.equal((await git(target, ['rev-parse', 'HEAD'])).trim(), next);
  assert.deepEqual(await snapshot(root), before);
});

test('unoccupied branch Update uses non-forced fetch and refuses rewinding an ahead branch', async (t) => {
  const { root, target, base, next, before } = await fixture(t);
  await git(root, ['worktree', 'remove', target]);
  await branchAction(root, 'refs/heads/topic', 'update');
  assert.equal((await git(root, ['rev-parse', 'topic'])).trim(), next);
  await git(root, ['push', '--force', 'origin', `${base}:upstream`]);
  await assert.rejects(branchAction(root, 'refs/heads/topic', 'update'), /non-fast-forward/);
  assert.equal((await git(root, ['rev-parse', 'topic'])).trim(), next);
  assert.deepEqual(await snapshot(root), before);
});

test('current branch Update keeps its checkout and updates its files', async (t) => {
  const { root, target, next } = await fixture(t);
  await branchAction(target, 'refs/heads/topic', 'update');
  assert.equal((await git(target, ['symbolic-ref', 'HEAD'])).trim(), 'refs/heads/topic');
  assert.equal((await git(target, ['rev-parse', 'HEAD'])).trim(), next);
  assert.equal(await fs.readFile(path.join(target, 'shared'), 'utf8'), 'remote\n');
});

for (const occupied of [true, false]) {
  test(`Update fetches an apparently up-to-date ${occupied ? 'occupied' : 'unoccupied'} branch`, async (t) => {
    const { root, remote, target, before } = await fixture(t);
    if (!occupied) await git(root, ['worktree', 'remove', target]);
    await branchBatchAction(root, ['refs/heads/topic'], 'update');
    const synchronized = await git(root, ['rev-parse', 'topic']);
    await branchBatchAction(root, ['refs/heads/topic'], 'update');
    assert.equal(await git(root, ['rev-parse', 'topic']), synchronized);

    // Another clone advances the server while this client's tracking ref still says behind=0.
    const producer = path.join(path.dirname(root), 'producer');
    await git(root, ['clone', '-b', 'upstream', remote, producer]);
    await git(producer, ['config', 'user.name', 'Producer']);
    await git(producer, ['config', 'user.email', 'producer@example.com']);
    await fs.writeFile(path.join(producer, 'fresh'), 'new server commit\n');
    const latest = await commit(producer, 'server advanced');
    await git(producer, ['push', 'origin', 'HEAD:upstream']);
    assert.equal((await refs(root)).find((branch) => branch.name === 'topic').behind, 0);

    await branchBatchAction(root, ['refs/heads/topic'], 'update');
    assert.equal((await git(root, ['rev-parse', 'topic'])).trim(), latest);
    assert.equal((await refs(root)).find((branch) => branch.name === 'topic').behind, 0);
    assert.deepEqual(await snapshot(root), before);
    if (occupied)
      assert.equal(await fs.readFile(path.join(target, 'fresh'), 'utf8'), 'new server commit\n');
  });
}
