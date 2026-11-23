import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReactDom } from './helpers/react-dom';
import type { FilterRow } from '../src/webview/react/filter-menu';
const bootstrap = createReactDom();
const { flushSync } = require('react-dom') as typeof import('react-dom');
const { create, forget, FilterSurface } =
  require('../src/webview/filters') as typeof import('../src/webview/filters');
// React initializes DOM feature detection at import time and retains a scheduler callback.
// Keep this inert document as the fallback between per-test documents.
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});
const children = (node: Element) =>
  Array.from((node.querySelector(':scope > .filter-surface') || node).children) as HTMLElement[];
function setup(overrides: Record<string, unknown> = {}) {
  const dom = createReactDom('<button id="anchor"></button><div id="popup"></div>');
  const { document, window } = dom;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Object.defineProperty(window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  const popup = document.getElementById('popup'),
    anchor = document.getElementById('anchor');
  popup.hidden = true;
  const sheet = {
    cssRules: [],
    insertRule() {
      return this.cssRules.push({ style: {} }) - 1;
    },
  };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  window.setTimeout = ((fn: () => void) => {
    timers.set(++timerId, fn);
    return timerId;
  }) as typeof window.setTimeout;
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
  const model = {
    refs: [],
    authors: [],
    paths: [],
    branches: [],
    recents: {} as Record<string, string[][]>,
    favorites: new Set<string>(),
    authorOptions: [],
    root: '/repo',
    since: '',
    until: '',
    sinceHours: 0,
  };
  const applied = [],
    removed = [];
  const filters = create({
    popup,
    document,
    window: window as unknown as Window,
    sheet: sheet as unknown as CSSStyleSheet,
    model: () => model,
    beforeOpen() {},
    apply(...args) {
      applied.push(args);
    },
    favorite(ref) {
      model.favorites.has(ref) ? model.favorites.delete(ref) : model.favorites.add(ref);
      filters.refresh();
    },
    clearRecent(kind) {
      model.recents[kind] = [];
    },
    removeRecent(kind, values) {
      removed.push({ kind, values });
      model.recents[kind] = forget(model.recents[kind], values);
    },
    pathChildren: async () => [],
    themeFileIcon: { set: (node: HTMLElement) => node.setAttribute('aria-hidden', 'true') },
    ...overrides,
  });
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { createElement } = require('react') as typeof import('react');
  const { createPortal } = require('react-dom') as typeof import('react-dom');
  const bubbling: Record<string, (() => void) | undefined> = {};
  const rootElement = document.createElement('div');
  document.body.append(rootElement);
  const root = createRoot(rootElement);
  flushSync(() =>
    root.render(
      createElement(
        'div',
        {
          onClick: () => bubbling.click?.(),
          onKeyDown: () => bubbling.keydown?.(),
        },
        createPortal(createElement(FilterSurface, { controller: filters }), popup),
      ),
    ),
  );
  cleanup.push(async () => {
    filters.dispose();
    flushSync(() => root.unmount());
    await dom.dispose();
  });
  function dispatch(node: Element, type: string, options = {}) {
    const event =
      type === 'keydown'
        ? new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...options })
        : new window.MouseEvent(type, { bubbles: true, cancelable: true, ...options });
    flushSync(() => node.dispatchEvent(event));
    return event;
  }
  return {
    filters,
    popup,
    anchor,
    model,
    applied,
    removed,
    document,
    window,
    listenBubbling: (type: string, listener: () => void) => {
      bubbling[type] = listener;
    },
    rows: (node = popup) => Array.from(node.querySelectorAll<FilterRow>('[role=menuitem]')),
    click: (node: Element) => dispatch(node, 'click'),
    key: (node: Element, key: string, options = {}) =>
      dispatch(node, 'keydown', { key, ...options }),
    input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
      const prototype =
        node.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
      dispatch(node, 'input');
    },
    enter: (node: Element, relatedTarget: Element = null) => {
      dispatch(node, 'pointerover', { relatedTarget });
      dispatch(node, 'pointerenter', { relatedTarget });
    },
    leave: (node: Element, relatedTarget: Element = null) => {
      dispatch(node, 'pointerout', { relatedTarget });
      dispatch(node, 'pointerleave', { relatedTarget });
    },
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      flushSync(() => callbacks.forEach((fn) => fn()));
    },
    select: () => dispatch(popup.querySelector('[role=menuitem]'), 'click'),
  };
}
test('resized Select editors cannot impose dimensions on reopened or other filter menus', () => {
  const h = setup();
  for (const kind of ['branch', 'user', 'paths'] as const) {
    h.filters.open(kind, h.anchor);
    h.select();
    assert.equal(h.popup.className, 'filter-editor');
    // Chromium's native CSS resize stores both dimensions on the element itself.
    Object.assign(h.popup.style, { width: '740px', height: '360px' });
    h.filters.position();
    assert.equal(h.popup.style.width, '740px', 'keep user resizing while editor is open');
    h.key(h.popup, 'Escape');
    h.filters.open(kind, h.anchor);
    assert.match(h.popup.className, /rebased-filter-menu/);
    assert.equal(h.popup.style.width, '');
    assert.equal(h.popup.style.height, '');
    h.select();
    Object.assign(h.popup.style, { width: '230px', height: '420px' });
    h.filters.open('date', h.anchor);
    assert.equal(h.popup.style.width, '');
    assert.equal(h.popup.style.height, '');
    h.select();
    assert.equal(h.popup.className, 'filter-dialog-host');
    h.filters.close();
  }
});

