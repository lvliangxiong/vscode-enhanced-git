import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import { selectionDetails, selectionChange } from '../src/extension/git/changes';
import { mergeFileStatuses } from '../src/extension/git/merge-changes';
import { openMergeDiff } from '../src/extension/views/merge-diff';
import { readCommitMetadata, readCommitHoverStats } from '../src/extension/git/commit-metadata';
import type { MergeDiffData } from '../src/shared/merge-diff';
import { mergeLayout } from '../src/webview/merge/layout';
import type { FileChange } from '../src/shared/model';

function host() {
  const snapshots = new Map<string, string>(),
    diffs: unknown[][] = [],
    messages: any[] = [],
    openedFiles: any[] = [],
    copied: string[] = [],
    external: string[] = [];
  let receive: (message: any) => Promise<void>;
  let panels = 0;
  let custom: any;
  let style = 'native';
  let configListener: (event: any) => void;
  let disposed: () => void;
  let styleDisposed = false;
  const commands = new Map();
  const dispose = { dispose() {} };
  const panel = {
    active: true,
    onDidChangeViewState: () => dispose,
    webview: {
      cspSource: 'https://files.test',
      html: '',
      asWebviewUri: (uri) => 'https://files.test' + uri.fsPath,
      postMessage: async (message) => {
        messages.push(message);
      },
      onDidReceiveMessage: (fn) => {
        receive = fn;
        return { dispose() {} };
      },
    },
    onDidDispose(fn) {
      disposed = fn;
    },
  };
  const vscode = {
    EventEmitter: class {
      event = () => dispose;
      dispose() {}
    },
    FileType: { File: 1, Directory: 2 },
    FilePermission: { Readonly: 1 },
    FileSystemError: { NoPermissions: (message) => Error(message) },
    workspace: {
      registerFileSystemProvider: () => dispose,
      getConfiguration: () => ({ get: (_key, fallback) => style ?? fallback }),
      onDidChangeConfiguration: (fn) => {
        configListener = fn;
        return {
          dispose() {
            styleDisposed = true;
          },
        };
      },
    },
    env: {
      clipboard: {
        writeText: async (text) => {
          copied.push(text);
        },
      },
      openExternal: async (uri) => {
        external.push(uri);
      },
    },
    Uri: {
      parse: (value) => value,
      file: (fsPath) => ({ fsPath }),
      from: (data) => ({ ...data, toString: () => JSON.stringify(data) }),
      joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts) }),
    },
    ViewColumn: { Active: 1 },
    window: {
      registerCustomEditorProvider: (_id, provider) => {
        custom = provider;
        return dispose;
      },
      createWebviewPanel: () => {
        panels++;
        return panel;
      },
      showErrorMessage: (message) => {
        throw Error(message);
      },
    },
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return dispose;
      },
      executeCommand: async (...args) => {
        if (args[0] === 'vscode.openWith') {
          panels++;
          const document = custom.openCustomDocument(args[1]);
          await custom.resolveCustomEditor(document, panel);
        } else if (args[0] === 'vscode.diff') diffs.push(args);
        else if (args[0] === 'vscode.open') openedFiles.push(args.slice(1));
      },
    },
  } as any;
  return {
    vscode,
    snapshots,
    panel,
    diffs,
    messages,
    openedFiles,
    copied,
    external,
    receive: (message) => receive(message),
    panels: () => panels,
    command: (id) => commands.get(id)(),
    changeStyle(value: string) {
      style = value;
      configListener({ affectsConfiguration: (key) => key === 'vscode-git.mergeDiffStyle' });
    },
    dispose: () => disposed(),
    styleDisposed: () => styleDisposed,
    context: { subscriptions: [], extensionUri: { fsPath: path.resolve(__dirname, '..') } } as any,
  };
}

