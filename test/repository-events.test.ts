import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createRepositoryEvents } = require('../out/extension/repositories/events');
import { create } from '../src/webview/history-refresh';
function emitter() {
  const listeners = new Set<(value?: unknown) => void>();
  return {
    event: (fn: (value?: unknown) => void) => {
      listeners.add(fn);
      return { dispose: () => listeners.delete(fn) };
    },
    fire: (arg?: unknown) => listeners.forEach((fn) => fn(arg)),
    get size() {
      return listeners.size;
    },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
test('CLI operations invalidate every subscriber even without the built-in Git extension', async () => {
  const monitor = createRepositoryEvents({ extensions: {} });
  await monitor.ready;
  const first = [],
    second = [];
  monitor.subscribe((event) => first.push(event));
  const subscription = monitor.subscribe((event) => second.push(event));
  monitor.invalidate('/repo');
  assert.equal(monitor.version('/repo'), 1);
  assert.deepEqual(first, [{ root: '/repo', version: 1 }]);
  assert.deepEqual(second, first);
  subscription.dispose();
  monitor.invalidate('/repo');
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  monitor.dispose();
  monitor.invalidate('/repo');
  assert.equal(first.length, 2);
});
test('public Git events ignore working files/ref ordering, coalesce changes, and dispose repository subscriptions', async () => {
  const change = emitter(),
    open = emitter(),
    close = emitter(),
    enabled = emitter();
  const repo = {
    rootUri: { fsPath: '/repo' },
    state: {
      HEAD: { name: 'main', commit: 'a' } as { name: string; commit: string; ahead?: number },
      workingTreeChanges: [] as { path: string }[],
      refs: [
        { name: 'main', commit: 'a' },
        { name: 'tag', commit: 'b' },
      ],
      onDidChange: change.event,
    },
  };
  const api = {
    repositories: [repo],
    onDidOpenRepository: open.event,
    onDidCloseRepository: close.event,
  };
  const git = { enabled: true, getAPI: () => api, onDidChangeEnablement: enabled.event };
  const monitor = createRepositoryEvents(
    { extensions: { getExtension: () => ({ activate: async () => git }) } },
    assert.fail,
    5,
  );
  const events = [];
  monitor.subscribe((event) => events.push(event));
  await monitor.ready;
  repo.state.workingTreeChanges = [{ path: 'x' }];
  repo.state.refs.reverse();
  change.fire();
  await tick();
  assert.equal(events.length, 0);
  repo.state.refs.push({ name: 'origin/main', commit: 'c' });
  change.fire();
  repo.state.HEAD = { name: 'main', commit: 'c', ahead: 1 };
  change.fire();
  await tick();
  assert.deepEqual(events, [{ root: '/repo', version: 2 }]);
  close.fire(repo);
  assert.equal(change.size, 0);
  open.fire(repo);
  assert.equal(change.size, 1);
  git.enabled = false;
  enabled.fire();
  assert.equal(change.size, 0);
  git.enabled = true;
  enabled.fire();
  assert.equal(change.size, 1);
  repo.state.HEAD.commit = 'd';
  change.fire();
  monitor.dispose();
  await tick();
  assert.equal(events.length, 1);
  assert.equal(change.size, 0);
  assert.equal(open.size, 0);
  assert.equal(enabled.size, 0);
});
test('Git activation may finish after disposal or be unavailable', async () => {
  let resolve;
  const enabled = emitter();
  const monitor = createRepositoryEvents({
    extensions: { getExtension: () => ({ activate: () => new Promise((r) => (resolve = r)) }) },
  });
  monitor.dispose();
  resolve({ onDidChangeEnablement: enabled.event });
  await monitor.ready;
  assert.equal(enabled.size, 0);
  await createRepositoryEvents({ extensions: {} }).ready;
});
test('top refreshes once; history browsing defers and in-flight changes are not lost', async () => {
  let top = true,
    visible = true,
    loads = 0,
    indicator = false;
  const controller = create({
    canRefresh: () => top && visible,
    refresh: () => {
      loads++;
      controller.begin();
    },
    indicate: (value) => (indicator = value),
  });
  controller.reset('/repo');
  controller.begin();
  controller.finish({ root: '/repo', repositoryVersion: 0 });
  controller.changed({ root: '/other', version: 10 });
  await Promise.resolve();
  assert.equal(loads, 0);
  controller.changed({ root: '/repo', version: 1 });
  controller.changed({ root: '/repo', version: 2 });
  await Promise.resolve();
  assert.equal(loads, 1);
  controller.changed({ root: '/repo', version: 3 });
  controller.finish({ root: '/repo', repositoryVersion: 2 });
  await Promise.resolve();
  assert.equal(loads, 2);
  controller.finish({ root: '/repo', repositoryVersion: 3 });
  assert.equal(indicator, false);
  top = false;
  controller.changed({ root: '/repo', version: 4 });
  await Promise.resolve();
  assert.equal(loads, 2);
  assert.equal(indicator, true);
  top = true;
  visible = false;
  controller.check();
  await Promise.resolve();
  assert.equal(loads, 2);
  visible = true;
  controller.check();
  await Promise.resolve();
  assert.equal(loads, 3);
  controller.error();
  controller.check();
  await Promise.resolve();
  assert.equal(loads, 3, 'do not retry failed queries in a loop');
  controller.begin();
  controller.finish({ root: '/repo', repositoryVersion: 4 });
  assert.equal(indicator, false);
  controller.reset('/other');
  controller.changed({ root: '/repo', version: 5 });
  await Promise.resolve();
  assert.equal(loads, 3);
});
test('already refreshed version and stale responses do not refresh again', async () => {
  let loads = 0;
  const controller = create({ canRefresh: () => true, refresh: () => loads++, indicate: () => {} });
  controller.reset('/repo');
  controller.begin();
  controller.finish({ root: '/repo', repositoryVersion: 5 });
  controller.changed({ root: '/repo', version: 5 });
  await Promise.resolve();
  assert.equal(loads, 0);
  controller.reset('/other');
  controller.begin();
  controller.changed({ root: '/other', version: 1 });
  controller.finish({ root: '/repo', repositoryVersion: 20 });
  await Promise.resolve();
  assert.equal(loads, 0);
  controller.finish({ root: '/other', repositoryVersion: 1 });
  await Promise.resolve();
  assert.equal(loads, 0);
});

test('symlink workspace paths share version and event identity with git canonical root', async () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-enhanced-git-events-'));
  try {
    fs.mkdirSync(path.join(base, 'real'));
    fs.symlinkSync(path.join(base, 'real'), path.join(base, 'alias'));
    const change = emitter(),
      open = emitter(),
      close = emitter(),
      enabled = emitter();
    const repo = {
      rootUri: { fsPath: path.join(base, 'alias') },
      state: { HEAD: { commit: 'a' }, refs: [], onDidChange: change.event },
    };
    const api = {
      repositories: [repo],
      onDidOpenRepository: open.event,
      onDidCloseRepository: close.event,
    };
    const monitor = createRepositoryEvents(
      {
        extensions: {
          getExtension: () => ({
            activate: async () => ({
              enabled: true,
              getAPI: () => api,
              onDidChangeEnablement: enabled.event,
            }),
          }),
        },
      },
      assert.fail,
      5,
    );
    await monitor.ready;
    const real = fs.realpathSync(path.join(base, 'real'));
    assert.ok(monitor.matches(repo.rootUri.fsPath, real));
    repo.state.HEAD.commit = 'b';
    change.fire();
    assert.equal(monitor.version(real), 1);
    monitor.dispose();
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('disposed refresh coordinators discard queued refreshes and late notifications', async () => {
  let loads = 0,
    indications = 0;
  const controller = create({
    canRefresh: () => true,
    refresh: () => loads++,
    indicate: () => indications++,
  });
  controller.reset('/repo');
  controller.changed({ root: '/repo', version: 1 });
  controller.dispose();
  const before = indications;
  controller.changed({ root: '/repo', version: 2 });
  controller.finish({ root: '/repo', repositoryVersion: 1 });
  controller.error();
  controller.check();
  await Promise.resolve();
  assert.equal(loads, 0);
  assert.equal(indications, before);
});
