import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogControllerHarness } from './helpers/log-controller';
import { receiveLogMessage } from '../src/webview/log/messages';

const fixture = (hash: string) => ({ hash, parents: [], subject: hash, decorations: '' });

test('loaded branch navigation preserves the graph and ignores obsolete destinations', async () => {
  const h = createLogControllerHarness();
  const commits = Array.from({ length: 100 }, (_, i) => fixture('a' + i));
  h.set({ root: '/repository', commits, ref: 'refs/heads/main', selected: new Set(['a0']) });
  h.start();
  try {
    h.ctx.actions.history.refreshCoordinator.reset('/repository');
    h.ctx.actions.commits.navigateBranchHead('refs/heads/topic');
    const requestId = h.store.getState().historyRequest;
    const located = {
      type: 'branchLocated' as const,
      root: '/repository',
      requestId,
      repositoryVersion: 0,
      target: 'a70',
    };
    receiveLogMessage(h.ctx, { ...located, requestId: requestId - 1 });
    receiveLogMessage(h.ctx, { ...located, root: '/other-repository' });
    assert.equal(h.store.getState().historyLoading, true);
    assert.deepEqual([...h.store.getState().selected], ['a0']);
    h.ctx.actions.history.refreshCoordinator.changed({ root: '/repository', version: 2 });
    receiveLogMessage(h.ctx, located);
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.equal(h.store.getState().historyLoading, false);
    assert.equal(
      h.store.getState().updatesAvailable,
      true,
      'navigation does not acknowledge unseen updates',
    );
    assert.equal(h.store.getState().commits, commits, 'retain the current graph data');
    assert.equal(h.store.getState().ref, 'refs/heads/main');
    assert.deepEqual([...h.store.getState().selected], ['a70']);
    assert.deepEqual(h.detailRequests, ['a70']);
    assert.equal(h.list.scrollTop, 70 * 24 - (48 - 24) / 2);
    assert.equal(h.messages.length, 1, 'no history request after receiving the destination');
  } finally {
    await h.dispose();
  }
});

test('range selection preserves rows, scroll and anchor without rebuilding graph', async () => {
  const h = createLogControllerHarness();
  let graphRenders = 0;
  const makeGraph = h.ctx.actions.graph.graphCell;
  h.ctx.actions.graph.graphCell = (...args) => {
    graphRenders++;
    return makeGraph(...args);
  };
  h.set({ commits: ['a', 'b', 'c', 'd'].map(fixture) });
  h.start();
  try {
    const rows = [...h.list.querySelectorAll<HTMLElement>('.commit')];
    const focusOptions = new Map();
    for (const row of rows) {
      const focus = row.focus.bind(row);
      row.focus = (options) => {
        focusOptions.set(row, options);
        focus(options);
      };
    }
    h.list.scrollTop = 480;
    const { select } = h.ctx.actions.commits;
    const commits = h.store.getState().commits;
    select(commits[1]);
    const previousSelection = h.store.getState().selected;
    select(commits[3], { shiftKey: true });
    assert.deepEqual(
      [...previousSelection],
      ['b'],
      'store updates do not mutate earlier snapshots',
    );
    assert.deepEqual(
      rows.map((row) => row.getAttribute('aria-selected')),
      ['false', 'true', 'true', 'true'],
    );
    assert.equal(h.list.scrollTop, 480);
    assert.equal(focusOptions.get(rows[3]).preventScroll, true);
    assert.equal(h.document.activeElement, rows[3]);
    select(commits[2], { shiftKey: true });
    assert.deepEqual(
      rows.map((row) => row.classList.contains('selected')),
      [false, true, true, false],
    );
    assert.equal(h.store.getState().selected.size, 2);
    const before = h.detailRequests.length;
    select(commits[2], { shiftKey: true });
    assert.equal(h.detailRequests.length, before);
    select(commits[0], { metaKey: true });
    assert.deepEqual(
      rows.map((row) => row.classList.contains('selected')),
      [true, true, true, false],
    );
    assert.equal(graphRenders, 4);
    assert.deepEqual([...h.list.querySelectorAll('.commit')], rows);
  } finally {
    await h.dispose();
  }
});

test('jump requests an absent parent then selects and centers its loaded row', async () => {
  const h = createLogControllerHarness();
  h.set({ ref: 'refs/heads/main' });
  h.start();
  try {
    const c = h.ctx.actions.commits;
    c.jumpToCommit('parent');
    assert.equal(h.messages[0].type, 'graphJump');
    assert.equal(h.messages[0].target, 'parent');
    assert.equal(h.messages[0].ref, 'refs/heads/main');
    h.set({
      commits: Array.from({ length: 100 }, (_, i) => fixture(i === 70 ? 'parent' : 'a' + i)),
    });
    c.jumpToCommit('parent');
    assert.deepEqual([...h.store.getState().selected], ['parent']);
    assert.equal(h.list.scrollTop, 70 * 24 - (48 - 24) / 2);
    assert.equal(h.messages.length, 1);
    c.navigateBranchHead('refs/remotes/origin/topic');
    assert.equal(h.messages[1].type, 'branchJump');
    assert.equal(h.messages[1].branchRef, 'refs/remotes/origin/topic');
    assert.equal(h.messages[1].ref, 'refs/heads/main', 'navigation preserves filters initially');
    c.navigateToRevision('parent');
    assert.equal(h.messages.length, 2, 'loaded destination does not reload history');
    c.navigateToRevision('unloaded');
    assert.equal(h.messages[2].type, 'revisionJump');
    assert.equal(h.messages[2].target, 'unloaded');
    assert.equal(h.messages[2].ref, 'refs/heads/main');
    h.set({ selected: new Set() });
    c.finishGraphJump({ target: 'parent', requestId: 0 });
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.equal(h.store.getState().selected.size, 0, 'ignore outdated navigation');
    c.finishGraphJump({ target: 'parent', requestId: h.store.getState().historyRequest });
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.deepEqual([...h.store.getState().selected], ['parent']);
    assert.equal(h.list.scrollTop, 70 * 24 - (48 - 24) / 2);
  } finally {
    await h.dispose();
  }
});
