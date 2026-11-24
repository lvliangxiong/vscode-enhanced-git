import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import { FileHistoryView } from '../src/extension/views/file-history';

test('file history sidebar reuses the existing editor group, validates loaded entries and routes actions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-git-history-host-'));
  let receive: (message: any) => Promise<void>, dispose: () => void;
  const messages: any[] = [],
    calls: any[] = [],
    commands: any[] = [],
    errors: string[] = [],
    affected: any[] = [],
    located: any[] = [];
  const snapshots = new Map<string, string>();
  const handlers = new Map<string, () => Promise<void>>();
  let picked: any[] | undefined;
  let unsubscribed = false;
  const panel = {
    webview: {
      html: '',
      cspSource: 'https://resources.test',
      asWebviewUri: (uri: any) => uri.fsPath,
      postMessage: async (message: any) => messages.push(message),
      onDidReceiveMessage: (fn: typeof receive) => {
        receive = fn;
        return {
          dispose() {
            unsubscribed = true;
          },
        };
      },
    },
    onDidDispose: (fn: () => void) => {
      dispose = fn;
    },
  };
  const vscode = {
    Uri: {
      joinPath: (base: any, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) }),
      from: (value: any) => ({ ...value, toString: () => JSON.stringify(value) }),
      file: (fsPath: string) => ({ fsPath }),
    },
    ViewColumn: { One: 1 },
    commands: {
      registerCommand: (id: string, handler: any) => {
        handlers.set(id, handler);
        return { dispose() {} };
      },
      executeCommand: async (...args: any[]) => {
        commands.push(args);
      },
    },
    window: {
      tabGroups: {
        activeTabGroup: { viewColumn: 3 },
        all: [],
        onDidChangeTabs: () => ({ dispose() {} }),
      },
      createWebviewPanel: (...args: any[]) => {
        calls.push(args);
        return panel;
      },
      showQuickPick: async () => picked,
      showErrorMessage: (error: string) => errors.push(error),
    },
  } as any;
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(root, 'file.txt'), 'created\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'Creation']);
    const first = (await git(root, ['rev-parse', 'HEAD'])).trim();
    await fs.writeFile(path.join(root, 'file.txt'), 'changed\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'Change']);
    const hash = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const history = new FileHistoryView(
      vscode,
      { extensionUri: { fsPath: '/extension' }, subscriptions: [] } as any,
      new Map(),
    );
    await history.show(root, hash, 'file.txt', {
      snapshots,
      showAffected: async (entries) => {
        affected.push(entries);
      },
      selectInLog: async (entry) => {
        located.push(entry);
      },
    });
    assert.equal(
      JSON.stringify(commands.filter((call) => call[0] !== 'setContext')),
      JSON.stringify([['vscode-git.fileHistory.focus']]),
    );
    commands.length = 0;
    history.resolveWebviewView(panel as any);
    assert.equal(calls.length, 0, 'history does not create an Editor tab');
    assert.match(panel.webview.html, /src="[^\"]*\/file-history.js/);
    assert.doesNotMatch(panel.webview.html, /monaco/);
    await receive({ type: 'historyDiff', hash: 'f'.repeat(40) });
    assert.deepEqual(commands, []);
    await receive({ type: 'ready' });
    assert.equal(messages[0].type, 'historyStart');
    assert.equal(messages.at(-1).entries.length, 2);
    assert.equal((panel as any).description, `file.txt · Up to ${hash.slice(0, 8)}`);
    const toolbar = {
      loading: false,
      selected: 1,
      affected: true,
      locate: true,
      view: { author: true, date: true, hash: true, details: false },
    };
    await receive({ type: 'historyToolbarState', generation: 1, state: toolbar });
    assert.equal(handlers.has('vscode-git.fileHistory.compare'), false);
    await handlers.get('vscode-git.fileHistory.compareLocal')();
    assert.deepEqual(messages.at(-1), {
      type: 'historyAction',
      action: 'compareLocal',
      generation: 1,
    });
    await receive({
      type: 'historyToolbarState',
      generation: 1,
      state: { ...toolbar, loading: true },
    });
    const beforeBusy = messages.length;
    await handlers.get('vscode-git.fileHistory.refresh')();
    assert.equal(messages.length, beforeBusy, 'native title commands respect loading state');
    await receive({ type: 'historyToolbarState', generation: 0, state: toolbar });
    await handlers.get('vscode-git.fileHistory.refresh')();
    assert.equal(
      messages.length,
      beforeBusy,
      'stale selection state cannot re-enable title commands',
    );
    await receive({ type: 'historyToolbarState', generation: 1, state: toolbar });
    picked = [];
    await handlers.get('vscode-git.fileHistory.viewOptions')();
    assert.deepEqual(messages.at(-1), {
      type: 'historyViewOptions',
      view: { author: false, date: false, hash: false, details: false },
    });
    picked = undefined;
    const beforeCancel = messages.length;
    await handlers.get('vscode-git.fileHistory.viewOptions')();
    assert.equal(messages.length, beforeCancel, 'cancelled preferences are unchanged');
    const html = panel.webview.html;
    const loaded = messages.length;
    await receive({ type: 'ready' });
    assert.equal(messages.length, loaded, 'retained view does not reload on repeated ready');
    await receive({ type: 'historyDiff', hash, key: 'first', generation: 1 });
    const native = commands.at(-1);
    assert.equal(native[0], 'vscode.diff');
    assert.deepEqual(native[4], { viewColumn: 3, preserveFocus: true, preview: true });
    assert.deepEqual([...snapshots.values()], ['created\n', 'changed\n']);
    assert.equal(messages.at(-1).type, 'historyDiffReady');
    assert.ok(
      !messages.some((message) => message.data?.contents),
      'file blobs never cross into the Webview',
    );
    await receive({ type: 'historyDiff', hash, key: 'second', generation: 1 });
    assert.equal(snapshots.size, 2, 'same immutable pair reuses snapshots');
    vscode.window.tabGroups.activeTabGroup.viewColumn = 1;
    await receive({ type: 'historyDiff', hash, key: 'moved', generation: 1 });
    assert.equal(
      commands.at(-1)[4].viewColumn,
      1,
      'editor group changes do not create a new group',
    );
    await receive({ type: 'historyAffected', hashes: [hash, first] });
    assert.deepEqual(
      affected[0].map((e) => e.hash),
      [hash, first],
    );
    await receive({ type: 'historyLocate', hash });
    assert.equal(located[0].hash, hash);
    await receive({ type: 'historyRefresh' });
    assert.equal(messages.at(-1).reset, true);
    const count = commands.length;
    await receive({ type: 'historyDiff', hash, key: 'stale', generation: 0 });
    assert.equal(commands.length, count);
    const staleCount = commands.length;
    await receive({ type: 'historyAffected', hashes: [hash], generation: 1 });
    assert.equal(affected.length, 1, 'old session actions are rejected');
    const obsolete = history.show(root, hash, 'missing.txt', { snapshots });
    await history.show(root, hash, 'file.txt', { snapshots });
    await obsolete;
    assert.equal(messages.at(-1).path, 'file.txt');
    assert.equal(panel.webview.html, html, 'switching files retains the sidebar DOM');
    const latest = messages.at(-1).generation;
    await receive({ type: 'historyDiff', hash, generation: latest });
    assert.equal(commands.at(-1)[0], 'vscode.diff');
    assert.ok(commands.length > staleCount);
    dispose();
    assert.equal(unsubscribed, true);
    await receive({ type: 'historyMore' });
    assert.deepEqual(errors, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
