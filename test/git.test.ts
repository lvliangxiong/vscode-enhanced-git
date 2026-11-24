import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { git, refs, log, details } = require('../out/extension/git/index');
test('reads roots, unicode paths, branches, merges and deletion changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-test-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test Author']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(root, '中文 file.txt'), 'one');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'initial']);
    let history = await log(root);
    assert.equal(history[0].subject, 'initial');
    assert.equal((await details(root, history[0].hash)).files[0].path, '中文 file.txt');
    await git(root, ['checkout', '-b', 'feature']);
    await fs.writeFile(path.join(root, 'feature.txt'), 'feature');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'feature']);
    await git(root, ['checkout', 'main']);
    await fs.writeFile(path.join(root, 'main.txt'), 'main');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'main']);
    await git(root, ['merge', '--no-ff', 'feature', '-m', 'merge']);
    history = await log(root);
    assert.equal(history[0].parents.length, 2);
    assert.equal((await details(root, history[0].hash)).files[0].path, 'feature.txt');
    const firstParent = await log(root, 'HEAD', 300, { firstParent: true });
    assert.deepEqual(
      firstParent.map((c) => c.subject),
      ['merge', 'main', 'initial'],
    );
    const noMerges = await log(root, 'HEAD', 300, { firstParent: true, hideMerges: true });
    assert.deepEqual(
      noMerges.map((c) => c.subject),
      ['main', 'initial'],
    );
    const topo = await log(root, 'HEAD', 300, { sort: 'topological' });
    assert.deepEqual(
      topo.map((c) => c.hash),
      (await git(root, ['log', '--topo-order', '--format=%H', 'HEAD'])).trim().split('\n'),
    );
    const projected = await require('../out/extension/git/index').projectGraph(root, firstParent, {
      firstParent: true,
    });
    assert.ok(projected.every((c) => c.graphParents.length <= 1));
    assert.equal((await refs(root)).find((b) => b.current).name, 'main');
    assert.ok((await log(root, 'refs/heads/feature')).every((c) => c.subject !== 'merge'));
    await git(root, ['rm', '中文 file.txt']);
    await git(root, ['commit', '-m', 'delete']);
    assert.equal((await details(root, (await log(root))[0].hash)).files[0].status, 'D');
    await assert.rejects(log(root, '--help'));
    await assert.rejects(details(root, '--help'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('server filters and safe local branch actions with a local bare remote', async () => {
  const { branchAction, patch } = require('../out/extension/git/index');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-actions-'));
  const root = path.join(base, 'repo'),
    remote = path.join(base, 'remote.git');
  await fs.mkdir(root);
  await fs.mkdir(remote);
  try {
    await git(remote, ['init', '--bare']);
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Alice']);
    await git(root, ['config', 'user.email', 'alice@example.com']);
    await fs.writeFile(path.join(root, 'one.txt'), 'before\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'first', '-m', 'search in full body']);
    const first = (await log(root))[0];
    assert.equal((await log(root, '', 300, { text: 'full body' })).length, 1);
    assert.equal((await log(root, '', 300, { text: first.hash.slice(0, 8) }))[0].hash, first.hash);
    assert.equal((await log(root, '', 300, { author: 'alice@example.com' })).length, 1);
    assert.equal((await log(root, '', 300, { paths: ['missing'] })).length, 0);
    await git(root, ['branch', 'topic']);
    await branchAction(root, 'refs/heads/topic', 'rename', { name: 'renamed' });
    await branchAction(root, 'refs/heads/renamed', 'checkout');
    await fs.writeFile(path.join(root, 'one.txt'), 'after\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'second']);
    const second = (await log(root, 'refs/heads/renamed'))[0];
    assert.match(await patch(root, second.hash, 'one.txt'), /\+after/);
    await assert.rejects(branchAction(root, 'refs/heads/renamed', 'delete'));
    await git(root, ['remote', 'add', 'origin', remote]);
    await branchAction(root, 'refs/heads/renamed', 'push', { remote: 'origin' });
    assert.match((await refs(root)).find((b) => b.name === 'renamed').upstream, /origin\/renamed/);
    await branchAction(root, 'refs/heads/main', 'checkout');
    await assert.rejects(branchAction(root, 'refs/heads/renamed', 'delete'));
    await git(root, ['merge', 'renamed']);
    await branchAction(root, 'refs/heads/renamed', 'delete');
    await branchAction(root, 'refs/remotes/origin/renamed', 'checkout', { name: 'tracking' });
    await branchAction(root, 'refs/heads/tracking', 'update');
    assert.equal((await refs(root)).find((b) => b.current).name, 'tracking');
    await git(root, ['tag', 'fixture-tag']);
    await branchAction(root, 'refs/tags/fixture-tag', 'push', { remote: 'origin' });
    await branchAction(root, 'refs/tags/fixture-tag', 'delete');
    assert.ok(!(await refs(root)).some((b) => b.name === 'fixture-tag'));
    await branchAction(root, 'refs/remotes/origin/renamed', 'delete');
    assert.ok(!(await refs(root)).some((b) => b.ref === 'refs/remotes/origin/renamed'));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
test('non-contiguous selections compose same-file changes and cancel additions/deletions', async () => {
  const { selectionDetails, selectionPatch, projectGraph } = require('../out/extension/git/index');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-selection-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(root, 'file.txt'), 'original\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'initial']);
    await fs.writeFile(path.join(root, 'file.txt'), 'first\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'first']);
    const first = (await log(root))[0].hash;
    await fs.writeFile(path.join(root, 'other.txt'), 'unselected\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'unselected']);
    await fs.writeFile(path.join(root, 'file.txt'), 'latest\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'latest']);
    const latest = (await log(root))[0].hash;
    const projected = await projectGraph(
      root,
      (await log(root)).filter((c) => [latest, first].includes(c.hash)),
    );
    assert.deepEqual(projected[0].graphParents, [first]);
    const result = await selectionDetails(root, [latest, first]);
    assert.equal(result.items.length, 2);
    assert.equal(result.files.length, 1);
    const diff = await selectionPatch(root, result.files[0]);
    assert.match(diff, /-original/);
    assert.match(diff, /\+latest/);
    assert.doesNotMatch(diff, /unselected/);
    await fs.writeFile(path.join(root, 'new.txt'), 'new\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'add']);
    const added = (await log(root))[0].hash;
    const addition = (await selectionDetails(root, [added])).files[0];
    assert.match(await selectionPatch(root, addition), /\+new/);
    await git(root, ['rm', 'new.txt']);
    await git(root, ['commit', '-m', 'delete']);
    const removed = (await log(root))[0].hash;
    assert.equal((await selectionDetails(root, [removed, added])).files.length, 0);
    await git(root, ['mv', 'file.txt', 'renamed.txt']);
    await git(root, ['commit', '-m', 'rename']);
    const rename = (await log(root))[0].hash;
    const renamed = (await selectionDetails(root, [rename])).files[0];
    assert.equal(renamed.status, 'R');
    assert.equal(renamed.before.path, 'file.txt');
    assert.equal(renamed.after.path, 'renamed.txt');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('combines branch and author multi-select with literal, regex and date filters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-filters-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Alice']);
    await git(root, ['config', 'user.email', 'alice+test@example.com']);
    await fs.writeFile(path.join(root, 'base.txt'), 'base');
    await git(root, ['add', '.']);
    await git(root, [
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Fix [API].',
      '--date=2020-01-01T12:00:00Z',
    ]);
    const base = (await log(root))[0];
    await git(root, ['checkout', '-b', 'topic']);
    await fs.writeFile(path.join(root, 'topic.txt'), 'topic');
    await git(root, ['add', '.']);
    await git(root, [
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--author=Bob <bob@example.com>',
      '-m',
      'Feature',
    ]);
    const topic = (await log(root, 'refs/heads/topic'))[0];
    await git(root, ['checkout', 'main']);
    await fs.writeFile(path.join(root, 'main.txt'), 'main');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'Maintenance']);
    assert.equal((await log(root, ['refs/heads/main', 'refs/heads/topic'])).length, 3);
    assert.deepEqual(
      (await log(root, [], 300, { authors: ['bob@example.com'] })).map((c) => c.hash),
      [topic.hash],
    );
    assert.equal(
      (await log(root, [], 300, { authors: ['alice+test@example.com', 'bob@example.com'] })).length,
      3,
    );
    assert.equal((await log(root, [], 300, { authors: ['alice.test@example.com'] })).length, 0);
    assert.deepEqual(
      (await log(root, [], 300, { text: '[API].' })).map((c) => c.hash),
      [base.hash],
    );
    assert.equal((await log(root, [], 300, { text: 'fix', matchCase: true })).length, 0);
    assert.equal((await log(root, [], 300, { text: 'fix' })).length, 1);
    assert.equal((await log(root, [], 300, { text: '^(Fix|Feature)', regex: true })).length, 2);
    assert.equal(
      (
        await log(root, [], 300, {
          authors: ['bob@example.com'],
          paths: ['topic.txt'],
          sinceHours: 24,
        })
      ).length,
      1,
    );
    assert.equal((await log(root, [], 300, { until: '2000-01-01' })).length, 0);
    await assert.rejects(log(root, ['--all']));
    await assert.rejects(log(root, [], 300, { sinceHours: -1 }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('graph jump loads through a parent past the old limit and preserves matching filters', async () => {
  const { historyThrough, projectGraph } = require('../out/extension/git/index');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-parent-'));
  try {
    await git(root, ['init', '-b', 'main']);
    let stream = '';
    for (let i = 0; i < 3105; i++)
      stream += `commit refs/heads/main\nmark :${i + 1}\ncommitter Test <test@example.com> ${1600000000 + i} +0000\ndata ${Buffer.byteLength('commit ' + i)}\ncommit ${i}\n${i ? 'from :' + i + '\n' : ''}\n`;
    const imported = require('node:child_process').spawnSync(
      'git',
      ['-C', root, 'fast-import', '--quiet'],
      { input: stream, encoding: 'utf8' },
    );
    assert.equal(imported.status, 0, imported.stderr);
    const full = await log(root, '', 4000),
      target = full[3050].hash;
    const result = await historyThrough(
      root,
      'refs/heads/main',
      500,
      { author: 'test@example.com' },
      target,
      500,
    );
    assert.equal(result.history.length, 3105);
    assert.equal(result.reset, false);
    assert.equal(result.history[3050].hash, target);
    const initial = await log(root, '', 500);
    const projected = await projectGraph(root, initial, { hasMore: true });
    assert.deepEqual(projected.at(-1).graphUnloadedParents, [full[500].hash]);
    const reset = await historyThrough(
      root,
      'refs/heads/main',
      500,
      { text: 'commit 3104' },
      target,
      500,
    );
    assert.equal(reset.reset, true);
    assert.equal(reset.ref, 'refs/heads/main');
    assert.ok(reset.history.some((c) => c.hash === target));
    await assert.rejects(historyThrough(root, '', 500, {}, 'f'.repeat(40)), /unavailable/);
    await assert.rejects(historyThrough(root, '', 500, {}, '--help'), /Invalid commit/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
