import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const {
  git,
  log,
  refs,
  branchComparison,
  branchFiles,
  commitComparison,
  commitFiles,
  branchBatchAction,
} = require('../out/extension/git/index');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-branches-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Fixture']);
  await git(root, ['config', 'user.email', 'fixture@example.com']);
  return root;
}
async function commit(root, message) {
  await git(root, ['add', '.']);
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
  return (await git(root, ['rev-parse', 'HEAD'])).trim();
}
test('branch comparison uses two directional ranges and file diff uses the two branch tips', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'shared.txt'), 'base\n');
    await fs.writeFile(path.join(root, '中文 old.txt'), 'rename me\n');
    await commit(root, 'base');
    await git(root, ['branch', 'right']);
    await git(root, ['switch', '-c', 'left']);
    await fs.writeFile(path.join(root, 'shared.txt'), 'left\n');
    await fs.writeFile(path.join(root, 'left.txt'), 'left');
    await commit(root, 'left only');
    await git(root, ['switch', 'right']);
    await fs.writeFile(path.join(root, 'shared.txt'), 'right\n');
    await fs.writeFile(path.join(root, 'right.txt'), 'right');
    await git(root, ['mv', '中文 old.txt', '中文 new.txt']);
    await commit(root, 'right only');
    const pair = await branchComparison(root, ['refs/heads/left', 'refs/heads/right']);
    assert.deepEqual(
      (await log(root, `${pair[1].ref}..${pair[0].ref}`)).map((c) => c.subject),
      ['left only'],
    );
    assert.deepEqual(
      (await log(root, `${pair[0].ref}..${pair[1].ref}`)).map((c) => c.subject),
      ['right only'],
    );
    const result = await branchFiles(
      root,
      pair.map((b) => b.ref),
    );
    assert.deepEqual(
      result.files.map((f) => [f.status, f.path]).sort(),
      [
        ['D', 'left.txt'],
        ['A', 'right.txt'],
        ['M', 'shared.txt'],
        ['R', '中文 new.txt'],
      ].sort(),
    );
    const shared = result.files.find((f) => f.path === 'shared.txt'),
      rename = result.files.find((f) => f.status === 'R');
    assert.equal(
      await git(root, ['show', `${shared.before.hash}:${shared.before.path}`]),
      'left\n',
    );
    assert.equal(await git(root, ['show', `${shared.after.hash}:${shared.after.path}`]), 'right\n');
    assert.equal(rename.before.path, '中文 old.txt');
    assert.equal(rename.after.path, '中文 new.txt');
    await fs.writeFile(path.join(root, 'shared.txt'), 'later\n');
    await commit(root, 'later');
    assert.equal(
      await git(root, ['show', `${shared.after.hash}:${shared.after.path}`]),
      'right\n',
      'opened comparisons retain their snapshot endpoints',
    );
    await assert.rejects(branchComparison(root, ['HEAD', 'refs/heads/right']), /different/);
    await assert.rejects(
      branchComparison(root, ['refs/heads/left', 'refs/heads/missing']),
      /no longer/,
    );
    await git(root, ['tag', 'tag']);
    assert.equal(
      (await branchComparison(root, ['refs/tags/tag', 'refs/heads/left']))[0].name,
      'tag',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('historical commit comparison uses fixed endpoints and includes changes between non-adjacent selections', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'old.txt'), 'original\n');
    const before = await commit(root, 'before');
    await fs.writeFile(path.join(root, 'middle.txt'), 'from unselected commit\n');
    await commit(root, 'middle');
    await git(root, ['mv', 'old.txt', 'new.txt']);
    const after = await commit(root, 'after');
    const pair = await commitComparison(root, [after, before]);
    assert.deepEqual(
      (await log(root, `${pair[1].ref}..${pair[0].ref}`)).map((c) => c.subject),
      ['after', 'middle'],
    );
    assert.equal((await log(root, `${pair[0].ref}..${pair[1].ref}`)).length, 0);
    const result = await commitFiles(root, [before, after]);
    assert.deepEqual(
      result.files.map((f) => [f.status, f.path]),
      [
        ['A', 'middle.txt'],
        ['R', 'new.txt'],
      ],
    );
    assert.equal(result.files[1].before.path, 'old.txt');
    await fs.writeFile(path.join(root, 'middle.txt'), 'later\n');
    await commit(root, 'later');
    const middle = result.files[0].after;
    assert.equal(
      await git(root, ['show', `${middle.hash}:${middle.path}`]),
      'from unselected commit\n',
    );
    assert.deepEqual((await commitFiles(root, [before, after])).files, result.files);
    await assert.rejects(commitComparison(root, [before, before]), /different commits/);
    await assert.rejects(commitComparison(root, [before]), /two/);
    await assert.rejects(commitComparison(root, ['HEAD', before]), /Invalid commit/);
    await assert.rejects(commitComparison(root, ['0'.repeat(40), before]));
    const blob = (await git(root, ['rev-parse', `${before}:old.txt`])).trim();
    await assert.rejects(commitComparison(root, [blob, before]));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('batch delete preflights every branch, including current and unmerged branches', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'base'), 'base');
    await commit(root, 'base');
    await git(root, ['branch', 'one']);
    await git(root, ['branch', 'two']);
    await assert.rejects(
      branchBatchAction(root, ['refs/heads/one', 'refs/heads/main'], 'delete'),
      /checked-out/,
    );
    assert.ok((await refs(root)).some((b) => b.name === 'one'));
    await git(root, ['switch', '-c', 'unmerged']);
    await fs.writeFile(path.join(root, 'extra'), 'extra');
    await commit(root, 'extra');
    await git(root, ['switch', 'main']);
    await assert.rejects(
      branchBatchAction(root, ['refs/heads/one', 'refs/heads/unmerged'], 'delete'),
      /not merged/,
    );
    assert.ok((await refs(root)).some((b) => b.name === 'one'));
    assert.deepEqual(
      await branchBatchAction(root, ['refs/heads/one', 'refs/heads/two'], 'delete'),
      ['one', 'two'],
    );
    assert.ok(!(await refs(root)).some((b) => ['one', 'two'].includes(b.name)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('batch update fast-forwards two tracking branches; batch remote deletion removes both', async () => {
  const root = await fixture(),
    remote = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-remote-'));
  try {
    await git(remote, ['init', '--bare']);
    await git(root, ['remote', 'add', 'origin', remote]);
    await fs.writeFile(path.join(root, 'base'), 'base');
    const before = await commit(root, 'base');
    for (const name of ['one', 'two']) {
      await git(root, ['branch', name]);
      await git(root, ['push', '-u', 'origin', name]);
    }
    await fs.writeFile(path.join(root, 'new'), 'new');
    const after = await commit(root, 'new');
    await git(root, ['push', 'origin', 'HEAD:one', 'HEAD:two']);
    assert.equal((await git(root, ['rev-parse', 'one'])).trim(), before);
    await assert.rejects(
      branchBatchAction(root, ['refs/heads/one', 'refs/heads/main'], 'update'),
      /Tracking/,
    );
    assert.equal(
      (await git(root, ['rev-parse', 'one'])).trim(),
      before,
      'invalid later branch prevents earlier update',
    );
    assert.deepEqual(
      await branchBatchAction(root, ['refs/heads/one', 'refs/heads/two'], 'update'),
      ['one', 'two'],
    );
    for (const name of ['one', 'two'])
      assert.equal((await git(root, ['rev-parse', name])).trim(), after);
    await assert.rejects(
      branchBatchAction(root, ['refs/remotes/origin/one', 'refs/remotes/origin/two'], 'update'),
      /Tracking/,
    );
    assert.deepEqual(
      await branchBatchAction(
        root,
        ['refs/remotes/origin/one', 'refs/remotes/origin/two'],
        'delete',
      ),
      ['origin/one', 'origin/two'],
    );
    assert.equal((await git(remote, ['for-each-ref', '--format=%(refname)'])).trim(), '');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(remote, { recursive: true, force: true });
  }
});

test('lightweight and annotated tags compare with branches and tags using peeled commit snapshots', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'file.txt'), 'before\n');
    const before = await commit(root, 'before');
    await git(root, ['tag', 'light']);
    await fs.writeFile(path.join(root, 'file.txt'), 'after\n');
    const after = await commit(root, 'after');
    await git(root, ['-c', 'tag.gpgSign=false', 'tag', '-a', 'annotated', '-m', 'release']);
    for (const values of [
      ['refs/tags/light', 'refs/heads/main'],
      ['refs/tags/light', 'refs/tags/annotated'],
    ]) {
      const pair = await branchComparison(root, values);
      assert.deepEqual(
        pair.map((b) => b.hash),
        [before, after],
      );
      assert.deepEqual(
        (await log(root, `${pair[0].hash}..${pair[1].hash}`)).map((c) => c.subject),
        ['after'],
      );
      assert.equal((await log(root, `${pair[1].hash}..${pair[0].hash}`)).length, 0);
      for (const refs of [values, [...values].reverse()]) {
        const result = await branchFiles(root, refs);
        assert.equal(result.files.length, 1);
        const file = result.files[0];
        assert.equal(file.path, 'file.txt');
        assert.equal(
          await git(root, ['show', `${file.before.hash}:file.txt`]),
          refs[0] === values[0] ? 'before\n' : 'after\n',
        );
        assert.equal(
          await git(root, ['show', `${file.after.hash}:file.txt`]),
          refs[0] === values[0] ? 'after\n' : 'before\n',
        );
      }
    }
    const identical = await branchFiles(root, ['refs/tags/annotated', 'refs/heads/main']);
    assert.equal(identical.files.length, 0);
    const blob = (await git(root, ['rev-parse', 'HEAD:file.txt'])).trim();
    await git(root, ['tag', 'blob', blob]);
    await assert.rejects(branchComparison(root, ['refs/tags/blob', 'refs/heads/main']));
    assert.equal((await git(root, ['symbolic-ref', 'HEAD'])).trim(), 'refs/heads/main');
    assert.equal((await git(root, ['status', '--porcelain'])).trim(), '');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
