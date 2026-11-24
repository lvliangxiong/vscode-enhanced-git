import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReactDom } from './helpers/react-dom';
import {
  connectorPath,
  connectorBorders,
  createMergeConnectors,
} from '../src/webview/merge/connectors';
import { mergeLayout, transferLine } from '../src/webview/merge/layout';
import { createMergeScroll } from '../src/webview/merge/scroll';
import type { MergeDiffData } from '../src/shared/merge-diff';

function fixture(): MergeDiffData {
  const before = Array.from({ length: 200 }, (_, i) => `line ${i}`);
  const result = [...before.slice(0, 5), ...Array(40).fill('added'), ...before.slice(5)];
  return {
    path: 'file',
    labels: ['left', 'result', 'right'],
    contents: [before.join('\n'), result.join('\n'), result.join('\n')],
    patches: ['@@ -5,0 +6,40 @@\n', ''],
  };
}
function fakeEditor(count: number, height = 120, deferred?: (() => void)[]) {
  let top = 0,
    left = 0,
    focused = false;
  const scroll = new Set<(event: any) => void>(),
    focus = new Set<() => void>(),
    layout = new Set<() => void>();
  return {
    getModel: () => ({ getLineCount: () => count }),
    getTopForLineNumber: (line) => 8 + (Math.min(count, Math.max(1, line)) - 1) * 20,
    getLayoutInfo: () => ({ height, horizontalScrollbarHeight: 0 }),
    getScrollTop: () => top,
    getScrollLeft: () => left,
    setScrollTop(value) {
      const next = Math.max(0, Math.min(value, count * 20 + 16 - height));
      if (next !== top) {
        top = next;
        const emit = () => scroll.forEach((fn) => fn({ scrollTopChanged: true, scrollTop: next }));
        if (deferred) deferred.push(emit);
        else emit();
      }
    },
    setScrollLeft(value) {
      left = value;
      scroll.forEach((fn) => fn({ scrollTopChanged: false }));
    },
    onDidScrollChange(fn) {
      scroll.add(fn);
      return { dispose: () => scroll.delete(fn) };
    },
    onDidFocusEditorText(fn) {
      focus.add(fn);
      return { dispose: () => focus.delete(fn) };
    },
    onDidLayoutChange(fn) {
      layout.add(fn);
      return { dispose: () => layout.delete(fn) };
    },
    focus() {
      focused = true;
      focus.forEach((fn) => fn());
    },
    focused: () => focused,
    subscriptions: () => scroll.size + focus.size + layout.size,
  };
}

test('Rebased-style scroll mapping clamps a large insertion without padding either parent and supports reverse scrolling', () => {
  const data = fixture(),
    layout = mergeLayout(data);
  assert.equal(transferLine(layout.anchors[0], 25, 1), 5);
  assert.equal(transferLine(layout.anchors[0], 60, 1), 20);
  assert.equal(transferLine(layout.anchors[0], 20, 0), 60);
  const editors = data.contents.map((text) => fakeEditor(text.split('\n').length));
  let paints = 0;
  const support = createMergeScroll(
    editors as any,
    layout,
    () => 20,
    () => paints++,
  );
  editors[1].setScrollTop(468);
  assert.equal(editors[0].getScrollTop(), 68);
  assert.equal(editors[2].getScrollTop(), 468);
  editors[1].setScrollTop(1168);
  assert.equal(editors[0].getScrollTop(), 368);
  assert.equal(editors[2].getScrollTop(), 1168);
  editors[0].setScrollTop(1168);
  assert.equal(editors[1].getScrollTop(), 1968);
  assert.equal(editors[2].getScrollTop(), 1968);
  support.navigate(1);
  assert.equal(editors[0].getScrollTop(), 48);
  assert.equal(editors[1].getScrollTop(), 48);
  assert.ok(editors[1].focused());
  assert.ok(paints < 25, 'synchronizing must not create a scroll feedback loop');
  support.revealChange(0, 2);
  assert.ok(editors[2].focused(), 'overview navigation focuses the clicked pane');
  assert.deepEqual(
    editors.map((editor) => editor.getScrollTop()),
    [48, 48, 48],
  );
  support.dispose();
  assert.ok(editors.every((editor) => editor.subscriptions() === 0));
});

