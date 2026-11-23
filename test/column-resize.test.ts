import type { MockNode } from './helpers/mocks';
import { createColumnsController, resizeSubsequentColumns } from '../src/webview/log/columns';
import { createLogStore } from '../src/webview/state/log';
import { test } from 'node:test';
import assert from 'node:assert/strict';
function setup(order: string[], key: string, measured: Record<string, number> = {}) {
  const widths = { date: 170, author: 120, subject: 400, hash: 85, ...measured };
  const store = createLogStore();
  const saves: any[] = [];
  store.setState({
    columnOrder: order,
    viewSettings: { date: true, author: true, hash: false },
    columnWidths: { date: 170, author: 120, subject: 400, hash: 85 },
  });
  const sheet = {
    cssRules: [],
    insertRule() {
      this.cssRules.push({ style: {} });
      return this.cssRules.length - 1;
    },
  };
  const controller = createColumnsController({
    store,
    env: {
      layoutSheet: sheet,
      api: {
        getState: () => ({}),
        setState(value) {
          saves.push(value);
        },
      },
      window: {
        requestAnimationFrame: (callback) => callback(),
        cancelAnimationFrame() {},
        matchMedia: () => ({ matches: false }),
      },
    },
    actions: { graph: { repaintGraphCanvases() {} } },
  } as any);
  const row = {
    querySelector: (selector) => ({
      getBoundingClientRect: () => ({ width: widths[selector.match(/"([^"]+)"/)[1]] }),
    }),
  };
  const grip: MockNode = { parentElement: { parentElement: row }, setPointerCapture() {} };
  controller.installColumnResize(grip as unknown as HTMLElement, key);
  return {
    store,
    saves,
    controller,
    grip,
    event: (x) => ({
      button: 0,
      clientX: x,
      pointerId: 1,
      preventDefault() {},
      stopPropagation() {},
    }),
  };
}
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('drag preserves preceding columns and shares shrinkage across all subsequent visible columns', () => {
  const t = setup(['date', 'subject', 'hash', 'author'], 'subject');
  t.grip.onpointerdown(t.event(100));
  t.grip.onpointermove(t.event(130));
  assert.deepEqual(t.store.getState().columnWidths, {
    date: 170,
    subject: 430,
    author: 90,
    hash: 85,
  });
  const multi = setup(['subject', 'author', 'date'], 'subject');
  multi.grip.onpointerdown(multi.event(100));
  multi.grip.onpointermove(multi.event(190));
  const widths = multi.store.getState().columnWidths;
  near(widths.subject, 490);
  near(widths.author, 87.5); // 65 / (65 + 115) of the 90px reduction
  near(widths.date, 112.5);
  assert.equal(multi.saves.length, 0);
  multi.grip.onpointerup();
  assert.deepEqual(multi.saves[0].columnWidths, widths);
  assert.equal(multi.grip.onpointermove, null);
});

test('graph on the right participates in capacity distribution and hidden columns stay untouched', () => {
  const t = setup(['date', 'hash', 'subject', 'author'], 'date');
  t.grip.onpointerdown(t.event(100));
  t.grip.onpointermove(t.event(147));
  const widths = t.store.getState().columnWidths;
  near(widths.date, 217);
  near(widths.subject, 366); // capacity 170:65 => 34px:13px
  near(widths.author, 107);
  assert.equal(widths.hash, 85);
  t.grip.onpointermove(t.event(100));
  assert.deepEqual(
    t.store.getState().columnWidths,
    { date: 170, author: 120, subject: 400, hash: 85 },
    'returning the pointer restores starting widths',
  );
});

test('keyboard expansion uses maximum-width capacity and preserves total width', () => {
  const t = setup(['subject', 'author', 'date'], 'subject');
  t.grip.onkeydown({ ...t.event(0), key: 'ArrowLeft' });
  const widths = t.store.getState().columnWidths;
  const maximum = 2147483647;
  near(widths.subject, 390);
  near(widths.author, 120 + (10 * (maximum - 120)) / (2 * maximum - 290));
  near(widths.date, 170 + (10 * (maximum - 170)) / (2 * maximum - 290));
  near(widths.subject + widths.author + widths.date, 690);
  assert.equal(t.saves.length, 1);
});

test('movement stops at collective right minimum or the held minimum; final column cannot resize', () => {
  const t = setup(['date', 'author', 'subject'], 'date');
  t.grip.onpointerdown(t.event(100));
  t.grip.onpointermove(t.event(1000));
  assert.deepEqual(t.store.getState().columnWidths, {
    date: 405,
    author: 55,
    subject: 230,
    hash: 85,
  });
  t.grip.onpointermove(t.event(-1000));
  near(t.store.getState().columnWidths.date, 55);
  near(t.store.getState().columnWidths.subject + t.store.getState().columnWidths.author, 635);
  const last = setup(['subject', 'date', 'author'], 'author');
  last.grip.onpointerdown(last.event(100));
  assert.equal(last.grip.onpointermove, undefined);
});

test('resize snapshots rendered sizes rather than restoring larger saved widths to preceding columns', () => {
  const t = setup(['subject', 'date', 'author'], 'date', { subject: 250, date: 90, author: 80 });
  t.grip.onpointerdown(t.event(100));
  t.grip.onpointermove(t.event(110));
  assert.deepEqual(t.store.getState().columnWidths, {
    subject: 250,
    date: 100,
    author: 70,
    hash: 85,
  });
});

test('sub-minimum columns do not jump and exhausted successors do not take additional shrinkage', () => {
  const before = [
    { key: 'date', width: 40, min: 55 },
    { key: 'subject', width: 180, min: 230 },
    { key: 'author', width: 100, min: 55 },
  ];
  assert.deepEqual(resizeSubsequentColumns(before, 0, -100), before);
  const result = resizeSubsequentColumns(before, 0, 100);
  assert.deepEqual(
    result.map((c) => c.width),
    [85, 180, 55],
  );
  assert.deepEqual(
    before.map((c) => c.width),
    [40, 180, 100],
    'the drag snapshot is immutable',
  );
});
