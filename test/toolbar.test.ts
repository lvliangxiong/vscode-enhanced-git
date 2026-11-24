import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHoverDom } from './helpers/hover-dom';
import { createToolbarController, visibleFilterCount } from '../src/webview/log/toolbar';
import { createLogStore } from '../src/webview/state/log';
import { createDetailStore } from '../src/webview/state/details';

test('toolbar folds whole trailing controls progressively and restores them as space grows', () => {
  const widths = [80, 60, 60, 70, 22, 11, 22];
  for (const [budget, count] of [
    [400, 7],
    [208, 3],
    [144, 2],
    [82, 1],
    [81, 0],
    [400, 7],
  ])
    assert.equal(visibleFilterCount(widths, budget).count, count);
});
async function layoutHarness() {
  const t = await createHoverDom();
  const toolbar = t.document.querySelector<HTMLElement>('.filters'),
    strip = t.document.getElementById('filter-strip'),
    viewport = t.document.getElementById('filter-viewport'),
    button = t.document.getElementById('filter-overflow');
  const controls = [...strip.children] as HTMLElement[];
  const widths = [80, 60, 60, 70, 22, 1, 22];
  let toolbarWidth = 1000;
  Object.defineProperty(toolbar, 'clientWidth', { get: () => toolbarWidth });
  Object.defineProperty(t.document.querySelector('.log-actions'), 'offsetWidth', {
    get: () => 110,
  });
  controls.forEach((control, index) => {
    control.getBoundingClientRect = () => ({ width: widths[index] }) as DOMRect;
  });
  const hidden = t.document.createElement('button');
  hidden.hidden = true;
  hidden.getBoundingClientRect = () => ({ width: 0 }) as DOMRect;
  strip.append(hidden);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({
      columnGap: '2',
      paddingLeft: '4',
      paddingRight: '4',
      minWidth: '202',
      marginLeft: '0',
      marginRight: '0',
    }),
  });
  t.ctx.store = createLogStore();
  t.ctx.env.api = { getState: () => ({}), setState: (value) => value, postMessage() {} };
  const loads: unknown[] = [];
  t.ctx.actions = {
    files: {
      store: createDetailStore(),
      expandFileFolders() {},
      expansionState: () => ({ enabled: false, expanded: false }),
      toggleDirectory() {},
      canShowHistory: () => false,
      showHistory() {},
      canShowInSidebar: () => false,
      showInSidebar() {},
    },
    branches: {
      canCherryPick: () =>
        t.ctx.store.getState().selected.size === 1 &&
        t.ctx.store.getState().commits.some((commit) => commit.parents.length === 1),
      startCherryPick() {},
    },
    filters: { closeFilter() {}, positionFilter() {} },
    history: {
      load(options) {
        loads.push(options);
      },
    },
  } as any;
  const controller = createToolbarController(t.ctx);
  t.ctx.actions.toolbar = controller;
  controller.start();
  await t.tick();
  const style = t.style('filter-viewport').style;
  return {
    ...t,
    toolbar,
    strip,
    controls,
    widths,
    viewport,
    button,
    style,
    controller,
    loads,
    setWidth(width: number) {
      toolbarWidth = width;
    },
    layout: controller.layoutFilterOverflow,
    async dispose() {
      controller.dispose();
      if (original) Object.defineProperty(globalThis, 'getComputedStyle', original);
      await t.dispose();
    },
  };
}
test('hidden retained panels preserve toolbar geometry and recover when shown', async () => {
  const h = await layoutHarness();
  try {
    h.layout();
    const width = h.style.width;
    h.setWidth(0);
    h.layout();
    assert.equal(h.style.width, width);
    h.setWidth(1000);
    const saved = [...h.widths];
    h.widths.fill(0);
    h.layout();
    assert.equal(
      h.style.width,
      width,
      'zero child measurements must not clip Branch to a few pixels',
    );
    h.widths.splice(0, h.widths.length, ...saved);
    h.layout();
    await h.tick();
    assert.equal(h.button.hidden, true);
    assert.equal(
      h.viewport.dataset.visible,
      '7',
      'hidden Clear button consumes no gap or item slot',
    );
  } finally {
    await h.dispose();
  }
});
test('resizing an expanded filter strip collapses without recursive layout', async () => {
  const h = await layoutHarness();
  try {
    h.setWidth(430);
    h.layout();
    h.event(h.button, 'pointerenter');
    await h.tick();
    assert.equal(h.strip.classList.contains('is-expanded'), true);
    h.setWidth(1000);
    h.layout();
    await h.tick();
    assert.equal(h.strip.classList.contains('is-expanded'), false);
    assert.equal(h.button.hidden, true);
    assert.equal(h.viewport.dataset.visible, '7');
  } finally {
    await h.dispose();
  }
});
test('fully collapsed filters remain measurable and restore at wider widths', async () => {
  const h = await layoutHarness();
  try {
    h.setWidth(340);
    h.layout();
    await h.tick();
    assert.equal(h.style.width, '0px');
    assert.equal(h.viewport.hidden, false);
    assert.equal(h.button.hidden, false);
    h.setWidth(1000);
    h.layout();
    await h.tick();
    assert.equal(h.viewport.dataset.visible, '7');
    assert.equal(h.button.hidden, true);
  } finally {
    await h.dispose();
  }
});

test('Refresh forces repository refresh and cherry-pick eligibility follows changed commits', async () => {
  const h = await layoutHarness();
  try {
    h.document.getElementById('refresh').click();
    assert.deepEqual(h.loads, [{ refresh: true }]);
    h.ctx.store.setState({
      selected: new Set(['abc']),
      commits: [{ hash: 'abc', parents: ['parent'] }] as any,
    });
    await h.tick();
    const cherry = h.document.getElementById('cherry-pick') as HTMLButtonElement;
    assert.equal(cherry.disabled, false);
    h.ctx.store.setState({ commits: [{ hash: 'abc', parents: ['first', 'second'] }] as any });
    await h.tick();
    assert.equal(cherry.disabled, true);
  } finally {
    await h.dispose();
  }
});

test('one file expansion button switches its action, icon and tooltip with folder state', async () => {
  const h = await layoutHarness();
  try {
    const files = h.ctx.actions.files;
    let expanded = true;
    files.expansionState = () => ({ enabled: files.store.getState().directoryView, expanded });
    files.expandFileFolders = (open) => {
      expanded = open;
      files.store.setState({ opened: new Map([['src', open]]) });
    };
    files.store.setState({ files: [{ index: 0, path: 'src/a.ts', status: 'M' }] });
    await h.tick();
    const button = h.document.getElementById('files-expansion') as HTMLButtonElement;
    assert.equal(h.document.getElementById('files-expand'), null);
    assert.equal(h.document.getElementById('files-collapse'), null);
    assert.equal(button.title, 'Collapse All');
    assert.ok(button.querySelector('.rebased-collapse'));
    button.click();
    await h.tick();
    assert.equal(expanded, false);
    assert.equal(button.title, 'Expand All');
    assert.ok(button.querySelector('.rebased-expand'));
    button.click();
    await h.tick();
    assert.equal(expanded, true);
    assert.equal(button.title, 'Collapse All');
    files.store.setState({ directoryView: false });
    await h.tick();
    assert.equal(button.disabled, true);
  } finally {
    await h.dispose();
  }
});