test('scrolling through unmatched inserted lines keeps the shorter pane stationary at sub-line precision', () => {
  const data = fixture();
  const editors = data.contents.map((text) => fakeEditor(text.split('\n').length));
  const support = createMergeScroll(
    editors as any,
    mergeLayout(data),
    () => 20,
    () => {},
  );
  try {
    const positions: number[] = [];
    for (let top = 468; top <= 528; top++) {
      editors[1].setScrollTop(top);
      positions.push(editors[0].getScrollTop());
      assert.equal(editors[2].getScrollTop(), top);
    }
    assert.ok(
      positions.every((top) => top === 68),
      `short pane must not bounce every line: ${positions}`,
    );
    editors[1].setScrollTop(868);
    assert.equal(editors[0].getScrollTop(), 68);
    editors[1].setScrollTop(869);
    assert.ok(
      Math.abs(editors[0].getScrollTop() - 69) < 1e-6,
      'movement resumes smoothly after the inserted range',
    );
    editors[1].setScrollTop(868);
    editors[1].setScrollTop(867);
    assert.equal(
      editors[0].getScrollTop(),
      68,
      'reverse scrolling stays steady inside the insertion',
    );
  } finally {
    support.dispose();
  }
});

test('deferred synchronized scroll events cannot take control or pull the long pane back at a clamped boundary', () => {
  for (const aligned of [false, true]) {
    const queue: (() => void)[] = [];
    const data = fixture();
    const editors = data.contents.map((text) => fakeEditor(text.split('\n').length, 120, queue));
    const support = createMergeScroll(
      editors as any,
      mergeLayout(data),
      () => 20,
      () => {},
      aligned,
    );
    const flush = () => {
      let count = 0;
      while (queue.length) {
        assert.ok(count++ < 50, 'scroll feedback must terminate');
        queue.shift()();
      }
    };
    try {
      editors[1].setScrollTop(468);
      flush();
      assert.equal(editors[1].getScrollTop(), 468);
      assert.equal(editors[2].getScrollTop(), 468);
      assert.equal(editors[0].getScrollTop(), aligned ? 468 : 68);
      editors[1].setScrollTop(4500);
      flush();
      assert.equal(
        editors[1].getScrollTop(),
        4500,
        'short pane reaching its bottom must not scroll the driver',
      );
      assert.equal(editors[2].getScrollTop(), 4500);
      editors[0].setScrollTop(1000);
      flush();
      assert.equal(
        editors[1].getScrollTop(),
        aligned ? 1000 : 1800,
        'user can immediately scroll a different pane',
      );
      support.navigate(1);
      const positions = editors.map((editor) => editor.getScrollTop());
      flush();
      assert.deepEqual(
        editors.map((editor) => editor.getScrollTop()),
        positions,
        'navigation cannot trigger reverse synchronization',
      );
    } finally {
      support.dispose();
    }
  }
});

test('curved diff paths support zero-height insertion points and unequal blocks', () => {
  assert.equal(
    connectorPath(100, 128, { start: 50, end: 50 }, { start: 50, end: 850 }),
    'M100,50 C114,50 114,50 128,50 L128,850 C114,850 114,50 100,50 Z',
  );
  assert.equal(
    connectorBorders(100, 128, { start: 50, end: 50 }, { start: 50, end: 850 }),
    'M100,50 C114,50 114,50 128,50 M128,850 C114,850 114,50 100,50',
    'the outline contains only upper/lower curves, without vertical closing strokes',
  );
});

