import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import { fileHistoryTarget, openFileHistory } from '../src/extension/commands/file-history';

test('file history command resolves a file against its own repository HEAD and supports active editor, explicit URI and picker cancellation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-history-command-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await fs.mkdir(path.join(root, 'nested'));
    const filename = path.join(root, 'nested', 'file with spaces.ts');
    await fs.writeFile(filename, 'export const n = 1;');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'initial']);
    const target = await fileHistoryTarget(filename);
    assert.equal(target.file, 'nested/file with spaces.ts');
    assert.equal(target.revision, (await git(root, ['rev-parse', 'HEAD'])).trim());
    const uri = { scheme: 'vscode-remote', fsPath: filename };
    const opened: unknown[][] = [];
    const open = async (...args: string[]) => {
      opened.push(args);
    };
    const vscode: any = {
      FileType: { Directory: 2 },
      workspace: { fs: { stat: async () => ({ type: 1 }) } },
      window: { activeTextEditor: { document: { uri } }, showOpenDialog: async () => undefined },
    };
    await openFileHistory(vscode, open);
    assert.deepEqual(opened[0], [target.root, target.revision, target.file]);
    vscode.window.activeTextEditor = undefined;
    await openFileHistory(vscode, open, uri as any);
    assert.equal(opened.length, 2);
    await openFileHistory(vscode, open);
    assert.equal(opened.length, 2, 'cancelled picker does not open history');
    vscode.window.showOpenDialog = async () => [uri];
    await openFileHistory(vscode, open);
    assert.equal(opened.length, 3);
    vscode.workspace.fs.stat = async () => ({ type: 2 });
    await assert.rejects(openFileHistory(vscode, open, uri as any), /Choose a file/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
