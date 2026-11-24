import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLayout } from '../src/webview/merge/layout';
import { mergeAlignment, createMergeAlignment } from '../src/webview/merge/alignment';
import { createMergeScroll } from '../src/webview/merge/scroll';
import { mergeDiffStyle, type MergeDiffData } from '../src/shared/merge-diff';
import { createReactDom } from './helpers/react-dom';

const data: MergeDiffData = {
  path: 'file',
  labels: ['left', 'result', 'right'],
  contents: ['A\nB\nC\nD', 'A\nx\ny\nz\nB\nD', 'A\nx\ny\nz\nB\nold\nolder\nD'],
  patches: ['@@ -1,0 +2,3 @@\n@@ -3 +5,0 @@\n', '@@ -6,2 +5,0 @@\n'],
};

test('Native Style aligns insertions, unequal deletions and later shared context without changing source text', () => {
  assert.equal(mergeDiffStyle(undefined), 'native');
  assert.equal(mergeDiffStyle('invalid'), 'native');
  assert.equal(mergeDiffStyle('jetbrains'), 'jetbrains');
  const layout = mergeLayout(data),
    counts = data.contents.map((text) => text.split('\n').length);
  const gaps = mergeAlignment(layout, counts);
  const row = (side: number, source: number) =>
    source +
    gaps[side]
      .filter((gap) => gap.afterLineNumber <= source)
      .reduce((sum, gap) => sum + gap.lines, 0);
  assert.deepEqual(
    [row(0, 1), row(1, 4), row(2, 4)],
    [4, 4, 4],
    'B aligns after a three-line insertion',
  );
  assert.deepEqual(
    [row(0, 3), row(1, 5), row(2, 7)],
    [7, 7, 7],
    'D aligns after overlapping parent deletions',
  );
  assert.deepEqual(
    counts.map((count, side) => row(side, count)),
    [8, 8, 8],
  );
  assert.ok(
    gaps.every((side, index) =>
      side.every((gap) => gap.lines > 0 && gap.afterLineNumber <= counts[index]),
    ),
  );
  const beginning = mergeLayout({
    ...data,
    contents: ['', 'one\ntwo', ''],
    patches: ['@@ -0,0 +1,2 @@\n', '@@ -0,0 +1,2 @@\n'],
  });
  assert.deepEqual(mergeAlignment(beginning, [1, 2, 1]), [
    [{ afterLineNumber: 0, lines: 2 }],
    [{ afterLineNumber: 2, lines: 1 }],
    [{ afterLineNumber: 0, lines: 2 }],
  ]);
});

test('alignment zones rebuild for font changes, synchronize pixel scrolling, navigate and dispose independently', async () => {
  const dom = createReactDom();
  const originals = [...data.contents];
  const layout = mergeLayout(data);
  let id = 0;
  const editors = data.contents.map((text) => {
    const zones = new Map<string, any>();
    const scroll = new Set<(event: any) => void>(),
      focus = new Set<() => void>();
    const count = text.split('\n').length;
    let top = 0;
    return {
      zones,
      getModel: () => ({ getLineCount: () => count, getValue: () => text }),
      changeViewZones(fn) {
        fn({
          addZone(zone) {
            const key = String(++id);
            zones.set(key, zone);
            return key;
          },
          removeZone(key) {
            zones.delete(key);
          },
        });
      },
      getTopForLineNumber: (line) =>
        8 +
        (line - 1) * 20 +
        [...zones.values()]
          .filter((zone) => zone.afterLineNumber < line)
          .reduce((sum, zone) => sum + zone.heightInPx, 0),
      getLayoutInfo: () => ({ height: 60 }),
      getScrollTop: () => top,
      setScrollTop(value) {
        if (top !== value) {
          top = value;
          scroll.forEach((fn) => fn({ scrollTopChanged: true }));
        }
      },
      onDidScrollChange(fn) {
        scroll.add(fn);
        return { dispose: () => scroll.delete(fn) };
      },
      onDidFocusEditorText(fn) {
        focus.add(fn);
        return { dispose: () => focus.delete(fn) };
      },
      focus() {
        focus.forEach((fn) => fn());
      },
      listeners: () => scroll.size + focus.size,
    };
  });
  const alignment = createMergeAlignment(editors as any, layout);
  const sync = createMergeScroll(
    editors as any,
    layout,
    () => 20,
    () => {},
    true,
  );
  try {
    alignment.update(20);
    const ids = editors.map((e) => [...e.zones.keys()]);
    alignment.update(20);
    assert.deepEqual(
      editors.map((e) => [...e.zones.keys()]),
      ids,
      'unchanged fonts do not recreate zones',
    );
    assert.deepEqual(
      [
        editors[0].getTopForLineNumber(4),
        editors[1].getTopForLineNumber(6),
        editors[2].getTopForLineNumber(8),
      ],
      [148, 148, 148],
    );
    editors[0].setScrollTop(75);
    assert.deepEqual(
      editors.map((e) => e.getScrollTop()),
      [75, 75, 75],
    );
    sync.navigate(1);
    assert.equal(
      new Set(editors.map((e) => e.getScrollTop())).size,
      1,
      'navigation targets the same aligned pixel',
    );
    alignment.update(30);
    assert.ok(
      editors.flatMap((e) => [...e.zones.values()]).every((zone) => zone.heightInPx % 30 === 0),
    );
    assert.deepEqual(
      editors.map((e) => e.getModel().getValue()),
      originals,
    );
    sync.dispose();
    alignment.dispose();
    assert.ok(editors.every((e) => e.zones.size === 0 && e.listeners() === 0));
  } finally {
    sync.dispose();
    alignment.dispose();
    await dom.dispose();
  }
});

test('overlapping parent hunks align inner shared context and use the largest deletion gap only once', () => {
  const values: MergeDiffData = {
    ...data,
    contents: ['A\nB\nC\nD', 'A\nx\ny\nz\nB\nD', 'A\np\nq\nr\ns\nt\nD'],
    patches: ['@@ -1,0 +2,3 @@\n@@ -3 +5,0 @@\n', '@@ -2,5 +2,4 @@\n'],
  };
  const gaps = mergeAlignment(mergeLayout(values), [4, 6, 7]);
  const row = (side: number, line: number) =>
    line +
    gaps[side]
      .filter((gap) => gap.afterLineNumber <= line)
      .reduce((sum, gap) => sum + gap.lines, 0);
  assert.deepEqual([row(0, 1), row(1, 4), row(2, 4)], [4, 4, 4]);
  assert.deepEqual([row(0, 3), row(1, 5), row(2, 6)], [6, 6, 6]);
  assert.deepEqual(gaps[1], [{ afterLineNumber: 5, lines: 1 }]);
});
