import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createBranchControllerFixture } from './helpers/branch-controller';
import { createFiltersController } from '../src/webview/log/filters';
import { FilterSurface } from '../src/webview/react/filter-surface';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('path filter controller validates replies and registers mounted theme icons through the real session boundary', async () => {
  const f = createBranchControllerFixture({ root: '/repo' });
  Object.defineProperty(f.window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  f.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  const icons: { node: HTMLElement; path: string }[] = [];
  f.ctx.env.themedFileIcons.set = (node, path) => {
    icons.push({ node, path });
    node.dataset.themePath = path;
    return node;
  };
  const filters = createFiltersController(f.ctx);
  f.ctx.actions.filters = filters;
  filters.start();
  flushSync(() =>
    f.ui.setSlots({ filter: createElement(FilterSurface, { controller: filters.surface }) }),
  );
  const open = async () => {
    filters.openFilter('paths', f.document.getElementById('filter-paths')!);
    const tree = [...f.document.querySelectorAll<HTMLElement>('.filter-menu-item')].find(
      (node) => node.textContent === 'Select in Tree…',
    )!;
    flushSync(() => tree.click());
    await settle();
    return Number(f.messages.filter((message) => message.type === 'pathChildren').at(-1)?.request);
  };
  try {
    const request = await open();
    filters.receivePath({ request, items: [{ name: 'a.ts', path: 'src/a.ts', directory: false }] });
    await settle();
    assert.ok(icons.some(({ node, path }) => path === 'src/a.ts' && node.isConnected));
    const stale = filters.surface.host.pathChildren('removed/');
    const staleRequest = Number(f.messages.at(-1)?.request);
    filters.closeFilter();
    filters.receivePath({ request: staleRequest, items: [] });
    assert.deepEqual(await stale, []);
    const invalidRequest = await open();
    filters.receivePath({ request: invalidRequest, items: [{ path: 'bad' }] });
    await settle();
    assert.match(f.document.querySelector('.popup-error')!.textContent!, /Invalid path response/);
    const pending = filters.surface.host.pathChildren('pending/');
    const rejection = assert.rejects(pending, /Log session disposed/);
    filters.dispose();
    await rejection;
    filters.receivePath({ request: Number(f.messages.at(-1)?.request), items: [] });
    assert.equal(f.document.getElementById('filter-popup')!.hidden, true);
  } finally {
    filters.dispose();
    await f.dispose();
  }
});