test('removing Recent keeps filters unchanged and leaves branch submenu open through refresh', () => {
  const h = setup();
  h.model.recents.branch = [['main', 'topic'], ['main']];
  h.model.refs = ['main', 'topic'];
  h.filters.open('branch', h.anchor);
  h.click(h.rows().find((row) => row.recentMenu));
  let sub = children(h.popup).find((node) => node.id === 'filter-submenu');
  const first = sub.querySelector<HTMLElement>('[role=menuitem]');
  first.focus();
  const remove = children(first).find((node) => node.className === 'filter-recent-remove');
  let bubbled = 0;
  h.listenBubbling('click', () => bubbled++);
  const click = h.click(remove);
  assert.equal(bubbled, 0, 'actions do not bubble to the React parent or activate the row');
  assert.equal(click.defaultPrevented, true);
  assert.equal(h.applied.length, 0);
  assert.deepEqual(h.model.refs, ['main', 'topic']);
  assert.deepEqual(
    Array.from(h.model.recents.branch, (group) => Array.from(group)),
    [['main']],
  );
  assert.equal(h.popup.hidden, false);
  sub = children(h.popup).find((node) => node.id === 'filter-submenu');
  assert.ok(sub);
  assert.equal(sub.querySelectorAll('[role=menuitem]').length, 1);
  h.filters.refresh();
  sub = children(h.popup).find((node) => node.id === 'filter-submenu');
  assert.ok(sub, 'server confirmation must not close Recent');
  h.click(sub.querySelector('.filter-recent-remove'));
  assert.equal(h.model.recents.branch.length, 0);
  assert.equal(h.popup.hidden, false);
  assert.equal(
    children(h.popup).some((node) => node.id === 'filter-submenu'),
    false,
  );
});

test('User and Paths Recent entries can be cleared without applying a filter', () => {
  for (const kind of ['user', 'paths'] as const) {
    const h = setup();
    h.model.recents[kind] =
      kind === 'paths'
        ? [['/repo/src', '/repo/docs'], ['/repo/test']]
        : [['alice', 'bob'], ['carol']];
    h.filters.open(kind, h.anchor);
    const row = h
      .rows()
      .find((row) => children(row).some((node) => node.className === 'filter-recent-remove'));
    row.focus();
    const remove = children(row).find((node) => node.className === 'filter-recent-remove');
    let bubbled = 0;
    h.listenBubbling('keydown', () => bubbled++);
    h.key(remove, 'Enter');
    assert.equal(bubbled, 0, 'actions do not bubble to the React parent or activate the row');
    h.click(remove);
    assert.equal(h.model.recents[kind].length, 1);
    assert.equal(h.removed[0].kind, kind);
    assert.equal(h.applied.length, 0);
    assert.equal(h.popup.hidden, false);
  }
});

