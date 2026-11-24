import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import {
  commitFileDiffs,
  registerCommitFileDiffs,
} from '../src/extension/commands/commit-file-diffs';

test('native Git hover action carries its repository and appended hash into a fixed File Diffs snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-git-hover-diffs-'));
  const subscriptions: { dispose(): void }[] = [];
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(root, 'old.txt'), 'hello\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'root commit']);
    const base = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const initial = await commitFileDiffs(root, base);
    assert.equal(initial.files[0].before, null);
    await git(root, ['mv', 'old.txt', 'new.txt']);
    await fs.writeFile(path.join(root, 'second.txt'), 'second\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'rename and add']);
    const hash = (await git(root, ['rev-parse', 'HEAD'])).trim();
    let provider: any, command: (...args: any[]) => Promise<void>, enable: () => void;
    const handlers = new Map<string, (...args: any[]) => Promise<void>>();
    const located: string[][] = [];
    let removed = 0;
    const errors: string[] = [],
      reports: string[] = [],
      results: any[] = [];
    const api = {
      registerSourceControlHistoryItemDetailsProvider(value: any) {
        provider = value;
        return {
          dispose() {
            removed++;
          },
        };
      },
    };
    const extension = {
      enabled: true,
      getAPI: () => api,
      onDidChangeEnablement(fn: () => void) {
        enable = fn;
        return { dispose() {} };
      },
    };
    const vscode: any = {
      extensions: { getExtension: () => ({ activate: async () => extension }) },
      commands: {
        registerCommand(_name: string, fn: typeof command) {
          handlers.set(_name, fn);
          if (_name === 'vscode-git.showCommitFileDiffs') command = fn;
          return { dispose() {} };
        },
      },
      window: { showErrorMessage: (message: string) => errors.push(message) },
    };
    await registerCommitFileDiffs(
      vscode,
      { subscriptions } as any,
      async (repo, load) => {
        results.push({ repo, result: await load() });
      },
      (message) => reports.push(message),
      async (repo, hash) => {
        located.push([repo, hash]);
      },
    ).ready;
    const uri = { scheme: 'vscode-remote', fsPath: root };
    const action = provider.provideHoverCommands({ rootUri: uri })[0];
    const locateAction = provider.provideHoverCommands({ rootUri: uri })[1];
    assert.equal(locateAction.command, 'vscode-git.locateCommit');
    await handlers.get(locateAction.command)(...locateAction.arguments, hash);
    assert.equal(located[0][1], hash);
    assert.equal(located.length, 1);

    assert.equal(action.command, 'vscode-git.showCommitFileDiffs');
    assert.match(action.title, /Show File Diffs/);
    assert.equal(provider.provideAvatar(), undefined);
    assert.equal(provider.provideMessageLinks(), undefined);
    await command(...action.arguments, hash); // Native Git appends the hovered commit.
    const result = results[0].result;
    assert.deepEqual(result.commits, [{ hash, subject: 'rename and add' }]);
    assert.equal(result.files.length, 2, 'all files, not only the blamed file');
    const renamed = result.files.find((file: any) => file.path === 'new.txt');
    assert.deepEqual(renamed.before, { hash: base, path: 'old.txt' });
    assert.deepEqual(renamed.after, { hash, path: 'new.txt' });
    await command(uri, '--all');
    assert.equal(results.length, 1);
    assert.match(errors[0], /Invalid commit/);
    extension.enabled = false;
    enable();
    assert.equal(removed, 1);
    extension.enabled = true;
    enable();
    assert.deepEqual(reports, []);
  } finally {
    subscriptions.forEach((item) => item.dispose());
    await fs.rm(root, { recursive: true, force: true });
  }
});
