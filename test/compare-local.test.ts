import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { git, commitLocalFiles } = require('../out/extension/git/index');
const { ChangesView } = require('../out/extension/views/changes-view');
test('compare local uses commit to working tree, including staged/unstaged changes and renames', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-local-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    for (const name of ['modified', 'deleted', 'renamed'])
      await fs.writeFile(path.join(root, name), name + ' original\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'base']);
    const hash = (await git(root, ['rev-parse', 'HEAD'])).trim();
    assert.equal((await commitLocalFiles(root, hash)).files.length, 0);
    await fs.writeFile(path.join(root, 'modified'), 'staged\n');
    await git(root, ['add', 'modified']);
    await fs.writeFile(path.join(root, 'modified'), 'working\n');
    await git(root, ['mv', 'renamed', 'new name']);
    await fs.unlink(path.join(root, 'deleted'));
    await fs.writeFile(path.join(root, 'added'), 'added\n');
    await git(root, ['add', 'added']);
    await fs.writeFile(path.join(root, 'untracked'), 'ignored\n');
    const result = await commitLocalFiles(root, hash),
      find = (name) => result.files.find((f) => f.path === name);
    assert.equal(result.pair[0].hash, hash);
    assert.equal(result.pair[1].kind, 'workingTree');
    assert.equal(find('modified').before.hash, hash);
    assert.equal(find('modified').after.workingTree, true);
    assert.equal(find('deleted').after, null);
    assert.equal(find('added').before, null);
    assert.equal(find('new name').before.path, 'renamed');
    assert.equal(find('untracked'), undefined);
    const snapshots = new Map(),
      calls = [];
    const uri = (scheme, value) => ({
      scheme,
      path: value,
      toString() {
        return scheme + ':' + value;
      },
    });
    const vscode = {
      Uri: {
        from: (args) => uri(args.scheme, args.path + '?' + args.query),
        file: (value) => uri('file', value),
      },
      commands: { executeCommand: async (...args) => calls.push(args) },
    };
    const view = Object.create(ChangesView.prototype);
    Object.assign(view, { vscode, snapshots, comparison: { ...result, root, id: 'test' } });
    await view.openFile({ id: 'test', index: find('modified').index });
    assert.equal(calls[0][0], 'vscode.diff');
    assert.equal(snapshots.get(calls[0][1].toString()), 'modified original\n');
    assert.equal(calls[0][2].scheme, 'file');
    assert.equal(calls[0][2].path, path.join(root, 'modified'));
    assert.match(calls[0][3], /Working Tree/);
    await view.openFile({ id: 'stale', index: 0 });
    assert.equal(calls.length, 1);
    await assert.rejects(commitLocalFiles(root, '--help'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