test('Clear Recent only clears the current kind and keeps the main menu and active filters', () => {
  const findClear = (node) =>
    node.className === 'filter-recent-clear' ? node : children(node).map(findClear).find(Boolean);
  for (const kind of ['branch', 'user', 'paths'] as const) {
    const h = setup();
    h.model.recents = { branch: [['main'], ['topic']], user: [['alice']], paths: [['/repo/src']] };
    h.model.refs = ['main'];
    h.model.authors = ['alice'];
    h.model.paths = ['src'];
    h.filters.open(kind, h.anchor);
    if (kind === 'branch') h.click(h.rows().find((row) => row.recentMenu));
    const clear = findClear(h.popup);
    assert.ok(clear);
    assert.match(clear.getAttribute('aria-label'), new RegExp(kind));
    let bubbled = 0;
    h.listenBubbling('click', () => bubbled++);
    const click = h.click(clear);
    assert.equal(click.defaultPrevented, true);
    assert.equal(bubbled, 0, 'actions do not bubble to the React parent or activate the row');
    assert.equal(h.model.recents[kind].length, 0);
    for (const other of ['branch', 'user', 'paths'].filter((value) => value !== kind))
      assert.ok(h.model.recents[other].length);
    assert.deepEqual(h.model.refs, ['main']);
    assert.deepEqual(h.model.authors, ['alice']);
    assert.deepEqual(h.model.paths, ['src']);
    assert.equal(h.applied.length, 0);
    assert.equal(h.popup.hidden, false);
    assert.equal(findClear(h.popup), undefined);
    h.filters.refresh();
    assert.equal(findClear(h.popup), undefined);
    assert.equal(h.popup.hidden, false);
    h.filters.close();
    h.filters.open(kind, h.anchor);
    assert.equal(findClear(h.popup), undefined);
  }
});

test('Recent only opens on arrow hover and cancels delayed opening when leaving', () => {
  const h = setup();
  h.model.recents.branch = [['main']];
  h.filters.open('branch', h.anchor);
  const row = h.rows().find((item) => item.recentMenu);
  const trigger = children(row).find((item) => item.className === 'filter-submenu-trigger');
  const label = children(row).find((item) => item.className === 'filter-menu-label');
  const submenu = () => children(h.popup).find((item) => item.id === 'filter-submenu');
  h.enter(row);
  h.flushTimers();
  assert.equal(submenu(), undefined, 'label and clear icon hover cannot open Recent');
  h.enter(trigger);
  h.leave(trigger, label);
  h.flushTimers();
  assert.equal(submenu(), undefined);
  h.enter(trigger);
  h.leave(row);
  h.flushTimers();
  assert.equal(submenu(), undefined, 'leaving before the delay cannot open a stale submenu');
  h.enter(trigger);
  h.flushTimers();
  const opened = submenu();
  assert.ok(opened);
  h.leave(trigger, opened);
  h.leave(row);
  h.enter(opened);
  h.flushTimers();
  assert.equal(submenu(), opened, 'moving from arrow into submenu keeps it open');
  h.enter(row, opened);
  h.enter(trigger);
  h.flushTimers();
  assert.equal(submenu(), opened, 'returning to arrow does not flicker');
  h.leave(trigger, label);
  h.flushTimers();
  assert.equal(
    submenu(),
    opened,
    'crossing the label towards a left-opening submenu must not close it',
  );
  h.leave(row);
  h.enter(opened);
  h.flushTimers();
  assert.equal(submenu(), opened, 'entering the submenu cancels delayed closing across the gap');
  h.leave(opened, label);
  h.enter(row, opened);
  h.flushTimers();
  assert.equal(submenu(), opened, 'returning through the parent row keeps it open');
  const clear = children(row).find((item) => item.className === 'filter-recent-clear');
  h.enter(clear);
  assert.equal(submenu(), undefined, 'hovering the clear button itself dismisses the submenu');
  h.flushTimers();
  assert.equal(submenu(), undefined);
  h.key(row, 'ArrowRight');
  assert.ok(submenu(), 'keyboard navigation remains available');
  h.leave(submenu());
  h.flushTimers();
  assert.equal(submenu(), undefined, 'leaving both areas closes after the grace period');
});

