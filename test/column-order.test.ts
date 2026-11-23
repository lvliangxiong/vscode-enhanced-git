import type { MockNode, MockPointerEvent } from './helpers/mocks';
import { createColumnsController } from '../src/webview/log/columns';
import { createLogStore } from '../src/webview/state/log';
import { test } from 'node:test';
import assert from 'node:assert/strict';
function setup(withSubject = false) {
  const saves = [],
    nodes = new Map();
  const node = (key: string, left: number, width: number): MockNode => ({
    key,
    dataset: { column: key },
    events: {},
    classList: { add() {}, remove() {} },
    addEventListener(name, fn) {
      this.events[name] = fn;
    },
    getBoundingClientRect: () => ({ left, width }),
    setPointerCapture() {},
    animate() {},
    closest() {
      return this;
    },
  });
  const cells = withSubject
    ? [node('author', 100, 120), node('subject', 220, 500), node('date', 720, 170)]
    : [node('author', 100, 120), node('date', 220, 170)];
  const row = {
    querySelectorAll: () => cells,
    querySelector: (s) => cells.find((c) => s.includes(`"${c.key}"`)),
    append: (c) => {
      cells.splice(cells.indexOf(c), 1);
      cells.push(c);
    },
  };
  const sheet = {
    cssRules: [],
    insertRule(selector) {
      this.cssRules.push({ selector, style: {} });
      return this.cssRules.length - 1;
    },
  };
  const store = createLogStore();
  store.setState({
    columnOrder: withSubject
      ? ['author', 'subject', 'hash', 'date', 'signature']
      : ['author', 'hash', 'date', 'signature'],
    viewSettings: { author: true, date: true },
  });
  store.subscribe((next, previous) => {
    if (next.columnOrder === previous.columnOrder) return;
    // React owns DOM order. This focused pointer test supplies its keyed reorder contract.
    const ordered = next.columnOrder
      .map((key) => cells.find((cell) => cell.key === key))
      .filter(Boolean);
    cells.splice(0, cells.length, ...ordered);
  });
  const controller = createColumnsController({
    store,
    env: {
      layoutSheet: sheet,
      api: { getState: () => ({}), setState: (value) => saves.push([...value.columnOrder]) },
      window: {
        addEventListener() {},
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        matchMedia: () => ({ matches: false }),
      },
      $: () => ({
        scrollLeft: 0,
        scrollWidth: 1000,
        clientWidth: 1000,
        querySelectorAll: (s) => (s === '.commit' ? [row] : cells),
      }),
      document: { addEventListener() {}, body: { classList: { add() {}, remove() {} } } },
    },
    actions: { commits: { renderCommitWindow() {} }, graph: { repaintGraphCanvases() {} } },
  } as any);
  controller.getRuleStyle();
  const ctx = {
    ...controller,
    get columnOrder() {
      return store.getState().columnOrder;
    },
  };
  for (const n of cells) {
    n.parentElement = row;
    ctx.installColumnDrag(n as unknown as HTMLElement, n.key);
    nodes.set(n.key, n);
  }
  const fire = (key, type, extra = {}) => {
    const e: MockPointerEvent & { target: { closest(): boolean } } = {
      button: 0,
      pointerId: 1,
      target: { closest: () => false },
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      clientX: 160,
      clientY: 10,
      ...extra,
    };
    nodes.get(key).events[type](e);
    return e;
  };
  return {
    ctx,
    saves,
    cells,
    fire,
    style: (key) =>
      sheet.cssRules.find((rule) => rule.selector === `.commit > [data-column="${key}"] {}`).style,
  };
}
test('held column follows pointer; neighbour moves only after midpoint; drop saves existing cells', () => {
  const t = setup(),
    original = t.cells.slice();
  t.fire('author', 'pointerdown');
  t.fire('author', 'pointermove', { clientX: 200 });
  assert.equal(t.style('author').transform, 'translateX(40px)');
  assert.equal(t.style('date').transform, 'translateX(0px)');
  assert.equal(t.saves.length, 0);
  t.fire('author', 'pointermove', { clientX: 310 });
  assert.equal(t.style('date').transform, 'translateX(-120px)');
  assert.deepEqual(t.cells, original);
  t.fire('author', 'pointerup');
  assert.deepEqual([...t.ctx.columnOrder], ['hash', 'date', 'author', 'signature']);
  assert.deepEqual(t.cells, [original[1], original[0]]);
  assert.equal(t.saves.length, 1);
  assert.equal(t.style('author').transform, '');
  assert.equal(t.fire('author', 'click').stopped, true);
});
test('dragging back restores slots; cancellation and ordinary clicks do not save', () => {
  for (const scenario of ['click', 'resizer', 'cancel', 'back']) {
    const t = setup();
    t.fire(
      'author',
      'pointerdown',
      scenario === 'resizer' ? { target: { closest: () => true } } : {},
    );
    if (scenario !== 'click') t.fire('author', 'pointermove', { clientX: 310 });
    if (scenario === 'cancel') t.fire('author', 'pointercancel');
    if (scenario === 'back') {
      t.fire('author', 'pointermove', { clientX: 170 });
      assert.equal(t.style('date').transform, 'translateX(0px)');
    }
    t.fire('author', 'pointerup');
    assert.equal(t.saves.length, 0, scenario);
  }
});
test('moving a wider column left shifts the adjacent column by its full width', () => {
  const t = setup();
  t.fire('date', 'pointerdown', { clientX: 300 });
  t.fire('date', 'pointermove', { clientX: 140 });
  assert.equal(t.style('author').transform, 'translateX(170px)');
  t.fire('date', 'pointerup');
  assert.deepEqual([...t.ctx.columnOrder], ['date', 'author', 'hash', 'signature']);
});
test('saved column order removes unknown/duplicate entries and restores missing columns', () => {
  const t = setup();
  assert.deepEqual(
    [...t.ctx.normalizeColumnOrder(['date', 'invalid', 'date', 'author'])],
    ['subject', 'date', 'author', 'hash', 'signature'],
  );
  assert.deepEqual(
    [...t.ctx.normalizeColumnOrder(null)],
    ['subject', 'author', 'hash', 'date', 'signature'],
  );
});

