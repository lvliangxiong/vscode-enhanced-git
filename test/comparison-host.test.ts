import type { MockNode } from './helpers/mocks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { git, refs } = require('../out/extension/git/index');
test('comparison host embeds executable resources and isolates both logs and native branch diffs', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsgit-host-')),
    otherRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsgit-other-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Fixture']);
    await git(root, ['config', 'user.email', 'fixture@example.com']);
    await fsp.writeFile(path.join(root, 'file.txt'), 'base');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'base']);
    await git(root, ['branch', 'other']);
    await fsp.writeFile(path.join(root, 'file.txt'), 'main');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'main only']);
    await git(otherRoot, ['init', '-b', 'unrelated']);
    await git(otherRoot, [
      '-c',
      'user.name=Other',
      '-c',
      'user.email=other@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'other repository',
    ]);
    let pickIndex = 0;
    const notifications: string[] = [];
    const panels = [],
      commands = new Map(),
      diffs = [],
      workspaceState = new Map(),
      contexts = new Map();
    let provider,
      changesProvider,
      changesOptions,
      historyOptions,
      logProvider,
      logView,
      logOptions,
      sidebar,
      copied,
      patchDestination;
    function surface(): MockNode {
      const handlers = [],
        messages = [],
        dispose = [];
      const visibility = new Set<() => void>();
      return {
        handlers,
        messages,
        setVisible(value) {
          this.visible = value;
          for (const callback of [...visibility]) callback();
        },
        onDidChangeVisibility: (fn) => {
          visibility.add(fn);
          return {
            dispose() {
              visibility.delete(fn);
            },
          };
        },
        dispose: () => dispose.forEach((fn) => fn()),
        onDidDispose: (fn) => {
          dispose.push(fn);
          return {
            dispose() {
              const index = dispose.indexOf(fn);
              if (index >= 0) dispose.splice(index, 1);
            },
          };
        },
        webview: {
          cspSource: 'https://*.vscode-cdn.net',
          asWebviewUri: (uri) => 'https://file.vscode-cdn.net' + uri.fsPath,
          postMessage: async (message) => messages.push(message),
          onDidReceiveMessage: (fn) => {
            handlers.push(fn);
            return {
              dispose: () => {
                const index = handlers.indexOf(fn);
                if (index >= 0) handlers.splice(index, 1);
              },
            };
          },
        },
        receive: async (msg) => {
          for (const handler of handlers) await handler(msg);
        },
      };
    }
    const vscode = {
      EventEmitter: class {
        event = () => ({ dispose() {} });
        dispose() {}
      },
      extensions: { all: [], onDidChange: () => ({ dispose() {} }) },
      env: {
        clipboard: {
          writeText: async (text) => {
            copied = text;
          },
        },
      },
      Uri: {
        file: (fsPath) => ({ fsPath }),
        joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts) }),
        from: (parts) => ({ ...parts, toString: () => JSON.stringify(parts) }),
      },
      ViewColumn: { Active: 1 },
      ProgressLocation: { Notification: 15 },
      workspace: {
        registerFileSystemProvider: () => ({ dispose() {} }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
        fs: { writeFile: (uri, data) => fsp.writeFile(uri.fsPath, data) },
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
        workspaceFolders: [{ uri: { fsPath: root } }, { uri: { fsPath: otherRoot } }],
        registerTextDocumentContentProvider: (_scheme, p) => {
          provider = p;
        },
      },
      commands: {
        registerCommand: (name, fn) => commands.set(name, fn),
        executeCommand: async (name, ...args) => {
          if (name === 'setContext') contexts.set(args[0], args[1]);
          if (name === 'vscode.diff') diffs.push([name, ...args]);
          if (name === 'vsgit.log.focus' && !logView) {
            logView = surface();
            logProvider.resolveWebviewView(logView);
          }
          if (name === 'vsgit.changes.focus' && !sidebar) {
            sidebar = surface();
            changesProvider.resolveWebviewView(sidebar);
            await sidebar.receive({ type: 'ready' });
          }
        },
      },
      window: {
        registerCustomEditorProvider: () => ({ dispose() {} }),
        activeColorTheme: { kind: 2 },
        onDidChangeActiveColorTheme: () => ({ dispose() {} }),
        showQuickPick: async (choices) => choices[pickIndex],
        createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
        showSaveDialog: async () => patchDestination,
        showInputBox: async () => undefined,
        showInformationMessage: async () => {},
        showWarningMessage: async (_message, _options, action) => action,
        withProgress: async (_options, task) => task(),
        registerWebviewViewProvider: (id, value, options) => {
          if (id === 'vsgit.log') {
            logProvider = value;
            logOptions = options;
          } else if (id === 'vsgit.fileHistory') {
            historyOptions = options;
          } else {
            assert.equal(id, 'vsgit.changes');
            changesProvider = value;
            changesOptions = options;
          }
        },
        showErrorMessage: (message) => {
          notifications.push(message);
          // A visible, undismissed notification must not block operation cleanup.
          return new Promise(() => {});
        },
        createWebviewPanel: () => {
          const panel = surface();
          panel.onDidChangeViewState = panel.onDidChangeVisibility;
          delete panel.onDidChangeVisibility;
          panels.push(panel);
          return panel;
        },
      },
    };
    const filename = path.resolve(__dirname, '../out/extension/extension.js'),
      realRequire = createRequire(filename),
      module: { exports: { activate?: (context: unknown) => void } } = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(filename, 'utf8'),
      {
        module,
        exports: module.exports,
        require: (name) => (name === 'vscode' ? vscode : realRequire(name)),
        console,
        URLSearchParams,
      },
      { filename },
    );
    module.exports.activate({
      subscriptions: [],
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      workspaceState: {
        get: (key, fallback) => workspaceState.get(key) ?? fallback,
        update: async (key, value) => {
          workspaceState.set(key, value);
        },
      },
    });
    await commands.get('vsgit.open')();
    const original = logView;
    await original.receive({ type: 'repositoryHostReady' });
    assert.equal(original.messages.find((m) => m.type === 'repositories').repositories.length, 2);
    const repositoryRoot = original.messages.find((m) => m.type === 'repositories').repositories[0]
      .root;
    await original.receive({ type: 'openRepository', root: repositoryRoot });
    const repositoryHtml = original.messages.find((m) => m.type === 'repositoryDocument').html;
    for (const match of repositoryHtml.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g))
      new vm.Script(match[1]);
    const receiveHost = original.receive;
    original.receive = (message) => receiveHost({ pane: repositoryRoot, ...message });
    const topology = require('../out/extension/git/topology');
    const originalProject = topology.projectGraph;
    let releaseGraph;
    const graphGate = new Promise((resolve) => {
      releaseGraph = resolve;
    });
    topology.projectGraph = async (...args) => {
      if (!args[2]?.firstBlock) await graphGate;
      return originalProject(...args);
    };
    const initialRequest = original.receive({ type: 'init' });
    try {
      for (let i = 0; i < 100 && !original.messages.some((m) => m.type === 'data'); i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      const firstFrame = original.messages.find((m) => m.type === 'data');
      assert.ok(firstFrame?.commits.length, 'first frame does not wait for full graph');
      assert.equal(firstFrame.loadingMore, true);
      assert.ok(firstFrame.commits.length <= 200);
    } finally {
      releaseGraph();
      await initialRequest;
      topology.projectGraph = originalProject;
    }
    const initialIdentity = original.messages.filter((m) => m.type === 'data').at(-1);
    assert.equal(initialIdentity.loadingMore, false);
    assert.equal(initialIdentity.append, true, 'background completion preserves visible rows');
    assert.equal(initialIdentity.user, 'fixture@example.com');
    assert.equal(initialIdentity.userName, 'Fixture');
    const filteredRequest = {
      branchSnapshotKey: initialIdentity.branchSnapshotKey,
      type: 'load',
      ref: '',
      filters: { text: 'main' },
      limit: 500,
    };
    await original.receive({ ...filteredRequest, requestId: 1001 });
    const firstFilter = original.messages.filter((m) => m.type === 'data').at(-1);
    assert.equal(firstFilter.branches, undefined, 'acknowledged branch metadata is not resent');
    await original.receive({ ...filteredRequest, requestId: 1002 });
    const repeatedFilter = original.messages.filter((m) => m.type === 'data').at(-1);
    assert.equal(repeatedFilter.timings.historyCacheHit, 1);
    assert.deepEqual(repeatedFilter.commits, firstFilter.commits);
    await original.receive({ ...filteredRequest, requestId: 1003, refresh: true });
    assert.ok(
      original.messages.filter((m) => m.type === 'data').at(-1).branches.length,
      'refresh sends a new branch snapshot even with an old acknowledgement',
    );
    assert.equal(
      original.messages.filter((m) => m.type === 'data').at(-1).timings.historyCacheHit,
      0,
    );
    await original.receive({ type: 'load', filters: { text: 'absent phrase' }, requestId: 1004 });
    assert.equal(original.messages.filter((m) => m.type === 'data').at(-1).commits.length, 0);
    const emptyCount = original.messages.filter((m) => m.type === 'data').length;
    await original.receive({ ...filteredRequest, requestId: 1005 });
    assert.equal(
      original.messages.filter((m) => m.type === 'data').length,
      emptyCount + 1,
      'search after empty results must not repeat the two-stage startup',
    );
    for (const requestId of [1006, 1007]) {
      await original.receive({ type: 'load', filters: { sinceHours: 24 }, requestId });
      assert.equal(
        original.messages.filter((m) => m.type === 'data').at(-1).timings.historyCacheHit,
        0,
        'relative time is evaluated afresh',
      );
    }
    let releaseOld, enteredOld;
    const oldGate = new Promise((resolve) => {
      releaseOld = resolve;
    });
    const oldStarted = new Promise((resolve) => {
      enteredOld = resolve;
    });
    topology.projectGraph = async (...args) => {
      if (!args[1].length) {
        enteredOld();
        await oldGate;
      }
      return originalProject(...args);
    };
    const staleFilter = original.receive({
      type: 'load',
      filters: { text: 'another missing phrase' },
      requestId: 1008,
    });
    try {
      await oldStarted;
      await original.receive({ ...filteredRequest, requestId: 1009 });
    } finally {
      releaseOld();
      await staleFilter;
      topology.projectGraph = originalProject;
    }
    assert.ok(
      !original.messages.some((m) => m.type === 'data' && m.requestId === 1008),
      'slow old filter cannot overwrite latest result',
    );
    await original.receive({ type: 'load', filters: {}, requestId: 1010 });

    assert.equal(logOptions.webviewOptions.retainContextWhenHidden, true);
    assert.equal(historyOptions.webviewOptions.retainContextWhenHidden, true);
    assert.equal(original.webview.options.enableScripts, true);
    const retainedHtml = original.webview.html,
      retainedMessages = original.messages.length,
      retainedHandlers = original.handlers.length;
    await commands.get('vsgit.open')();
    await commands.get('vsgit.open')();
    assert.equal(
      panels.length,
      0,
      'normal open must focus the bottom view, not create editor tabs',
    );
    assert.equal(logView, original);
    assert.equal(original.webview.html, retainedHtml);
    assert.equal(original.handlers.length, retainedHandlers, 'focus must not reattach listeners');
    assert.equal(
      original.messages.length,
      retainedMessages,
      'focus must not trigger reload messages',
    );
    await original.receive({ type: 'branchTool', action: 'new', ref: 'HEAD', toolbar: true });
    assert.equal(original.messages.at(-1).type, 'branchToolsFinished', 'cancel restores toolbar');
    const fetchStart = original.messages.length;
    await original.receive({ type: 'branchTool', action: 'fetch', toolbar: true });
    assert.ok(
      original.messages
        .slice(fetchStart)
        .some((m) => m.type === 'error' && /No remotes/.test(m.message)),
    );
    assert.equal(original.messages.at(-1).type, 'branchToolsFinished', 'failure restores toolbar');
    assert.match(notifications.at(-1), /^VS Code Git: .*No remotes/s);
    assert.doesNotMatch(original.webview.html, /id="error"/);
    const headBeforeNavigation = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const otherHead = (await git(root, ['rev-parse', 'other'])).trim();
    await original.receive({
      type: 'branchJump',
      branchRef: 'refs/heads/main',
      ref: 'refs/heads/other',
      filters: { query: 'does-not-match' },
      requestId: 91,
    });
    const navigation = original.messages.filter((m) => m.type === 'data').at(-1);
    assert.equal(navigation.requestId, 91);
    assert.equal(navigation.target, headBeforeNavigation);
    assert.equal(navigation.resetFilters, true);
    assert.ok(navigation.commits.some((c) => c.hash === headBeforeNavigation));
    const topologyReader = require('../out/extension/git/topology');
    const projectBeforeLocate = topologyReader.projectGraph;
    topologyReader.projectGraph = () => {
      throw Error('Locating a loaded branch must not rebuild the graph');
    };
    try {
      await original.receive({
        type: 'branchJump',
        branchRef: 'refs/heads/main',
        ref: navigation.ref,
        filters: {},
        requestId: 911,
      });
      assert.equal(original.messages.at(-1).type, 'branchLocated');
      assert.equal(original.messages.at(-1).requestId, 911);
      assert.equal(original.messages.at(-1).target, headBeforeNavigation);
      assert.equal(
        original.messages.at(-1).commits,
        undefined,
        'no history payload on a loaded jump',
      );
    } finally {
      topologyReader.projectGraph = projectBeforeLocate;
    }
    await git(root, ['update-ref', 'refs/remotes/origin/topic', otherHead]);
    await original.receive({
      type: 'branchJump',
      branchRef: 'refs/remotes/origin/topic',
      requestId: 92,
    });
    assert.equal(original.messages.at(-1).target, otherHead);
    await git(root, ['update-ref', 'refs/remotes/origin/topic', headBeforeNavigation]);
    await original.receive({
      type: 'branchJump',
      branchRef: 'refs/remotes/origin/topic',
      requestId: 93,
    });
    assert.equal(
      original.messages.at(-1).target,
      headBeforeNavigation,
      'resolve live branch head rather than cached row',
    );
    await git(root, ['update-ref', '-d', 'refs/remotes/origin/topic']);
    await original.receive({
      type: 'branchJump',
      branchRef: 'refs/remotes/origin/topic',
      requestId: 94,
    });
    assert.match(original.messages.at(-1).message, /no longer exists/);
    await original.receive({ type: 'branchJump', branchRef: 'HEAD', requestId: 95 });
    assert.equal(original.messages.at(-1).target, headBeforeNavigation);
    await original.receive({ type: 'revisionJump', target: otherHead, requestId: 96 });
    const revisionJump = original.messages.filter((m) => m.type === 'data').at(-1);
    assert.equal(revisionJump.target, otherHead);
    assert.equal(revisionJump.resetFilters, false);
    assert.equal(revisionJump.commits.length, 2, 'navigation retains the complete log');
    assert.equal((await git(root, ['symbolic-ref', 'HEAD'])).trim(), 'refs/heads/main');
    assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), headBeforeNavigation);
    const refReader = require('../out/extension/git/refs');
    const resolveHead = refReader.branchHead;
    let releaseHead: () => void;
    let headStarted: () => void;
    const headGate = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    const resolvingHead = new Promise<void>((resolve) => {
      headStarted = resolve;
    });
    refReader.branchHead = async (...args) => {
      headStarted();
      await headGate;
      return resolveHead(...args);
    };
    const oldNavigation = original.receive({
      type: 'branchJump',
      branchRef: 'HEAD',
      requestId: 97,
    });
    try {
      await resolvingHead;
      await original.receive({ type: 'load', filters: { text: 'main only' }, requestId: 98 });
    } finally {
      releaseHead();
      await oldNavigation;
      refReader.branchHead = resolveHead;
    }
    assert.ok(
      !original.messages.some(
        (m) => ['data', 'branchLocated'].includes(m.type) && m.requestId === 97,
      ),
      'resolving an old branch cannot overwrite a newer filter request',
    );
    await original.receive({ type: 'load', filters: {}, requestId: 99 });
    // Navigation must be available while expensive line counts are still pending.
    const reader = require('../out/extension/git/selection-reader');
    const originalStats = reader.readSelectionStats;
    let releaseStats;
    const statsGate = new Promise((resolve) => {
      releaseStats = resolve;
    });
    reader.readSelectionStats = async (...args) => {
      await statsGate;
      return originalStats(...args);
    };
    const selection = [headBeforeNavigation, otherHead];
    const pendingSelection = original.receive({
      type: 'select',
      hashes: selection,
      key: 'perf-selection',
    });
    try {
      for (
        let attempt = 0;
        attempt < 100 &&
        !original.messages.some((m) => m.type === 'details' && m.key === 'perf-selection');
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      const detail = original.messages.find(
        (m) => m.type === 'details' && m.key === 'perf-selection',
      );
      assert.ok(detail, 'files arrive before line counts');
      assert.equal(detail.files.length, 1);
      assert.ok(detail.items.every((item) => !item.stats));
      const client = require('../out/extension/git/client');
      const originalGit = client.git;
      const calls = [];
      try {
        client.git = (...args) => {
          calls.push(args[1]);
          return originalGit(...args);
        };
        await original.receive({
          type: 'selectionFile',
          hashes: selection,
          index: 0,
          key: 'diff',
          open: true,
        });
      } finally {
        client.git = originalGit;
      }
      assert.ok(
        calls.length > 0 && calls.every((args) => args[0] === 'show'),
        'Diff reads blobs without recomputing selection',
      );
      const opened = diffs.pop();
      assert.equal(opened[0], 'vscode.diff');
      assert.equal(provider.provideTextDocumentContent(opened[1]), '');
      assert.equal(provider.provideTextDocumentContent(opened[2]), 'main');
    } finally {
      reader.readSelectionStats = originalStats;
      releaseStats();
      await pendingSelection;
    }
    assert.equal(
      original.messages.filter((m) => m.type === 'detailStats' && m.key === 'perf-selection')
        .length,
      1,
    );
    const manifest = require('../package.json');
    assert.equal(manifest.contributes.viewsContainers.panel[0].id, 'vsgit-panel');
    assert.match(
      manifest.contributes.viewsContainers.panel[0].id,
      /^[a-zA-Z0-9_-]+$/,
      'VS Code rejects punctuation in view container IDs',
    );
    assert.equal(manifest.contributes.views['vsgit-panel'][0].id, 'vsgit.log');
    await original.receive({
      type: 'branchCompare',
      refs: ['refs/heads/main', 'refs/heads/other'],
    });
    const comparison = panels[0],
      html = comparison.webview.html;
    const docs = JSON.parse(
      html.match(/<script id="compare-documents"[^>]*>([\s\S]*?)<\/script>/)[1],
    );
    assert.equal(docs.length, 2);
    assert.doesNotMatch(html, /<iframe|frame-shortcuts/);
    assert.match(html, /compare-host.js/);
    assert.doesNotMatch(html, /log-pane.js/);
    for (const doc of docs) {
      assert.doesNotMatch(doc, /<(?:link[^>]+href|script[^>]+src)=/, 'pane resources are bundled');
      assert.doesNotMatch(doc, /url\(["']icons\//, 'all embedded CSS icons must be self-contained');
      assert.match(doc, /data:image\/svg\+xml;base64,/);
      assert.doesNotMatch(
        doc,
        /<script(?![^>]*type="application\/json")/,
        'pane mounting imports its session rather than executing inline scripts',
      );
      const config = JSON.parse(
        doc.match(/<script id="frame-config"[^>]*>([\s\S]*?)<\/script>/)[1],
      );
      assert.ok(config.start && config.end, 'comparison endpoints remain JSON data');
    }
    await comparison.receive({ type: 'init', pane: 0 });
    await comparison.receive({ type: 'init', pane: 1 });
    const results = comparison.messages.filter((m) => m.type === 'data');
    assert.equal(results.length, 2);
    assert.deepEqual(
      Array.from(results[0].commits, (c: { subject: string }) => c.subject),
      ['main only'],
    );
    assert.equal(results[0].pane, 0);
    assert.equal(results[1].commits.length, 0);
    assert.equal(results[1].pane, 1);
    await comparison.receive({
      type: 'load',
      pane: 0,
      ref: 'refs/heads/other',
      filters: { text: 'not present' },
    });
    assert.equal(comparison.messages.at(-1).commits.length, 0);
    assert.equal(comparison.messages.at(-1).pane, 0);
    await original.receive({ type: 'branchFiles', refs: ['refs/heads/main', 'refs/heads/other'] });
    assert.equal(sidebar.messages.at(-1).files.length, 1);
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: sidebar.messages.at(-1).id });
    assert.equal(diffs[0][0], 'vscode.diff');
    assert.equal(provider.provideTextDocumentContent(diffs[0][1]), 'main');
    assert.equal(provider.provideTextDocumentContent(diffs[0][2]), 'base');
    const branchId = sidebar.messages.at(-1).id;
    await sidebar.receive({
      type: 'comparisonState',
      id: branchId,
      tree: false,
      hasFolders: false,
      expanded: false,
    });
    await commands.get('vsgit.changes.toggleLayout')();
    assert.equal(contexts.get('vsgit.changes.tree'), true);
    assert.deepEqual(sidebar.messages.at(-1), {
      type: 'comparisonAction',
      action: 'tree',
      tree: true,
    });
    await sidebar.receive({
      type: 'comparisonState',
      id: branchId,
      tree: true,
      hasFolders: true,
      expanded: true,
    });
    await commands.get('vsgit.changes.toggleExpansion')();
    assert.equal(sidebar.messages.at(-1).expanded, false);
    assert.equal(contexts.get('vsgit.changes.expanded'), false);
    await commands.get('vsgit.changes.toggleExpansion')();
    assert.equal(sidebar.messages.at(-1).expanded, true);
    await commands.get('vsgit.changes.toggleLayout')();
    assert.equal(contexts.get('vsgit.changes.tree'), false);
    const messagesBefore = sidebar.messages.length;
    await commands.get('vsgit.changes.toggleExpansion')();
    assert.equal(sidebar.messages.length, messagesBefore);
    for (const removed of ['showDiff', 'clear', 'toggleDirectory', 'expandAll', 'collapseAll'])
      assert.equal(commands.has('vsgit.changes.' + removed), false);
    assert.doesNotMatch(
      original.webview.html,
      /branch-changes.js/,
      'the log must not host the sidebar',
    );
    assert.match(sidebar.webview.html, /class="changes-sidebar"/);
    const newer = (await git(root, ['rev-parse', 'main'])).trim(),
      older = (await git(root, ['rev-parse', 'other'])).trim();
    await original.receive({ type: 'commitCompare', hashes: [newer, older] });
    const commitPanel = panels.at(-1);
    assert.equal(
      commitPanel.title,
      `Commit History Comparison: ${newer.slice(0, 8)} ↔ ${older.slice(0, 8)}`,
    );
    await commitPanel.receive({ type: 'init', pane: 0 });
    await commitPanel.receive({ type: 'init', pane: 1 });
    const commitResults = commitPanel.messages.filter((m) => m.type === 'data');
    assert.deepEqual(
      Array.from(commitResults[0].commits, (c: { subject: string }) => c.subject),
      ['main only'],
    );
    assert.equal(commitResults[1].commits.length, 0);
    await original.receive({ type: 'commitFiles', hashes: [older, newer] });
    assert.equal(sidebar.messages.at(-1).files.length, 1);
    assert.equal(sidebar.messages.at(-1).pair[0].kind, 'commit');
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: sidebar.messages.at(-1).id });
    assert.equal(provider.provideTextDocumentContent(diffs[1][1]), 'base');
    assert.equal(provider.provideTextDocumentContent(diffs[1][2]), 'main');
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: branchId });
    assert.equal(diffs.length, 2, 'stale clicks cannot open files from a replaced comparison');
    await commitPanel.receive({ type: 'commitChanges', pane: 0, hash: newer });
    assert.deepEqual(
      Array.from(sidebar.messages.at(-1).pair, (p: { hash: string }) => p.hash),
      [older, newer],
    );
    assert.equal(sidebar.messages.at(-1).files[0].before.hash, older);
    assert.equal(sidebar.messages.at(-1).files[0].after.hash, newer);
    // The root commit has no parent, but its files must still open against empty content.
    await original.receive({ type: 'load', ref: '', filters: {} });
    await original.receive({ type: 'commitChanges', hash: older });
    assert.equal(sidebar.messages.at(-1).pair[0].name, 'Empty Tree');
    assert.equal(sidebar.messages.at(-1).files[0].before, null);
    assert.equal(sidebar.messages.at(-1).files[0].after.hash, older);
    await commitPanel.receive({ type: 'commitChanges', pane: 0, hash: newer });
    const commitId = sidebar.messages.at(-1).id;
    assert.equal(
      changesOptions.webviewOptions.retainContextWhenHidden,
      true,
      'sidebar and section toggles must retain the comparison webview',
    );
    const comparisonHtml = sidebar.webview.html,
      comparisonMessages = sidebar.messages.length,
      comparisonHandlers = sidebar.handlers.length;
    for (let i = 0; i < 3; i++) {
      sidebar.setVisible(false);
      sidebar.setVisible(true);
      await vscode.commands.executeCommand('vsgit.changes.focus');
    }
    assert.equal(sidebar.webview.html, comparisonHtml);
    assert.equal(
      sidebar.messages.length,
      comparisonMessages,
      'visibility changes must not republish or reload comparison data',
    );
    assert.equal(
      sidebar.handlers.length,
      comparisonHandlers,
      'visibility changes must not add listeners',
    );
    sidebar.dispose();
    sidebar = surface();
    changesProvider.resolveWebviewView(sidebar);
    assert.equal(sidebar.messages.length, 0, 'wait for sidebar scripts before sending data');
    await sidebar.receive({ type: 'ready' });
    assert.equal(
      sidebar.messages.at(-1).id,
      commitId,
      'comparison survives sidebar destruction and restoration',
    );
    const layout = {
      left: 0.31,
      right: 0.24,
      branchesCollapsed: true,
      detailsCollapsed: true,
      detailRatio: 0.6,
    };
    await original.receive({ type: 'layoutState', layout });
    // Comparison logs have no branches pane and must not overwrite its saved state.
    await comparison.receive({
      type: 'layoutState',
      pane: 0,
      layout: { ...layout, branchesCollapsed: false },
    });
    await original.receive({ type: 'layoutState', layout: { ...layout, left: -1 } });
    await original.receive({ type: 'layoutState', layout: { ...layout, detailRatio: 2 } });
    assert.match(repositoryHtml, /id="app"/, 'React mounts the split controls inside the log root');
    await commands.get('vsgit.open')(true);
    assert.equal(panels.at(-1).title, `Git Log — ${path.basename(repositoryRoot)}`);
    const restored = JSON.parse(
      panels.at(-1).webview.html.match(/<script id="saved-layout"[^>]*>([\s\S]*?)<\/script>/)[1],
    );
    assert.deepEqual(
      restored,
      layout,
      'closing/reopening a log preserves collapsed state and expanded widths',
    );
    // Recent selections are shared by all existing log tabs, including comparison panes.
    const second = panels.at(-1);
    await second.receive({ type: 'init' });
    await original.receive({ type: 'filterRecent', kind: 'user', values: ['me'] });
    await second.receive({ type: 'filterRecent', kind: 'user', values: ['Fixture'] });
    assert.deepEqual(workspaceState.get(`filterRecents:${repositoryRoot}`).user, [
      ['Fixture'],
      ['me'],
    ]);
    assert.deepEqual(
      original.messages.filter((m) => m.type === 'filterRecents').at(-1).recents.user,
      [['Fixture'], ['me']],
    );
    assert.deepEqual(
      comparison.messages.filter((m) => m.type === 'filterRecents' && m.pane === 1).at(-1).recents
        .user,
      [['Fixture'], ['me']],
    );
    await original.receive({ type: 'filterRecent', kind: 'paths', values: ['file.txt'] });
    assert.deepEqual(Array.from(workspaceState.get(`filterRecents:${repositoryRoot}`).paths[0]), [
      path.join(await fsp.realpath(root), 'file.txt'),
    ]);
    const otherCanonical = await fsp.realpath(otherRoot);
    await receiveHost({ type: 'openRepository', root: otherCanonical });
    await receiveHost({ type: 'init', pane: otherCanonical });
    assert.match(original.webview.html, /repository-host.js/);
    assert.doesNotMatch(original.webview.html, /<iframe|frame-shortcuts/);
    const otherData = original.messages
      .filter((m) => m.type === 'data' && m.pane === otherCanonical)
      .at(-1);
    assert.deepEqual(
      Array.from(otherData.commits, (c: { subject: string }) => c.subject),
      ['other repository'],
    );
    const otherRecentCount = original.messages.filter(
      (m) => m.type === 'filterRecents' && m.pane === otherCanonical,
    ).length;
    await original.receive({ type: 'filterRecent', kind: 'branch', values: ['refs/heads/main'] });
    assert.equal(
      original.messages.filter((m) => m.type === 'filterRecents' && m.pane === otherCanonical)
        .length,
      otherRecentCount,
      'recents updates must only reach the matching repository',
    );
    await receiveHost({
      type: 'filterRecent',
      pane: otherCanonical,
      kind: 'branch',
      values: ['refs/heads/unrelated'],
    });
    assert.deepEqual(workspaceState.get(`filterRecents:${otherCanonical}`).branch, [
      ['refs/heads/unrelated'],
    ]);
    assert.deepEqual(workspaceState.get(`filterRecents:${repositoryRoot}`).branch, [
      ['refs/heads/main'],
    ]);
    await receiveHost({ type: 'repo', pane: otherCanonical, root: repositoryRoot });
    await receiveHost({ type: 'load', pane: otherCanonical });
    assert.equal(
      original.messages.filter((m) => m.type === 'data' && m.pane === otherCanonical).at(-1).root,
      otherCanonical,
      'fixed logs cannot switch their backend root',
    );
    const beforeCompareCurrent = panels.length;
    await original.receive({
      type: 'branchCompareCurrent',
      refs: ['refs/heads/other', 'refs/heads/main'],
    });
    assert.equal(
      panels.length,
      beforeCompareCurrent + 1,
      'Compare with Current skips current branch',
    );
    const currentComparison = panels.at(-1);
    await currentComparison.receive({ type: 'init', pane: 0 });
    await currentComparison.receive({ type: 'init', pane: 1 });
    const currentPairs = currentComparison.messages.filter((m) => m.type === 'data');
    assert.equal(currentPairs[0].commits.length, 1);
    assert.equal(currentPairs[1].commits.length, 0);
    const panelCount = panels.length;
    pickIndex = -1;
    await commands.get('vsgit.open')(true);
    assert.equal(panels.length, panelCount, 'cancelling the picker does not open a tab');
    pickIndex = 1;
    await original.receive({ type: 'newTab' });
    const otherEditor = panels.at(-1);
    assert.doesNotMatch(otherEditor.webview.html, /<iframe|frame-shortcuts/);
    await otherEditor.receive({ type: 'init' });
    assert.equal(otherEditor.messages.find((m) => m.type === 'data').root, otherCanonical);
    otherEditor.dispose();
    pickIndex = 0;
    original.setVisible(false);
    assert.equal(original.messages.at(-1).type, 'hostVisibility');
    assert.equal(original.messages.at(-1).visible, false);
    original.setVisible(true);
    assert.equal(original.messages.at(-1).visible, true);
    comparison.setVisible(false);
    assert.equal(comparison.messages.at(-1).visible, false);
    comparison.setVisible(true);
    // Commit menu messages are checked against the displayed log and keep its
    // ordering, even if a client sends selected hashes in a different order.
    const menuHashes = second.messages.find((m) => m.type === 'data').commits.map((c) => c.hash);
    await second.receive({
      type: 'commitAction',
      action: 'copy',
      hashes: [...menuHashes].reverse(),
    });
    assert.equal(copied, [...menuHashes].reverse().join(' '));
    await second.receive({ type: 'commitAction', action: 'copy', hashes: ['f'.repeat(40)] });
    assert.equal(second.messages.at(-1).type, 'error');
    await second.receive({
      type: 'commitAction',
      action: 'tag',
      hashes: [menuHashes[0]],
      name: '../invalid',
      dialogId: 'tag-test',
    });
    assert.equal(second.messages.at(-1).type, 'commitRefError');
    assert.equal(second.messages.at(-1).dialogId, 'tag-test');
    assert.equal(notifications.at(-1), 'VS Code Git: ' + second.messages.at(-1).message);
    await second.receive({
      type: 'commitAction',
      action: 'tag',
      hashes: [menuHashes[0]],
      name: 'from-log',
      dialogId: 'tag-test',
    });
    assert.equal(second.messages.at(-1).type, 'commitActionDone');
    assert.equal((await git(root, ['rev-parse', 'from-log'])).trim(), menuHashes[0]);
    patchDestination = { fsPath: path.join(root, 'export.patch') };
    await second.receive({ type: 'commitAction', action: 'patch', hashes: [menuHashes[0]] });
    assert.match(await fsp.readFile(patchDestination.fsPath, 'utf8'), /\+main/);
    // Both webview entry points send this same action. It must use the invoking
    // repository and its current branch, not the branch of the selected commit.
    await git(root, ['switch', '-c', 'pick-target', 'main^']);
    await second.receive({ type: 'commitAction', action: 'cherry-pick', hashes: [menuHashes[0]] });
    assert.equal((await git(root, ['symbolic-ref', '--short', 'HEAD'])).trim(), 'pick-target');
    assert.equal((await git(root, ['diff', 'main', 'HEAD'])).trim(), '');
    const cherryResult = second.messages.findLast(
      (message) => message.type === 'cherryPickFinished',
    );
    assert.equal(cherryResult.pending, false);
    assert.equal(cherryResult.refresh, true);
    const pickedHead = await git(root, ['rev-parse', 'HEAD']);
    await second.receive({ type: 'commitAction', action: 'cherry-pick', hashes: ['f'.repeat(40)] });
    assert.equal(second.messages.at(-1).type, 'error');
    assert.equal(await git(root, ['rev-parse', 'HEAD']), pickedHead);
    await git(root, ['switch', 'main']);
    // A non-current branch update must refresh badges in all open logs without
    // relying on vscode.git events (the fixture deliberately has no Git API).
    const remote = path.join(root, '.git', 'badge-remote');
    await git(root, ['init', '--bare', remote]);
    await git(root, ['remote', 'add', 'origin', remote]);
    await git(root, ['branch', 'lagged', 'HEAD^']);
    await git(root, ['push', '-u', 'origin', 'lagged']);
    await git(root, ['push', 'origin', 'HEAD:lagged']);
    assert.equal((await refs(root)).find((b) => b.name === 'lagged').behind, 1);
    const waitForBranches = async (view, after, check) => {
      for (let i = 0; i < 100; i++) {
        const snapshot = view.messages
          .slice(after)
          .find((m) => m.type === 'branches' && check(m.branches));
        if (snapshot) return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail('Branch snapshot was not refreshed');
    };
    // Updating/pushing a different branch must preserve both kinds of dirty edits.
    await fsp.writeFile(path.join(root, 'file.txt'), 'staged edit');
    await git(root, ['add', 'file.txt']);
    await fsp.writeFile(path.join(root, 'file.txt'), 'unstaged edit');
    const checkoutState = async () =>
      Promise.all([
        git(root, ['symbolic-ref', 'HEAD']),
        git(root, ['rev-parse', 'HEAD']),
        git(root, ['diff', '--cached']),
        git(root, ['diff']),
        git(root, ['status', '--porcelain']),
      ]);
    const beforeOperations = await checkoutState();
    let originalStart = original.messages.length,
      secondStart = second.messages.length;
    await second.receive({ type: 'branchAction', action: 'update', ref: 'refs/heads/lagged' });
    const updated = (branches) => branches.find((b) => b.name === 'lagged')?.behind === 0;
    await waitForBranches(original, originalStart, updated);
    await waitForBranches(second, secondStart, updated);
    assert.ok(
      second.messages
        .slice(secondStart)
        .some((m) => m.type === 'operation' && m.action === 'update'),
    );
    assert.deepEqual(
      await checkoutState(),
      beforeOperations,
      'Update must not checkout its target',
    );
    const extra = (
      await git(root, [
        '-c',
        'commit.gpgsign=false',
        'commit-tree',
        'HEAD^{tree}',
        '-p',
        'lagged',
        '-m',
        'outgoing',
      ])
    ).trim();
    await git(root, ['update-ref', 'refs/heads/lagged', extra]);
    assert.equal((await refs(root)).find((b) => b.name === 'lagged').ahead, 1);
    originalStart = original.messages.length;
    secondStart = second.messages.length;
    await second.receive({ type: 'branchAction', action: 'push', ref: 'refs/heads/lagged' });
    await waitForBranches(
      original,
      originalStart,
      (branches) => branches.find((b) => b.name === 'lagged')?.ahead === 0,
    );
    assert.ok(
      second.messages.slice(secondStart).some((m) => m.type === 'operation' && m.action === 'push'),
    );
    assert.deepEqual(await checkoutState(), beforeOperations, 'Push must not checkout its target');
    const next = (
      await git(root, [
        '-c',
        'commit.gpgsign=false',
        'commit-tree',
        'HEAD^{tree}',
        '-p',
        extra,
        '-m',
        'incoming',
      ])
    ).trim();
    await git(root, ['push', 'origin', `${next}:refs/heads/lagged`]);
    const divergent = (
      await git(root, [
        '-c',
        'commit.gpgsign=false',
        'commit-tree',
        'HEAD^{tree}',
        '-p',
        'HEAD',
        '-m',
        'divergent',
      ])
    ).trim();
    await git(root, ['branch', 'divergent', divergent]);
    await git(root, ['branch', '--set-upstream-to=origin/lagged', 'divergent']);
    originalStart = original.messages.length;
    secondStart = second.messages.length;
    await second.receive({
      type: 'branchBatchAction',
      action: 'update',
      refs: ['refs/heads/lagged', 'refs/heads/divergent'],
    });
    assert.ok(
      second.messages
        .slice(secondStart)
        .some((m) => m.type === 'error' && m.message.includes('Completed: lagged')),
    );
    await waitForBranches(original, originalStart, updated);
    assert.equal((await git(root, ['rev-parse', 'lagged'])).trim(), next);
    assert.deepEqual(
      await checkoutState(),
      beforeOperations,
      'Partial batch update must not checkout its targets',
    );
    secondStart = second.messages.length;
    await second.receive({
      type: 'branchBatchAction',
      action: 'update',
      refs: ['refs/heads/lagged'],
    });
    assert.ok(
      second.messages
        .slice(secondStart)
        .some((m) => m.type === 'operation' && m.action === 'update'),
    );
    assert.deepEqual(await checkoutState(), beforeOperations);
    original.dispose();
    second.dispose();
    comparison.dispose();
    commitPanel.dispose();
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: commitId });
    assert.equal(diffs.length, 3, 'closing source log editors leaves the comparison usable');
    assert.equal(provider.provideTextDocumentContent(diffs[2][1]), 'base');
    await commands.get('vsgit.changes.reset')();
    assert.equal(sidebar.messages.at(-1).pair, undefined);
    assert.equal(sidebar.description, undefined);
    await sidebar.receive({
      type: 'comparisonState',
      id: commitId,
      tree: true,
      hasFolders: true,
      expanded: true,
    });
    assert.equal(contexts.get('vsgit.changes.hasComparison'), false);
    assert.equal(contexts.get('vsgit.changes.hasFolders'), false);
    assert.equal(contexts.get('vsgit.changes.expanded'), false);
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: commitId });
    assert.equal(diffs.length, 3, 'reset ignores delayed clicks from the old comparison');
    await assertSelectionSidebar({
      root,
      otherRoot,
      openLog: async (repositoryIndex) => {
        pickIndex = repositoryIndex;
        await commands.get('vsgit.open')(true);
        const log = panels.at(-1);
        await log.receive({ type: 'init' });
        return log;
      },
      sidebar,
      provider,
      diffs,
      commands,
      contexts,
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(otherRoot, { recursive: true, force: true });
  }
});