test('connector painting clips headers, repaints on resize, releases offscreen paths and forwards channel scrolling', async () => {
  const dom = createReactDom(
    '<div class="merge-panes"><div class="merge-editor"></div><div class="merge-sash"></div><div class="merge-editor"></div><div class="merge-sash"></div><div class="merge-editor"></div><svg class="merge-connectors"></svg></div>',
  );
  const restore = ['requestAnimationFrame', 'cancelAnimationFrame'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key] of restore)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key].bind(dom.window),
    });
  let width = 300;
  const root = dom.document.querySelector<HTMLElement>('.merge-panes'),
    containers = [...dom.document.querySelectorAll<HTMLElement>('.merge-editor')];
  root.getBoundingClientRect = () => ({ left: 0, top: 0 }) as any;
  containers.forEach((node, side) => {
    node.getBoundingClientRect = () =>
      ({
        left: side * (width + 28),
        right: side * (width + 28) + width,
        top: 30,
        bottom: 230,
      }) as any;
  });
  const text = Array(200).fill('line').join('\n');
  const patches = Array.from(
    { length: 40 },
    (_, i) => `@@ -${i * 5 + 1} +${i * 5 + 1} @@\n-old\n+new\n`,
  ).join('');
  const layout = mergeLayout({
    path: 'file',
    labels: ['l', 'm', 'r'],
    contents: [text, text, text],
    patches: [patches, patches],
  });
  const editors = [fakeEditor(200, 200), fakeEditor(200, 200), fakeEditor(200, 200)];
  const paint = createMergeConnectors(containers, editors as any, layout, () => 20);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
  try {
    await tick();
    const svg = root.querySelector('svg');
    assert.equal(svg.querySelectorAll('clipPath rect').length, 3);
    assert.equal(svg.querySelector('clipPath rect').getAttribute('y'), '30');
    const first = svg.querySelector('.merge-connector');
    assert.ok(first.getAttribute('d').startsWith('M300,'));
    const outline = svg.querySelector('.merge-connector-border');
    assert.ok(outline);
    assert.doesNotMatch(outline.getAttribute('d'), /[LHVZ]/);
    const count = svg.querySelectorAll('path').length;
    assert.ok(count > 0 && count < 30);
    const middleEdges = [...svg.querySelectorAll('g')[1].querySelectorAll('.merge-change-edge')];
    assert.equal(
      new Set(middleEdges.map((edge) => edge.getAttribute('d'))).size,
      middleEdges.length,
      'the shared result boundary is not double-painted at a higher opacity',
    );
    width = 340;
    paint.schedule();
    await tick();
    assert.ok(first.getAttribute('d').startsWith('M340,'));
    editors.forEach((editor) => editor.setScrollTop(2000));
    paint.schedule();
    await tick();
    assert.equal(first.isConnected, false, 'offscreen paths must not accumulate');
    assert.ok(svg.querySelectorAll('path').length < 30);
    const event = new dom.window.WheelEvent('wheel', { deltaY: 60, cancelable: true });
    root.querySelector('.merge-sash').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(editors[1].getScrollTop(), 2060);
    paint.dispose();
    assert.equal(svg.children.length, 0);
    assert.ok(editors.every((editor) => editor.subscriptions() === 0));
  } finally {
    paint.dispose();
    for (const [key, descriptor] of restore) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.dispose();
  }
});

test('overlapping parent changes shade the merge result once and merge navigation ranges', () => {
  const text = Array(100).fill('line').join('\n');
  const layout = mergeLayout({
    path: 'file',
    labels: ['l', 'm', 'r'],
    contents: [text, text, text],
    patches: ['@@ -10,0 +11,40 @@\n', '@@ -21,10 +21,10 @@\n'],
  });
  assert.deepEqual(layout.sides[1], [
    { start: 10, end: 20, kind: 'inserted' },
    { start: 20, end: 30, kind: 'modified' },
    { start: 30, end: 50, kind: 'inserted' },
  ]);
  assert.equal(layout.changes.length, 1);
  assert.deepEqual(layout.changes[0][1], { start: 10, end: 50 });
  assert.deepEqual(layout.changes[0][0], { start: 10, end: 10 });
});