test('Recent popup and copy labels use short names while clicks retain full references', () => {
  const h = setup(),
    values = ['refs/heads/main', 'refs/remotes/origin/main'];
  h.model.branches = [
    { name: 'main', ref: values[0], group: 'Local' },
    { name: 'origin/main', ref: values[1], group: 'Remote', remote: 'origin' },
  ];
  h.model.recents.branch = [values];
  h.filters.open('branch', h.anchor);
  h.click(h.rows().find((row) => row.recentMenu));
  const sub = children(h.popup).find((node) => node.id === 'filter-submenu'),
    row = sub.querySelector('[role=menuitem]');
  const label = children(row).find((node) => node.classList.contains('filter-menu-label'));
  assert.equal(label.textContent, 'main|origin/main');
  assert.deepEqual(JSON.parse(label.dataset.references), ['main', 'origin/main']);
  h.click(row.querySelector('.filter-recent-remove'));
  assert.equal(h.removed[0].values, values);
  assert.equal(h.model.recents.branch.length, 0);
  h.model.recents.branch = [values];
  h.filters.refresh();
  h.click(h.rows().find((row) => row.recentMenu));
  h.click(h.popup.querySelector('#filter-submenu [role=menuitem]'));
  assert.equal(h.applied[0][0], 'branch');
  assert.equal(h.applied[0][1], values);
});

test('HEAD favorite toggles without applying a filter and remains available after refresh', () => {
  const h = setup();
  const headRow = () =>
    h.rows().find((row) => children(row).some((child) => child.textContent === 'HEAD'));
  h.filters.open('branch', h.anchor);
  for (const expected of [true, false]) {
    const row = headRow();
    const star = row.querySelector('.filter-menu-icon');
    assert.equal(
      star.getAttribute('aria-label'),
      expected ? 'Mark as Favorite' : 'Unmark as Favorite',
    );
    // Real bubbling must stop at the star instead of applying the row filter.
    h.click(star);
    assert.equal(h.model.favorites.has('HEAD'), expected);
    assert.equal(h.applied.length, 0);
    assert.equal(h.popup.hidden, false);
    h.filters.refresh();
    assert.ok(headRow());
  }
  h.click(headRow());
  assert.equal(h.applied[0][0], 'branch');
  assert.deepEqual(Array.from(h.applied[0][1]), ['HEAD']);
});

test('marking a branch immediately rebuilds Favorites and preserves its open Local submenu', () => {
  const h = setup();
  h.model.branches = [{ name: 'topic', ref: 'refs/heads/topic', group: 'Local' }];
  h.filters.open('branch', h.anchor);
  h.click(h.rows().find((row) => row.submenuLabel === 'Local'));
  const submenu = () => children(h.popup).find((node) => node.id === 'filter-submenu');
  const favoriteRows = () =>
    h
      .rows(h.popup.querySelector('#filter-results'))
      .filter((row) => children(row).some((child) => child.textContent === 'topic'));
  for (const marked of [true, false]) {
    const row = submenu().querySelector('[role=menuitem]');
    h.click(row.querySelector('.filter-menu-icon'));
    assert.ok(submenu(), 'Local submenu stays open while changing favorites');
    assert.equal(h.model.favorites.has('refs/heads/topic'), marked);
    assert.equal(favoriteRows().length, marked ? 1 : 0);
    assert.equal(h.applied.length, 0);
  }
});

