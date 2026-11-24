import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import { openWorkingFile } from '../src/extension/views/open-working-file';
import type { FileChange } from '../src/shared/model';

test('Open File uses the working copy or a read-only historical snapshot without recreating deleted files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-open-file-'));
  const snapshots = new Map<string, string>();
  const commands: any[][] = [];
  const vscode = {
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
      from: (value: any) => ({ ...value, toString: () => JSON.stringify(value) }),
    },
    commands: {
      executeCommand: async (...args: any[]) => {
        commands.push(args);
      },
    },
  } as any;
  try {
    await git(root, ['init']);
    await fs.writeFile(path.join(root, 'source.ts'), 'historical contents\n');
    await git(root, ['add', '.']);
    await git(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'fixture',
    ]);
    const hash = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const change: FileChange = {
      index: 0,
      path: 'source.ts',
      status: 'M',
      before: null,
      after: { hash, path: 'source.ts' },
    };
    await fs.writeFile(path.join(root, 'source.ts'), 'working contents\n');
    await openWorkingFile(vscode, root, change, snapshots);
    assert.deepEqual(commands.at(-1), [
      'vscode.open',
      { fsPath: path.join(root, 'source.ts') },
      { preview: false },
    ]);
    assert.equal(snapshots.size, 0);
    assert.equal(await fs.readFile(path.join(root, 'source.ts'), 'utf8'), 'working contents\n');
    await fs.rename(path.join(root, 'source.ts'), path.join(root, 'renamed.ts'));
    await openWorkingFile(
      vscode,
      root,
      {
        ...change,
        status: 'R',
        before: change.after,
        after: { path: 'renamed.ts', workingTree: true },
      },
      snapshots,
    );
    assert.equal(commands.at(-1)[1].fsPath, path.join(root, 'renamed.ts'));
    await openWorkingFile(
      vscode,
      root,
      { ...change, status: 'D', before: change.after, after: null },
      snapshots,
    );
    const snapshot = commands.at(-1)[1];
    assert.equal(snapshot.scheme, 'vscode-enhanced-git');
    assert.equal(snapshots.get(snapshot.toString()), 'historical contents\n');
    await assert.rejects(fs.stat(path.join(root, 'source.ts')), { code: 'ENOENT' });
    await assert.rejects(
      openWorkingFile(
        vscode,
        root,
        { ...change, after: { path: 'missing.ts', workingTree: true } },
        snapshots,
      ),
      /no longer exists/,
    );
    await assert.rejects(
      openWorkingFile(vscode, root, { ...change, after: { path: '../outside.ts' } }, snapshots),
    );
    assert.equal(commands.length, 3, 'invalid and unavailable files are not opened');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