async function repository(
  run: (root: string, commit: (message: string) => Promise<string>) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-git-merge-diff-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'commit.gpgsign', 'false']);
    const commit = async (message: string) => {
      await git(root, ['add', '.']);
      await git(root, ['commit', '-m', message]);
      return (await git(root, ['rev-parse', 'HEAD'])).trim();
    };
    await run(root, commit);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('committed conflict opens parent 1 / result / parent 2, with parent-specific native comparisons', () =>
  repository(async (root, commit) => {
    const file = path.join(root, '中文.txt');
    await fs.writeFile(file, 'base\n');
    await commit('base');
    await git(root, ['checkout', '-b', 'topic']);
    await fs.writeFile(file, 'topic\n');
    const topic = await commit('topic');
    await git(root, ['checkout', 'main']);
    await fs.writeFile(file, 'main\n');
    const main = await commit('main');
    await assert.rejects(git(root, ['merge', '--no-ff', 'topic', '-m', 'merge']));
    await fs.writeFile(file, 'resolved\n');
    const merge = await commit('resolved merge');
    const selected = await selectionDetails(root, [merge]);
    assert.deepEqual(
      selected.files[0].mergeParents.map((revision) => revision.hash),
      [main, topic],
    );
    assert.deepEqual(
      selected.parents.map((parent) => parent.hash),
      [main, topic],
    );
    assert.equal(selectionChange(selected, selected.parents[1].files[0].index).before.hash, topic);
    assert.equal(selectionChange(selected, 99999), undefined);
    const h = host();
    await openMergeDiff(h.vscode, h.context, h.snapshots, root, selected.files[0]);
    assert.equal(h.panels(), 1);
    assert.equal(h.diffs.length, 0);
    assert.ok(
      !h.panel.webview.html.includes('resolved'),
      'source content travels in messages, never executable HTML',
    );
    await h.receive({ type: 'ready' });
    const data: MergeDiffData = h.messages[0].data;
    assert.equal(data.style, 'native');
    await h.receive({ type: 'mergeCommitAction', hash: merge, action: 'stats' });
    assert.deepEqual(h.messages.at(-1), {
      type: 'mergeCommitStats',
      hash: merge,
      stats: { files: 1, insertions: 1, deletions: 1 },
    });
    await h.receive({ type: 'mergeCommitAction', hash: merge, action: 'copy' });
    assert.deepEqual(h.copied, [merge]);
    await h.receive({ type: 'mergeCommitAction', hash: merge, action: 'email' });
    assert.deepEqual(h.external, ['mailto:test%40example.com']);
    const beforeUnknown = h.messages.length;
    await h.receive({ type: 'mergeCommitAction', hash: 'unknown', action: 'stats' });
    assert.equal(h.messages.length, beforeUnknown);

    await h.command('vscode-git.merge.openFile');
    assert.deepEqual(h.openedFiles, [[{ fsPath: file }, { preview: false }]]);
    h.changeStyle('jetbrains');
    assert.deepEqual(h.messages.at(-1), { type: 'mergeDiffStyle', style: 'jetbrains' });
    h.changeStyle('invalid');
    assert.deepEqual(h.messages.at(-1), { type: 'mergeDiffStyle', style: 'native' });
    assert.deepEqual(data.contents, ['main\n', 'resolved\n', 'topic\n']);
    assert.deepEqual(
      data.commits.map((commit) => commit.hash),
      [main, merge, topic],
    );
    assert.deepEqual(
      data.commits.map((commit) => commit.message),
      ['main', 'resolved merge', 'topic'],
    );
    assert.ok(
      data.commits.every(
        (commit) =>
          commit.author === 'Test' &&
          commit.email === 'test@example.com' &&
          Number.isFinite(Date.parse(commit.authorDate)),
      ),
    );
    assert.ok(
      mergeLayout(data).sides.every(
        (ranges) => ranges[0].kind === 'modified' && ranges[0].start === 0 && ranges[0].end === 1,
      ),
    );
    await h.command('vscode-git.merge.compareParent2');
    assert.equal(h.diffs[0][0], 'vscode.diff');
    assert.equal(h.snapshots.get(String(h.diffs[0][1])), 'topic\n');
    assert.equal(h.snapshots.get(String(h.diffs[0][2])), 'resolved\n');
    await h.receive({ type: 'compareParent', parent: 9 });
    assert.equal(h.diffs.length, 1);
    assert.equal((await git(root, ['status', '--porcelain'])).trim(), '');
    assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), merge);
    h.dispose();
    assert.equal(h.styleDisposed(), true);
  }));

test('missing merge revisions use the same two-sided order as Rebased', () =>
  repository(async (root, commit) => {
    await fs.writeFile(path.join(root, 'file'), 'version one\n');
    const one = await commit('one');
    await fs.writeFile(path.join(root, 'file'), 'version two\n');
    const two = await commit('two');
    const a = { hash: one, path: 'file' },
      b = { hash: two, path: 'file' };
    for (const [parents, result, expected] of [
      [[null, a], b, ['version two\n', 'version one\n']],
      [[a, null], b, ['version one\n', 'version two\n']],
      [[a, b], null, ['version one\n', 'version two\n']],
      [[null, null], b, ['version two\n', '']],
    ] as const) {
      const h = host();
      const change: FileChange = {
        index: 0,
        status: result ? 'A' : 'D',
        path: 'file',
        before: a,
        after: result,
        mergeParents: [...parents],
      };
      await openMergeDiff(h.vscode, h.context, h.snapshots, root, change);
      assert.equal(h.panels(), 0);
      assert.deepEqual(
        h.diffs[0].slice(1, 3).map((uri) => h.snapshots.get(String(uri))),
        expected,
      );
    }
  }));