test('React filter editor preserves completions, validation and modifier submission', () => {
  const h = setup();
  h.model.branches = [
    { name: 'main', ref: 'refs/heads/main', group: 'Local' },
    { name: 'topic', ref: 'refs/heads/topic', group: 'Local' },
  ];
  h.model.refs = ['refs/heads/main'];
  h.filters.open('branch', h.anchor);
  h.select();
  const input = h.popup.querySelector('textarea');
  assert.equal(input.value, 'main');
  h.input(input, 'top');
  assert.equal(h.popup.querySelector<HTMLElement>('.filter-completion').hidden, false);
  assert.equal(h.popup.querySelector('[role=option]').textContent, 'topic');
  h.key(input, 'Tab');
  assert.equal(input.value, 'topic');
  h.input(input, '[invalid');
  h.key(input, 'Enter', { metaKey: true });
  assert.equal(h.popup.querySelector<HTMLElement>('[role=alert]').hidden, false);
  assert.equal(h.applied.length, 0);
  h.input(input, 'main|topic');
  h.key(input, 'Enter', { metaKey: true });
  assert.deepEqual(h.applied[0], ['branch', ['main', 'topic'], true]);
  assert.equal(h.popup.hidden, true);
});

test('React date dialog keeps disabled fields, period validation and Enter apply', () => {
  const h = setup();
  h.filters.open('date', h.anchor);
  h.select();
  const after = h.popup.querySelector<HTMLInputElement>('[aria-label="After date"]');
  const before = h.popup.querySelector<HTMLInputElement>('[aria-label="Before date"]');
  assert.equal(after.disabled, true);
  assert.equal(before.disabled, true);
  h.click(h.popup.querySelector('[aria-label="After"]'));
  h.click(h.popup.querySelector('[aria-label="Before"]'));
  assert.equal(after.disabled, false);
  assert.equal(before.disabled, false);
  h.input(after, '2026-10-20');
  h.input(before, '2026-10-19');
  h.key(after, 'Enter');
  assert.equal(h.popup.querySelector('[role=alert]').textContent, 'After must precede Before.');
  assert.equal(h.applied.length, 0);
  h.input(before, '2026-10-21');
  h.key(before, 'Enter');
  assert.equal(h.applied[0][0], 'date');
  assert.equal(h.applied[0][2], false);
  assert.equal(h.applied[0][1].since, new Date('2026-10-20T00:00:00').toISOString());
  assert.equal(h.popup.hidden, true);
});

test('React path tree lazily loads, preserves parent selection and splits deselected descendants', async () => {
  const calls = [];
  const h = setup({
    pathChildren: async (path) => {
      calls.push(path);
      return path === ''
        ? [{ name: 'src', path: 'src/', directory: true }]
        : [
            { name: 'a.ts', path: 'src/a.ts', directory: false },
            { name: 'b.ts', path: 'src/b.ts', directory: false },
          ];
    },
  });
  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    flushSync(() => {});
  };
  h.model.paths = ['/repo/src'];
  h.filters.open('paths', h.anchor);
  h.click(h.rows().find((row) => row.textContent === 'Select in Tree…'));
  await settle();
  assert.deepEqual(calls, ['']);
  assert.equal(h.popup.querySelector<HTMLInputElement>('[aria-label="src/"]').checked, true);
  h.click(h.popup.querySelector('[aria-label="Expand src"]'));
  await settle();
  assert.deepEqual(calls, ['', 'src/']);
  assert.equal(h.popup.querySelector<HTMLInputElement>('[aria-label="src/a.ts"]').checked, true);
  h.click(h.popup.querySelector('[aria-label="src/a.ts"]'));
  assert.equal(h.popup.querySelector<HTMLInputElement>('[aria-label="src/"]').indeterminate, true);
  assert.equal(h.popup.querySelector<HTMLInputElement>('[aria-label="src/b.ts"]').checked, true);
  h.click(h.popup.querySelector('[aria-label="Collapse src"]'));
  h.click(h.popup.querySelector('[aria-label="Expand src"]'));
  assert.deepEqual(calls, ['', 'src/'], 'reopening uses cached children');
  h.click(h.popup.querySelector('.popup-apply'));
  assert.deepEqual(h.applied[0], ['paths', ['src/b.ts'], true]);
});

