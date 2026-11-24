import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {
  workspaceRepositories,
  repositoryLabels,
} = require('../out/extension/repositories/discovery');
const { createRepositoryRecents } = require('../out/extension/repositories/recents');
const { repositoryKey } = require('../out/extension/repositories/events');
test('workspace repositories follow folder order, include Git-discovered nested roots and deduplicate aliases', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-discovery-'));
  try {
    await fs.mkdir(path.join(base, 'first'));
    await fs.symlink(path.join(base, 'first'), path.join(base, 'alias'));
    const first = repositoryKey(path.join(base, 'first')),
      nested = path.join(first, 'nested');
    const workspace = {
      workspaceFolders: ['first', 'alias', 'second'].map((name) => ({
        uri: { fsPath: path.join(base, name) },
      })),
    };
    const monitor = {
      ready: Promise.resolve(),
      roots: () => [nested, first, path.join(base, 'outside')],
    };
    const git = async (folder) => {
      if (folder.endsWith('second')) throw Error('not a repository');
      return folder + '\n';
    };
    assert.deepEqual(await workspaceRepositories({ workspace }, monitor, git), [first, nested]);
    assert.deepEqual(
      repositoryLabels(['/one/repo', '/two/repo', '/three/unique']).map((item) => item.name),
      ['/one/repo', '/two/repo', 'unique'],
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
test('Recent groups persist per repository, concurrent writes and clear do not affect another root', async () => {
  const storage = new Map([
    ['vscode-enhanced-git.filterRecents', { branch: [['unattributed-global']] }],
    ['filterRecents:/repo-a', { branch: [['refs/heads/main']], paths: [['src']] }],
  ]);
  const state = {
    get: (key, fallback) => storage.get(key) ?? fallback,
    update: async (key, value) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      storage.set(key, value);
    },
  };
  const recents = createRepositoryRecents(state),
    events = [];
  recents.subscribe((root, value) => events.push({ root, value }));
  assert.deepEqual(
    recents.get('/repo-b'),
    { paths: [] },
    'global history must not leak to a new repository',
  );
  assert.deepEqual(recents.get('/repo-a').paths, [['/repo-a/src']]);
  await Promise.all([
    recents.update('/repo-a', 'branch', ['a'], 'remember'),
    recents.update('/repo-b', 'branch', ['b'], 'remember'),
    recents.update('/repo-a', 'branch', ['c'], 'remember'),
  ]);
  assert.deepEqual(storage.get('filterRecents:/repo-a').branch, [
    ['c'],
    ['a'],
    ['refs/heads/main'],
  ]);
  assert.deepEqual(storage.get('filterRecents:/repo-b').branch, [['b']]);
  await recents.update('/repo-a', 'branch', [], 'clear');
  assert.deepEqual(recents.get('/repo-b').branch, [['b']]);
  assert.equal(events.at(-1).root, '/repo-a');
  const restored = createRepositoryRecents(state);
  assert.deepEqual(restored.get('/repo-a').branch, []);
  assert.deepEqual(restored.get('/repo-b').branch, [['b']]);
});
