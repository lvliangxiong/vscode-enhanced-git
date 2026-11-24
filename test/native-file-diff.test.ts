import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeFileDiff, registerHistoryDiffFiles } from '../src/extension/views/native-file-diff';

test('native history diff opens the real file, retains pinned mappings and releases closed contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-git-history-diff-'));
  const snapshots = new Map<string, string>(),
    commands: any[] = [],
    notifications: string[] = [];
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  let changed: () => void,
    disposed = false;
  const tabs: any[] = [];
  const activeTabGroup: any = {};
  const vscode = {
    Uri: {
      from: (value: any) => ({ ...value, toString: () => JSON.stringify(value) }),
      file: (fsPath: string) => ({ fsPath }),
    },
    ViewColumn: { Active: -1 },
    window: {
      showInformationMessage: (message: string) => notifications.push(message),
      showErrorMessage: (message: string) => assert.fail(message),
      tabGroups: {
        all: [{ tabs }],
        activeTabGroup,
        onDidChangeTabs: (fn: () => void) => {
          changed = fn;
          return {
            dispose() {
              disposed = true;
            },
          };
        },
      },
    },
    commands: {
      registerCommand: (id: string, fn: any) => {
        handlers.set(id, fn);
        return { dispose() {} };
      },
      executeCommand: async (...args: any[]) => {
        commands.push(args);
        if (args[0] === 'vscode.diff') {
          const found = tabs.find((tab) => tab.input.original.toString() === args[1].toString());
          if (!found) {
            const previous = tabs.findIndex((tab) => !tab.pinned);
            if (previous >= 0) tabs.splice(previous, 1);
            tabs.push({ input: { original: args[1], modified: args[2] }, pinned: false });
            activeTabGroup.activeTab = tabs.at(-1);
            changed();
          }
        }
      },
    },
  } as any;
  const context = { subscriptions: [] } as any;
  const files = registerHistoryDiffFiles(vscode, context);
  const source = vscode.Uri.file(path.join(root, 'current-name.go'));
  const controller = nativeFileDiff(vscode, () => 3, snapshots, source, files);
  const openFile = handlers.get('vscode-git.fileHistory.openFile');
  const data = {
    hash: 'a'.repeat(40),
    path: 'old-name.go',
    beforeLabel: 'old-name.go (12345678)',
    afterLabel: 'Working Tree',
    contents: ['before', 'first'] as [string, string],
  };
  try {
    await fs.writeFile(source.fsPath, 'working tree');
    await controller.open(data);
    assert.equal(snapshots.size, 2);
    assert.equal(commands.at(-1)[1].scheme, 'vscode-git-history');
    const pinnedUri = tabs[0].input.modified;
    tabs[0].pinned = true;
    await controller.open({ ...data, contents: ['before', 'second'] });
    assert.equal(snapshots.size, 4, 'changed working-tree contents need a fresh snapshot');
    assert.equal(files.size, 4);
    assert.ok([...snapshots.values()].includes('second'));
    assert.deepEqual(commands.at(-1)[4], { viewColumn: 3, preserveFocus: true, preview: true });
    await openFile(pinnedUri);
    assert.deepEqual(commands.at(-1), ['vscode.open', source, { viewColumn: -1, preview: false }]);
    assert.equal(
      await fs.readFile(source.fsPath, 'utf8'),
      'working tree',
      'historical contents never overwrite the source',
    );
    const count = commands.length;
    await openFile({ toString: () => 'unregistered snapshot' });
    assert.equal(commands.length, count, 'unregistered resources cannot open arbitrary files');
    tabs.shift();
    changed();
    assert.equal(snapshots.size, 2, 'closed pinned versions are released');
    assert.equal(files.size, 2);
    controller.dispose();
    assert.equal(snapshots.size, 2, 'a native tab remains readable after closing history');
    await openFile();
    assert.equal(
      commands.at(-1)[1],
      source,
      'open file still works after the history session closes',
    );
    await fs.rm(source.fsPath);
    const beforeMissing = commands.length;
    await openFile();
    assert.equal(commands.length, beforeMissing, 'missing files are not recreated');
    assert.match(notifications.at(-1), /no longer exists/);
    tabs.length = 0;
    changed();
    assert.equal(snapshots.size, 0);
    assert.equal(files.size, 0);
    assert.equal(disposed, true);
  } finally {
    controller.dispose();
    for (const subscription of context.subscriptions) subscription.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