test('React speed search preserves keyboard selection and closes only the search on first Escape', () => {
  const h = setup();
  h.model.branches = [
    { name: 'main', ref: 'refs/heads/main', group: 'Local' },
    { name: 'feature/topic', ref: 'refs/heads/feature/topic', group: 'Local' },
  ];
  h.filters.open('branch', h.anchor);
  h.key(h.rows()[0], 't');
  const input = h.popup.querySelector<HTMLInputElement>('.filter-speed-search');
  assert.ok(input);
  h.input(input, 'topic');
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].textContent, 'feature/topic');
  assert.equal(input.getAttribute('aria-activedescendant'), h.rows()[0].id);
  h.key(input, 'Escape');
  assert.equal(h.popup.hidden, false);
  assert.equal(h.popup.querySelector('.filter-speed-search'), null);
  h.key(h.rows()[0], 'f');
  const next = h.popup.querySelector<HTMLInputElement>('.filter-speed-search');
  h.input(next, 'topic');
  h.key(next, 'Enter');
  assert.deepEqual(h.applied[0], ['branch', ['feature/topic'], true]);
});

test('Escape first dismisses editor completions, then closes the editor and restores focus', () => {
  const h = setup();
  h.model.branches = [{ name: 'main', ref: 'refs/heads/main', group: 'Local' }];
  h.filters.open('branch', h.anchor);
  h.select();
  const input = h.popup.querySelector('textarea');
  h.input(input, 'ma');
  assert.equal(h.popup.querySelector<HTMLElement>('.filter-completion').hidden, false);
  h.key(input, 'Escape');
  assert.equal(h.popup.hidden, false);
  assert.equal(h.popup.querySelector<HTMLElement>('.filter-completion').hidden, true);
  h.key(input, 'Escape');
  assert.equal(h.popup.hidden, true);
  assert.equal(h.document.activeElement, h.anchor);
});

test('closing a path dialog ignores outstanding children and preserves the next menu', async () => {
  let resolve: (items: unknown[]) => void;
  const h = setup({
    pathChildren: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  h.filters.open('paths', h.anchor);
  h.click(h.rows().find((row) => row.textContent === 'Select in Tree…'));
  assert.equal(h.popup.querySelector('[role=tree]').textContent, 'Loading…');
  h.filters.close();
  h.filters.open('branch', h.anchor);
  resolve([{ name: 'late', path: 'late', directory: false }]);
  await new Promise((done) => setImmediate(done));
  flushSync(() => {});
  assert.match(h.popup.className, /rebased-filter-menu/);
  assert.equal(h.popup.querySelector('[role=tree]'), null);
  assert.ok(h.rows().some((row) => row.textContent === 'HEAD'));
});

test('disposing a filter view cancels hover work, detaches keyboard handlers and cannot reopen', () => {
  const h = setup();
  h.model.recents.branch = [['main']];
  h.filters.open('branch', h.anchor);
  h.enter(h.popup.querySelector('.filter-submenu-trigger'));
  h.filters.dispose();
  h.flushTimers();
  assert.equal(h.popup.hidden, true);
  assert.equal(h.popup.childElementCount, 0);
  h.key(h.popup, 'a');
  assert.equal(h.popup.childElementCount, 0);
  h.filters.open('branch', h.anchor);
  assert.equal(h.popup.hidden, true);
  h.filters.dispose();
});

test('Select ignores pointer callbacks retained by the previous branch menu', () => {
  const h = setup();
  h.model.branches = [{ name: 'topic', ref: 'refs/heads/topic', group: 'Local' }];
  h.filters.open('branch', h.anchor);
  const props = h.filters.menuProps();
  const entry = props.entries.find((entry) => entry.children);
  const row = h.rows().find((row) => row.textContent.includes(entry.label));
  props.arrowEnter(row, entry);
  h.select();
  const input = h.popup.querySelector('textarea');
  h.input(input, 'top');
  props.enter(row, entry, 0);
  props.arrowEnter(row, entry);
  props.leave(row, null);
  props.openSub(row, entry);
  h.flushTimers();
  assert.equal(h.filters.store.getState().mode, 'editor');
  assert.equal(h.filters.store.getState().submenuLabel, undefined);
  assert.equal(h.popup.querySelector('textarea'), input);
  assert.equal(h.document.activeElement, input);
  assert.equal(h.popup.querySelector<HTMLElement>('.filter-completion').hidden, false);
});
