import { createBranchState } from '../src/webview/state/branches';
import { createLogStore } from '../src/webview/state/log';
import { receiveLogMessage, type HistoryMessage } from '../src/webview/log/messages';
import type { LogContext } from '../src/webview/log/context';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function routerHarness() {
  const store = createLogStore();
  const loads: unknown[] = [];
  const ctx = {
    store,
    branchState: createBranchState(store),
    env: {
      scriptStarted: 0,
      scope: {},
      window: { requestAnimationFrame() {} },
      setStatus(status) {
        store.setState({ status });
      },
    },
    lifetime: { disposed: false },
    actions: {
      history: {
        load() {
          loads.push(store.getState().ref);
        },
        refValues() {
          const r = store.getState().ref;
          return Array.isArray(r) ? r : r ? [r] : [];
        },
        saveGraphSettings() {},
        refreshCoordinator: { finish() {} },
      },
      branches: { requestDetails() {} },
      commits: { finishGraphJump() {} },
    },
  } as unknown as LogContext;
  return { ctx, store, loads, receive: (data) => receiveLogMessage(ctx, data) };
}
test('incremental history refreshes branch badges and cannot overwrite a newer branch snapshot', () => {
  const h = routerHarness();
  const renders: unknown[][] = [];
  const graphSnapshots: unknown[] = [];
  h.store.setState({
    commits: [{ hash: 'a', parents: [] }],
    selected: new Set(['a']),
    historyRequest: 1,
  });
  h.store.subscribe((next, prev) => {
    if (next.branches !== prev.branches)
      renders.push(next.branches.map((b) => [b.name, b.behind, b.ahead]));
    if (next.commits !== prev.commits) graphSnapshots.push(next.commits);
  });
  const snapshot = (version: number, behind: number, ahead = 0): HistoryMessage => ({
    type: 'data',
    requestId: 1,
    repositoryVersion: version,
    append: true,
    branches: [{ name: 'main', ref: 'refs/heads/main', group: 'Local', behind, ahead }],
    commits: [
      { hash: 'a', parents: [] },
      { hash: 'b', parents: [] },
    ],
    headHashes: [],
    favorites: [],
  });
  h.receive(snapshot(0, 120));
  h.receive(snapshot(1, 0));
  assert.equal(renders.length, 2, 'append responses publish changed badges');
  assert.equal(renders.at(-1)[0][1], 0);
  assert.equal(
    graphSnapshots.length,
    2,
    'history changes remain visible to the viewport subscriber',
  );
  h.receive(snapshot(1, 0));
  assert.equal(renders.length, 2, 'identical branches preserve their snapshot identity');
  h.ctx.branchState.applySnapshot({
    repositoryVersion: 1,
    branchSnapshotKey: 'same',
    favorites: [],
  });
  assert.equal(renders.length, 2);
  assert.equal(h.store.getState().branches[0].name, 'main');
  assert.equal(h.store.getState().snapshotKey, 'same');
  h.ctx.branchState.applySnapshot(snapshot(3, 0, 2));
  h.receive(snapshot(2, 120));
  assert.equal(renders.length, 3, 'stale history cannot restore incoming badge');
  h.ctx.branchState.applySnapshot(snapshot(4, 0));
  assert.equal(renders.at(-1)[0][2], 0, 'push clears outgoing badge independently');
  h.ctx.branchState.applySnapshot({ repositoryVersion: 5, branches: [] });
  assert.equal(renders.at(-1).length, 0);
});
test('non-checkout branch operations preserve the existing branch filter', () => {
  for (const ref of ['refs/heads/topic', ['refs/heads/topic', 'refs/heads/main']])
    for (const action of ['update', 'push', 'fetch', 'create']) {
      const h = routerHarness();
      h.store.setState({ ref });
      h.receive({ type: 'operation', action, message: 'Done' });
      assert.equal(h.store.getState().ref, ref);
      assert.deepEqual(h.loads, [ref]);
      h.receive({ type: 'operation', action: 'checkout', message: 'Done' });
      assert.equal(h.store.getState().ref, '');
    }
});
