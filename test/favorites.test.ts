import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createBranchControllerFixture } from './helpers/branch-controller';
import { createFiltersController } from '../src/webview/log/filters';
import { FilterSurface } from '../src/webview/react/filter-surface';
import { createRepositoryFavorites } from '../src/extension/repositories/favorites';
import { git } from '../src/extension/git/client';

test('favorites merge concurrent pane changes, broadcast saved revisions and recover after failed saves', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-favorites-'));
  const persisted = new Map<string, string[]>();
  let failSave = false;
  const favorites = createRepositoryFavorites({
    keys: () => [...persisted.keys()],
    get: (key, fallback) => persisted.get(key) ?? fallback,
    async update(key, value) {
      if (failSave) throw Error('Save failed');
      persisted.set(key, value);
    },
  } as any);
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'base',
    ]);
    for (const branch of ['one', 'two']) await git(root, ['branch', branch]);
    const events: any[] = [];
    const listener = favorites.subscribe((root, snapshot) => events.push({ root, ...snapshot }));
    await Promise.all([
      favorites.update(root, [{ ref: 'refs/heads/one', marked: true }]),
      favorites.update(root, [{ ref: 'refs/heads/two', marked: true }]),
    ]);
    assert.deepEqual(favorites.get(root).favorites, [
      'refs/heads/main',
      'refs/heads/one',
      'refs/heads/two',
    ]);
    assert.deepEqual(
      events.map((event) => event.favoriteVersion),
      [1, 2],
    );
    await Promise.all([
      favorites.update(root, [{ ref: 'HEAD', marked: true }]),
      favorites.update(root, [{ ref: 'HEAD', marked: false }]),
    ]);
    assert.equal(favorites.get(root).favorites.includes('HEAD'), false);
    const saved = favorites.get(root);
    failSave = true;
    await assert.rejects(
      favorites.update(root, [{ ref: 'refs/heads/one', marked: false }]),
      /Save failed/,
    );
    assert.equal(favorites.get(root), saved);
    assert.equal(events.length, 4);
    failSave = false;
    await favorites.update(root, [{ ref: 'refs/heads/one', marked: false }]);
    assert.equal(favorites.get(root).favoriteVersion, 5);
    assert.equal(favorites.get(root).favorites.includes('refs/heads/one'), false);
    assert.deepEqual(
      createRepositoryFavorites({
        get: (key, fallback) => persisted.get(key) ?? fallback,
      } as any).get(root).favorites,
      favorites.get(root).favorites,
    );
    assert.equal(favorites.get(root + '-other').favorites, null);
    listener.dispose();
    await favorites.update(root, [{ ref: 'HEAD', marked: true }]);
    assert.equal(events.length, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('optimistic favorites update both views immediately and survive stale history and earlier acknowledgments', async () => {
  const fixture = createBranchControllerFixture({
    branches: [
      { name: 'main', ref: 'main', group: 'Local' },
      { name: 'topic', ref: 'topic', group: 'Local' },
    ],
  });
  const { ctx, store, ui, document, messages } = fixture;
  Object.defineProperty(fixture.window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  ctx.actions.filters = createFiltersController(ctx);
  ctx.actions.filters.start();
  flushSync(() =>
    ui.setSlots({
      filter: createElement(FilterSurface, { controller: ctx.actions.filters.surface }),
    }),
  );
  const values = () => [...store.getState().favorites];
  const apply = (data: Parameters<typeof ctx.branchState.applyFavorites>[0]) =>
    flushSync(() => ctx.branchState.applyFavorites(data));
  const toggle = () => flushSync(() => ctx.actions.branchTools.toggleBranchFavorites(['topic']));
  try {
    apply({ favorites: [], favoriteVersion: 0 });
    flushSync(() =>
      ctx.actions.filters.openFilter('branch', document.getElementById('filter-branch')),
    );
    toggle();
    assert.deepEqual(values(), ['topic']);
    assert.equal(
      document.querySelectorAll('#branches [data-ref="topic"]').length,
      1,
      'marking a branch keeps a single row in its original group',
    );
    assert.ok(
      document.querySelector('#branches [data-ref="topic"] .rebased-star'),
      'the original branch row immediately displays its star',
    );
    assert.match(
      document.getElementById('filter-popup').textContent,
      /topic/,
      'the open Branch menu receives the same optimistic update',
    );
    apply({ favorites: [], favoriteVersion: 0 });
    assert.deepEqual(values(), ['topic'], 'an in-flight history response must not undo the star');
    toggle();
    apply({ favorites: ['topic'], favoriteVersion: 1, favoriteAck: messages[0].favoriteRequest });
    assert.deepEqual(values(), [], 'first acknowledgment preserves later unmark intent');
    apply({ favorites: ['main'], favoriteVersion: 3 });
    apply({ favorites: [], favoriteVersion: 2, favoriteAck: messages[1].favoriteRequest });
    assert.deepEqual(values(), ['main'], 'older acknowledgment cannot undo another pane update');
    toggle();
    apply({ favorites: ['main'], favoriteVersion: 3, favoriteAck: messages[2].favoriteRequest });
    assert.deepEqual(
      values(),
      ['main'],
      'failed save acknowledgment rolls optimistic changes back',
    );
  } finally {
    ctx.actions.filters.dispose();
    await fixture.dispose();
  }
});
