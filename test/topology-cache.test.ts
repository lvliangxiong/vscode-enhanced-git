import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const client = require('../out/extension/git/client');
const { log } = require('../out/extension/git/history');
const { projectGraph } = require('../out/extension/git/topology');

test('first block skips full graph; graph cache revalidates refs, HEAD and shallow boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-topology-'));
  const git = client.git;
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    for (let i = 0; i < 3; i++)
      await git(root, [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        `commit ${i}`,
      ]);
    const commits = await log(root, '', 2);
    let fullReads = 0;
    let recentReads = 0;
    client.git = (...args) => {
      if (args[1].includes('--format=%H %P%x00%D') && args[1].includes('--date-order')) {
        if (args[1].some((arg: string) => arg.startsWith('--max-count='))) recentReads++;
        else fullReads++;
      }
      return git(...args);
    };
    const first = await projectGraph(root, commits, { firstBlock: true, hasMore: true });
    assert.equal(fullReads, 0);
    assert.deepEqual(
      first.map((c) => c.hash),
      commits.map((c) => c.hash),
    );
    assert.ok(first[1].graphUnloadedParents.length);
    const complete = await projectGraph(root, commits);
    assert.deepEqual(await projectGraph(root, commits), complete);
    assert.equal(fullReads, 1);
    await git(root, ['branch', 'topic']);
    await projectGraph(root, commits);
    assert.equal(fullReads, 1, 'new refs reuse cached ancestry');
    assert.equal(recentReads, 1, 'new refs refresh the graph through a recent block');
    await git(root, ['checkout', 'topic']);
    await projectGraph(root, commits);
    assert.equal(fullReads, 1);
    assert.equal(recentReads, 2, 'same-commit checkout refreshes HEAD decoration');
    const shallow = path.join(root, 'shallow-clone');
    await git(root, ['clone', '--depth=1', `file://${root}`, shallow]);
    const recent = await log(shallow, '', 1);
    await projectGraph(shallow, recent);
    await projectGraph(shallow, recent);
    assert.equal(fullReads, 2);
    await git(shallow, ['fetch', '--deepen=1']);
    await projectGraph(shallow, await log(shallow, '', 1));
    assert.equal(fullReads, 3, 'deepening changes topology even when branch hashes stay unchanged');
  } finally {
    client.git = git;
    await fs.rm(root, { recursive: true, force: true });
  }
});