/** Build commit objects without disturbing the fixture's staged/unstaged edits. */
async function createSelectionHistory(root: string) {
  const commit = async (files: Record<string, string>, subject: string, parent?: string) => {
    const entries = await Promise.all(
      Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([name, content]) => {
          const hash = (
            await git(root, ['hash-object', '-w', '--stdin'], { input: content })
          ).trim();
          return `100644 blob ${hash}\t${name}\n`;
        }),
    );
    const tree = (await git(root, ['mktree'], { input: entries.join('') })).trim();
    return (
      await git(root, [
        '-c',
        'commit.gpgsign=false',
        'commit-tree',
        tree,
        ...(parent ? ['-p', parent] : []),
        '-m',
        subject,
      ])
    ).trim();
  };
  const renameContent = 'An unchanged file travels through two selected renames.\n';
  const base = await commit(
    { 'same.txt': 'base\n', 'original.txt': renameContent, 'remove.txt': 'removed later\n' },
    'selection fixture base',
  );
  const earlyFiles = {
    'same.txt': 'first selected edit\n',
    'intermediate.txt': renameContent,
    'remove.txt': 'removed later\n',
    'transient.txt': 'added then removed by selected commits\n',
    'early.txt': 'first selected addition\n',
  };
  const early = await commit(earlyFiles, 'first selected changes', base);
  const skipped = await commit(
    { ...earlyFiles, 'unselected.txt': 'belongs only to the skipped commit\n' },
    'unselected changes between the selected commits',
    early,
  );
  const late = await commit(
    {
      'same.txt': 'last selected edit\n',
      'final.txt': renameContent,
      'early.txt': earlyFiles['early.txt'],
      'late.txt': 'last selected addition\n',
      'unselected.txt': 'belongs only to the skipped commit\n',
    },
    'last selected changes',
    skipped,
  );
  await git(root, ['update-ref', 'refs/heads/selection-fixture', late]);
  return { base, early, skipped, late };
}

