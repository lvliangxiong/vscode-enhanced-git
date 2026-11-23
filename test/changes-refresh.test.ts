import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { ChangesView } = require('../out/extension/views/changes-view');
const {
  git,
  branchFiles,
  commitLocalFiles,
  selectionDetails,
} = require('../out/extension/git/index');
function fixture() {
  const commands = new Map(),
    contexts = new Map(),
    messages = [],
    errors = [],
    contextCalls = [],
    focus = [],
    calls = [],
    snapshots = new Map();
  const vscode = {
    Uri: {
      from: (value) => ({
        ...value,
        toString: () => `${value.scheme}:${value.path}?${value.query}`,
      }),
    },
    commands: {
      registerCommand: (name, fn) => commands.set(name, fn),
      executeCommand: async (name, ...args) => {
        calls.push([name, ...args]);
        if (name === 'setContext') {
          contexts.set(args[0], args[1]);
          contextCalls.push(args);
        } else focus.push(name);
      },
    },
    window: { showErrorMessage: async (message) => errors.push(message) },
  };
  const view = new ChangesView(vscode, { subscriptions: [] }, snapshots);
  view.view = { webview: { postMessage: async (message) => messages.push(message) } };
  view.ready = true;
  return {
    view,
    contexts,
    messages,
    errors,
    focus,
    contextCalls,
    commands,
    calls,
    snapshots,
    reset: () => commands.get('vsgit.changes.reset')(),
    refresh: () => commands.get('vsgit.changes.refresh')(),
  };
}
test('refresh rereads branch tips and working tree without focusing or replacing the view', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-refresh-comparison-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Fixture']);
    await git(root, ['config', 'user.email', 'fixture@example.com']);
    const commit = async (message) => {
      await git(root, ['add', '.']);
      await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
    };
    await fs.writeFile(path.join(root, 'base.txt'), 'base');
    await commit('base');
    await git(root, ['branch', 'other']);
    const f = fixture();
    await f.refresh();
    assert.equal(f.messages.length, 0);
    await f.view.show(root, () => branchFiles(root, ['refs/heads/other', 'refs/heads/main']));
    const old = f.view.comparison;
    await fs.writeFile(path.join(root, 'new.txt'), 'new');
    await commit('new');
    await f.refresh();
    assert.equal(f.view.comparison.files[0].path, 'new.txt');
    assert.notEqual(f.view.comparison.pair[1].hash, old.pair[1].hash);
    assert.equal(f.messages.at(-1).previousId, old.id);
    assert.notEqual(f.view.comparison.id, old.id);
    assert.deepEqual(f.focus, ['vsgit.changes.focus']);
    const hash = f.view.comparison.pair[1].hash;
    await f.view.show(root, () => commitLocalFiles(root, hash));
    await fs.writeFile(path.join(root, 'base.txt'), 'working tree edit');
    await f.refresh();
    assert.equal(f.view.comparison.files[0].path, 'base.txt');
    assert.equal(f.view.comparison.files[0].after.workingTree, true);
    assert.equal(f.contexts.get('vsgit.changes.refreshing'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('reset clears the comparison and ignores an in-flight refresh or new comparison', async () => {
  const f = fixture(),
    result = { pair: [{ name: 'a' }, { name: 'b' }], files: [] };
  await f.view.show('/repo', async () => result);
  let finish;
  f.view.loadComparison = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pendingRefresh = f.refresh();
  await new Promise(setImmediate);
  await f.reset();
  const cleared = f.messages.at(-1);
  assert.equal(cleared.type, 'branchChanges');
  assert.equal(cleared.pair, undefined);
  assert.equal(f.view.view.description, undefined);
  assert.equal(f.view.loadComparison, undefined);
  assert.equal(f.contexts.get('vsgit.changes.hasComparison'), false);
  assert.equal(f.contexts.get('vsgit.changes.refreshing'), false);
  finish(result);
  await pendingRefresh;
  await f.refresh();
  assert.equal(f.messages.at(-1), cleared);
  assert.equal(f.view.comparison, undefined);
  const pendingShow = f.view.show(
    '/repo',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await new Promise(setImmediate);
  await f.reset();
  finish(result);
  await pendingShow;
  assert.equal(f.view.comparison, undefined);
  assert.deepEqual(f.focus, ['vsgit.changes.focus']);
});

test('a stale refresh cannot clear the busy state of a newer refresh after reset', async () => {
  const f = fixture(),
    result = { pair: [{ name: 'a' }, { name: 'b' }], files: [] };
  await f.view.show('/old', async () => result);
  let failOld, finishNew;
  f.view.loadComparison = () =>
    new Promise((_resolve, reject) => {
      failOld = reject;
    });
  const old = f.refresh();
  await new Promise(setImmediate);
  await f.reset();
  await f.view.show('/new', async () => result);
  f.view.loadComparison = () =>
    new Promise((resolve) => {
      finishNew = resolve;
    });
  const current = f.refresh();
  await new Promise(setImmediate);
  failOld(Error('stale failure'));
  await old;
  assert.equal(f.contexts.get('vsgit.changes.refreshing'), true);
  assert.deepEqual(f.errors, []);
  finishNew(result);
  await current;
  assert.equal(f.view.comparison.root, '/new');
  assert.equal(f.contexts.get('vsgit.changes.refreshing'), false);
});

test('expansion changes only its context and does not wait for remote context updates', async () => {
  const f = fixture();
  let reads = 0;
  await f.view.show('/repo', async () => {
    reads++;
    return { pair: [{ name: 'a' }, { name: 'b' }], files: [] };
  });
  f.view.hasFolders = true;
  await f.view.updateContexts();
  f.contextCalls.length = 0;
  await f.view.updateContexts();
  assert.equal(f.contextCalls.length, 0);
  let finishContext;
  f.view.vscode.commands.executeCommand = () =>
    new Promise((resolve) => {
      finishContext = resolve;
    });
  const pending = f.commands.get('vsgit.changes.toggleExpansion')();
  assert.deepEqual(f.messages.at(-1), {
    type: 'comparisonAction',
    action: 'expansion',
    expanded: true,
  });
  finishContext();
  await pending;
  assert.equal(reads, 1);
});
test('refresh deduplicates clicks, ignores replaced comparisons, and preserves results on failure', async () => {
  const f = fixture(),
    result = { pair: [{ name: 'a' }, { name: 'b' }], files: [] };
  let calls = 0,
    finish;
  await f.view.show('/first', async () => {
    calls++;
    return calls === 1
      ? result
      : await new Promise((resolve) => {
          finish = resolve;
        });
  });
  const pending = f.refresh();
  await new Promise(setImmediate);
  await f.refresh();
  assert.equal(calls, 2);
  await f.view.show('/second', async () => result);
  const second = f.view.comparison;
  finish(result);
  await pending;
  assert.equal(f.view.comparison, second);
  f.view.loadComparison = async () => {
    throw Error('branch missing');
  };
  await f.refresh();
  assert.equal(f.view.comparison, second);
  assert.deepEqual(f.errors, ['VS Git: branch missing']);
  assert.equal(f.contexts.get('vsgit.changes.refreshing'), false);
});

test('selection sidebar retains fixed commits and opens actual per-file revisions across gaps and renames', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-sidebar-selection-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Fixture']);
    await git(root, ['config', 'user.email', 'fixture@example.com']);
    const commit = async (subject: string) => {
      await git(root, ['add', '.']);
      await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', subject]);
      return (await git(root, ['rev-parse', 'HEAD'])).trim();
    };
    await fs.writeFile(path.join(root, 'old.txt'), 'original\n');
    await fs.writeFile(path.join(root, 'gone.txt'), 'deleted later\n');
    const base = await commit('base');
    await git(root, ['mv', 'old.txt', 'renamed.txt']);
    const first = await commit('rename');
    await fs.writeFile(path.join(root, 'renamed.txt'), 'not selected\n');
    await fs.writeFile(path.join(root, 'unselected.txt'), 'not selected\n');
    await commit('gap');
    await fs.writeFile(path.join(root, 'last.txt'), 'selected addition\n');
    await fs.unlink(path.join(root, 'gone.txt'));
    const last = await commit('selected addition and deletion');
    const hashes = [last, first],
      f = fixture();
    let loads = 0;
    await f.view.show(root, async () => {
      loads++;
      const selection = await selectionDetails(root, hashes);
      return {
        kind: 'selection',
        commits: selection.items.map((item) => ({ hash: item.hash, subject: item.message })),
        files: selection.files,
      };
    });
    const initial = f.view.comparison;
    assert.equal(f.view.view.description, `${initial.files.length} files`);
    assert.equal(f.messages.at(-1).type, 'selectionChanges');
    assert.equal(f.messages.at(-1).pair, undefined);
    assert.deepEqual(
      initial.commits.map((commit) => commit.hash),
      hashes,
    );
    assert.equal(
      initial.files.some((file) => file.path === 'unselected.txt'),
      false,
    );
    const renamed = initial.files.find((file) => file.path === 'renamed.txt');
    await f.view.openFile({ id: initial.id, index: renamed.index });
    const diff = f.calls.at(-1);
    assert.equal(diff[0], 'vscode.diff');
    assert.equal(diff[1].path, '/old.txt');
    assert.equal(diff[2].path, '/renamed.txt');
    assert.equal(f.snapshots.get(diff[1].toString()), 'original\n');
    assert.equal(f.snapshots.get(diff[2].toString()), 'original\n');
    assert.equal(diff[3], `old.txt → renamed.txt (${base.slice(0, 8)} ↔ ${first.slice(0, 8)})`);
    const added = initial.files.find((file) => file.path === 'last.txt');
    await f.view.openFile({ id: initial.id, index: added.index });
    const addedDiff = f.calls.at(-1);
    assert.equal(f.snapshots.get(addedDiff[1].toString()), '');
    assert.equal(f.snapshots.get(addedDiff[2].toString()), 'selected addition\n');
    assert.equal(addedDiff[3], `last.txt (Absent ↔ ${last.slice(0, 8)})`);
    const deleted = initial.files.find((file) => file.path === 'gone.txt');
    await f.view.openFile({ id: initial.id, index: deleted.index });
    const deletedDiff = f.calls.at(-1);
    assert.equal(f.snapshots.get(deletedDiff[1].toString()), 'deleted later\n');
    assert.equal(f.snapshots.get(deletedDiff[2].toString()), '');
    assert.ok(deletedDiff[3].endsWith(' ↔ Absent)'));

    await fs.writeFile(path.join(root, 'last.txt'), 'new branch tip\n');
    await commit('after selection');
    await f.refresh();
    assert.equal(loads, 2);
    assert.deepEqual(
      f.view.comparison.commits.map((commit) => commit.hash),
      hashes,
    );
    assert.deepEqual(f.view.comparison.files, initial.files);
    assert.equal(f.messages.at(-1).previousId, initial.id);
    const calls = f.calls.length;
    await f.view.openFile({ id: initial.id, index: renamed.index });
    assert.equal(f.calls.length, calls, 'stale selection clicks are ignored after refresh');
    await f.reset();
    assert.equal(f.messages.at(-1).type, 'branchChanges');
    assert.equal(f.messages.at(-1).commits, undefined);
    assert.equal(f.contexts.get('vsgit.changes.hasComparison'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