test('controller startup restores the graph column in a legacy saved layout', () => {
  const t = setup();
  assert.equal(t.ctx.columnOrder.includes('subject'), false);
  t.ctx.start();
  assert.deepEqual(t.ctx.columnOrder, ['subject', 'author', 'hash', 'date', 'signature']);
});

test('saved graph and message column position is retained', () => {
  const t = setup();
  assert.deepEqual(
    [...t.ctx.normalizeColumnOrder(['date', 'subject', 'author'])],
    ['date', 'subject', 'author', 'hash', 'signature'],
  );
});

test('graph and message move together to the first slot and other columns can move ahead of them', () => {
  const t = setup(true);
  t.fire('subject', 'pointerdown', { clientX: 400 });
  t.fire('subject', 'pointermove', { clientX: 80 });
  assert.equal(t.style('author').transform, 'translateX(500px)');
  t.fire('subject', 'pointerup');
  assert.equal(t.ctx.columnOrder[0], 'subject');
  assert.equal(t.cells[0].key, 'subject');
  const u = setup(true);
  u.fire('date', 'pointerdown', { clientX: 800 });
  u.fire('date', 'pointermove', { clientX: 120 });
  u.fire('date', 'pointerup');
  assert.deepEqual([...u.ctx.columnOrder], ['date', 'author', 'subject', 'hash', 'signature']);
});

test('one fast drag can cross several columns in either direction and reverse before dropping', () => {
  const right = setup(true);
  right.fire('author', 'pointerdown', { clientX: 160 });
  right.fire('author', 'pointermove', { clientX: 1400 });
  assert.equal(right.style('subject').transform, 'translateX(-120px)');
  assert.equal(right.style('date').transform, 'translateX(-120px)');
  assert.equal(
    right.style('author').transform,
    'translateX(670px)',
    'preview stays inside original content',
  );
  right.fire('author', 'pointerup');
  assert.deepEqual([...right.ctx.columnOrder], ['subject', 'hash', 'date', 'author', 'signature']);
  const left = setup(true);
  left.fire('date', 'pointerdown', { clientX: 800 });
  left.fire('date', 'pointermove', { clientX: -500 });
  assert.equal(left.style('subject').transform, 'translateX(170px)');
  left.fire('date', 'pointermove', { clientX: 1500 });
  assert.equal(left.style('subject').transform, 'translateX(0px)');
  left.fire('date', 'pointermove', { clientX: -500 });
  left.fire('date', 'pointerup');
  assert.equal(left.ctx.columnOrder[0], 'date');
  assert.equal(left.saves.length, 1);
});