async function assertSelectionSidebar({
  root,
  otherRoot,
  openLog,
  sidebar,
  provider,
  diffs,
  commands,
  contexts,
}) {
  const { base, early, skipped, late } = await createSelectionHistory(root);
  const log = await openLog(0),
    otherLog = await openLog(1);
  let logsDisposed = false;
  try {
    const hashes = [late, early];
    await log.receive({ type: 'select', hashes, key: 'nonconsecutive-selection' });
    const details = log.messages.findLast(
      (message) => message.type === 'details' && message.key === 'nonconsecutive-selection',
    );
    assert.ok(details, 'the third pane has a nonconsecutive commit selection');
    const client = require('../out/extension/git/client'),
      originalGit = client.git,
      calls = [];
    try {
      client.git = (...args) => {
        calls.push(args[1]);
        return originalGit(...args);
      };
      // Request order and duplicate hashes must not change aggregation semantics.
      await log.receive({ type: 'selectionChanges', hashes: [early, late, early] });
    } finally {
      client.git = originalGit;
    }
    assert.equal(calls.length, 0, 'opening the sidebar reuses the loaded selection');
    const snapshot = sidebar.messages.at(-1);
    assert.equal(snapshot.kind, 'selection');
    assert.equal(snapshot.pair, undefined, 'selected commits are not a synthetic endpoint range');
    assert.deepEqual(
      Array.from(snapshot.commits, ({ hash, subject }) => ({ hash, subject })),
      [
        { hash: late, subject: 'last selected changes' },
        { hash: early, subject: 'first selected changes' },
      ],
    );
    assert.deepEqual(snapshot.files, details.files, 'sidebar preserves exact third-pane changes');
    assert.deepEqual(
      snapshot.files.map((file) => file.path).sort(),
      ['early.txt', 'final.txt', 'late.txt', 'remove.txt', 'same.txt'],
      'unselected-only files and selected add/delete cancellations are omitted',
    );
    const renamed = snapshot.files.find((file) => file.path === 'final.txt');
    assert.equal(renamed.status, 'R');
    assert.deepEqual(renamed.before, { hash: base, path: 'original.txt' });
    assert.deepEqual(renamed.after, { hash: late, path: 'final.txt' });
    const changed = snapshot.files.find((file) => file.path === 'same.txt');
    assert.equal(changed.before.hash, base);
    assert.equal(changed.after.hash, late);
    for (const file of snapshot.files) {
      await log.receive({ type: 'selectionFile', hashes, index: file.index, open: true });
      const thirdPaneDiff = diffs.pop();
      await sidebar.receive({ type: 'branchChangesFile', index: file.index, id: snapshot.id });
      const sidebarDiff = diffs.pop();
      assert.equal(sidebarDiff[0], 'vscode.diff');
      for (const side of [1, 2])
        assert.equal(
          provider.provideTextDocumentContent(sidebarDiff[side]),
          provider.provideTextDocumentContent(thirdPaneDiff[side]),
          `${file.path}: sidebar and third pane open the same revision on side ${side}`,
        );
    }

    const foreignHash = (await git(otherRoot, ['rev-parse', 'HEAD'])).trim();
    let sidebarCount = sidebar.messages.length;
    for (const invalid of [[], ['f'.repeat(40)], [late, foreignHash], 'HEAD']) {
      await log.receive({ type: 'selectionChanges', hashes: invalid });
      assert.equal(log.messages.at(-1).type, 'error');
      assert.equal(sidebar.messages.length, sidebarCount, 'invalid selections preserve sidebar');
    }
    await otherLog.receive({ type: 'selectionChanges', hashes });
    assert.equal(otherLog.messages.at(-1).type, 'error');
    assert.equal(sidebar.messages.length, sidebarCount, 'another repository cannot reuse hashes');

    await log.receive({ type: 'select', hashes: [skipped], key: 'new-log-selection' });
    await otherLog.receive({ type: 'select', hashes: [foreignHash], key: 'other-repository' });
    assert.equal(sidebar.messages.length, sidebarCount, 'log selections do not replace snapshot');
    await commands.get('vsgit.changes.refresh')();
    const refreshed = sidebar.messages.at(-1);
    assert.notEqual(refreshed.id, snapshot.id);
    assert.equal(refreshed.previousId, snapshot.id);
    assert.deepEqual(refreshed.commits, snapshot.commits);
    assert.deepEqual(refreshed.files, snapshot.files, 'refresh retains the original selected set');
    assert.equal(refreshed.repository, snapshot.repository);
    const openedCount = diffs.length;
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: snapshot.id });
    assert.equal(diffs.length, openedCount, 'refresh ignores clicks from the replaced snapshot');
    log.dispose();
    otherLog.dispose();
    logsDisposed = true;
    await commands.get('vsgit.changes.refresh')();
    assert.deepEqual(sidebar.messages.at(-1).files, snapshot.files, 'closing logs keeps snapshot');
    const latestId = sidebar.messages.at(-1).id;
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: latestId });
    assert.equal(diffs.length, openedCount + 1, 'closed source logs do not prevent opening diff');
    await commands.get('vsgit.changes.reset')();
    assert.equal(sidebar.messages.at(-1).commits, undefined);
    assert.equal(contexts.get('vsgit.changes.hasComparison'), false);
    sidebarCount = sidebar.messages.length;
    await commands.get('vsgit.changes.refresh')();
    assert.equal(sidebar.messages.length, sidebarCount, 'reset removes the selected-set loader');
    await sidebar.receive({ type: 'branchChangesFile', index: 0, id: latestId });
    assert.equal(diffs.length, openedCount + 1, 'reset ignores stale selection file clicks');
  } finally {
    if (!logsDisposed) {
      log.dispose();
      otherLog.dispose();
    }
  }
}
