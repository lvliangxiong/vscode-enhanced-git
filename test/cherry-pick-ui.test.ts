import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushSync } from 'react-dom';
import { createBranchControllerFixture } from './helpers/branch-controller';
import { createToolbarController } from '../src/webview/log/toolbar';

test('menu and toolbar share the current selection, disable merge commits, and expose sequence recovery', async () => {
  const fixture = createBranchControllerFixture({
    commits: [
      { hash: 'new', parents: ['old'] },
      { hash: 'middle', parents: ['old'] },
      { hash: 'old', parents: [] },
    ],
    selected: new Set(['old', 'new']),
  });
  const { ctx, store, set, document, messages } = fixture;
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  ctx.actions.toolbar = createToolbarController(ctx);
  try {
    flushSync(() => ctx.actions.toolbar.start());
    const button = document.getElementById('cherry-pick') as HTMLButtonElement;
    const click = () => flushSync(() => button.click());
    assert.equal(button.disabled, false);
    ctx.actions.branches.openCommitMenu(store.getState().commits[0], 0, 0);
    const menuAction = [
      ...document.querySelectorAll<HTMLButtonElement>('#branch-menu button'),
    ].find((item) => item.textContent === 'Cherry-pick');
    flushSync(() => menuAction.click());
    assert.deepEqual(messages.pop(), {
      type: 'commitAction',
      action: 'cherry-pick',
      hashes: ['new', 'old'],
    });
    assert.equal(button.disabled, true, 'prevent duplicate clicks until host response');
    click();
    assert.equal(messages.length, 0);
    set({ cherryPickBusy: false });
    click();
    assert.deepEqual(messages.pop(), {
      type: 'commitAction',
      action: 'cherry-pick',
      hashes: ['new', 'old'],
    });
    set({
      cherryPickBusy: false,
      commits: store
        .getState()
        .commits.map((commit, index) =>
          index === 0 ? { ...commit, parents: ['a', 'b'] } : commit,
        ),
    });
    assert.equal(button.disabled, true);
    click();
    assert.equal(messages.length, 0);
    set({ selected: new Set(), cherryPickInProgress: true });
    assert.equal(button.disabled, false, 'recovery does not require a visible selected commit');
    click();
    assert.deepEqual(messages.pop(), { type: 'commitAction', action: 'cherry-pick', hashes: [] });
  } finally {
    ctx.actions.toolbar.dispose();
    await fixture.dispose();
    if (prior) Object.defineProperty(globalThis, 'ResizeObserver', prior);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});
