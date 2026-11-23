import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import { refs, headLabel } from '../src/extension/git/refs';
import { branchComparison, branchFiles } from '../src/extension/git/comparison';

test('HEAD comparisons retain detached commits and label branch, lightweight tag, annotated tag and plain commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-head-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(root, 'file.txt'), 'base\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'base']);
    const base = (await git(root, ['rev-parse', 'HEAD'])).trim();
    assert.equal(await headLabel(root, await refs(root)), 'main');
    await git(root, ['checkout', '--detach']);
    await fs.writeFile(path.join(root, 'file.txt'), 'detached\n');
    await git(root, ['commit', '-am', 'detached']);
    const detached = (await git(root, ['rev-parse', 'HEAD'])).trim();
    assert.equal(await headLabel(root, await refs(root)), detached.slice(0, 8));
    const pair = await branchComparison(root, ['HEAD', 'refs/heads/main']);
    assert.deepEqual(
      pair.map((entry) => entry.hash),
      [detached, base],
    );
    assert.equal(pair[0].ref, 'HEAD');
    const diff = await branchFiles(root, ['HEAD', 'refs/heads/main']);
    assert.deepEqual(diff.files[0].before, { hash: detached, path: 'file.txt' });
    await git(root, ['tag', 'release-light']);
    assert.equal(await headLabel(root, await refs(root)), 'release-light');
    await git(root, ['tag', '-d', 'release-light']);
    await git(root, ['tag', '-a', 'release-annotated', '-m', 'release']);
    assert.equal(await headLabel(root, await refs(root)), 'release-annotated');
    assert.deepEqual(
      (await branchComparison(root, ['HEAD', 'refs/tags/release-annotated'])).map(
        (entry) => entry.hash,
      ),
      [detached, detached],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