test('merge renames read each parent at its actual path', () =>
  repository(async (root, commit) => {
    const original = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    await fs.writeFile(path.join(root, 'old.txt'), original.join('\n') + '\n');
    await commit('base');
    await git(root, ['checkout', '-b', 'topic']);
    await git(root, ['mv', 'old.txt', 'new.txt']);
    const topicLines = [...original];
    topicLines[0] = 'topic';
    await fs.writeFile(path.join(root, 'new.txt'), topicLines.join('\n') + '\n');
    await commit('rename');
    await git(root, ['checkout', 'main']);
    const mainLines = [...original];
    mainLines[29] = 'main';
    await fs.writeFile(path.join(root, 'old.txt'), mainLines.join('\n') + '\n');
    await commit('main edit');
    await git(root, ['merge', '--no-ff', 'topic', '-m', 'merge rename']);
    const selected = await selectionDetails(root, [
      (await git(root, ['rev-parse', 'HEAD'])).trim(),
    ]);
    assert.equal(selected.files.length, 1);
    assert.equal(selected.files[0].status, 'M');
    assert.deepEqual(
      selected.files[0].mergeParents.map((revision) => revision.path),
      ['old.txt', 'new.txt'],
    );
    const h = host();
    await openMergeDiff(h.vscode, h.context, h.snapshots, root, selected.files[0]);
    await h.receive({ type: 'ready' });
    assert.match(h.messages[0].data.contents[0], /^line 0/);
    assert.match(h.messages[0].data.contents[1], /^topic/);
    assert.match(h.messages[0].data.contents[2], /^topic/);
    assert.ok(h.messages[0].data.contents[1].endsWith('main\n'));
  }));

test('merge status intersection retains each source and merges mixed types and rename origins', () => {
  const file = (status: string, path = 'file', oldPath = path) => ({ status, path, oldPath });
  assert.deepEqual(mergeFileStatuses([[file('A', 'one')], [file('M', 'other')]]), []);
  for (const [sources, status] of [
    [[file('A'), file('M')], 'M'],
    [[file('D'), file('M')], 'D'],
    [[file('R', 'file', 'old-a'), file('R', 'file', 'old-b')], 'M'],
    [[file('R', 'file', 'old'), file('R', 'file', 'old')], 'R'],
  ] as const) {
    const merged = mergeFileStatuses(sources.map((source) => [source]))[0];
    assert.equal(merged.status, status);
    assert.deepEqual(merged.sources, sources);
  }
});

test('commit metadata preserves explicit revision order, duplicate revisions, full bodies and author/committer identity', () =>
  repository(async (root, commit) => {
    await fs.writeFile(path.join(root, 'file'), 'one\n');
    const one = await commit('first');
    await fs.writeFile(path.join(root, 'file'), 'two\n');
    await git(root, ['add', '.']);
    await git(
      root,
      [
        'commit',
        '--author=Author <author@example.com>',
        '-m',
        '标题\n\nFull body <script>literal</script>\n\nCo-authored-by: Other <other@example.com>',
      ],
      {
        env: {
          GIT_AUTHOR_DATE: '2026-10-20T10:00:00+08:00',
          GIT_COMMITTER_DATE: '2026-10-21T11:00:00+08:00',
        },
      },
    );
    const two = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const values = await readCommitMetadata(root, [two, one, two]);
    assert.deepEqual(
      values.map((value) => value.hash),
      [two, one, two],
    );
    assert.equal(values[0].author, 'Author');
    assert.equal(values[0].email, 'author@example.com');
    assert.equal(values[0].committer, 'Test');
    assert.equal(values[0].committerEmail, 'test@example.com');
    assert.equal(values[0].authorDate, '2026-10-20T10:00:00+08:00');
    assert.equal(values[0].date, '2026-10-21T11:00:00+08:00');
    assert.equal(
      values[0].message,
      '标题\n\nFull body <script>literal</script>\n\nCo-authored-by: Other <other@example.com>',
    );
    assert.deepEqual(await readCommitHoverStats(root, one), {
      files: 1,
      insertions: 1,
      deletions: 0,
    });
    assert.deepEqual(await readCommitHoverStats(root, two), {
      files: 1,
      insertions: 1,
      deletions: 1,
    });
    await assert.rejects(readCommitHoverStats(root, 'HEAD'), /Invalid commit/);
    assert.deepEqual(await readCommitMetadata(root, []), []);
    await assert.rejects(readCommitMetadata(root, ['HEAD']), /Invalid commit/);
  }));
