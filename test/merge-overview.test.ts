import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLayout } from '../src/webview/merge/layout';
import { mergeResultLayout } from '../src/webview/merge/three-way';
import {
  mergeOverviewMarkers,
  nearestOverviewChange,
  createMergeOverviewNavigation,
} from '../src/webview/merge/overview';
import { createReactDom } from './helpers/react-dom';
import { mergeTheme } from '../src/webview/merge/theme';
import type { MergeDiffData } from '../src/shared/merge-diff';

const data: MergeDiffData = {
  path: 'file',
  labels: ['left', 'result', 'right'],
  contents: ['', 'one\ntwo', ''],
  patches: ['@@ -0,0 +1,2 @@\n', '@@ -0,0 +1,2 @@\n'],
};

test('overview includes empty insertion/deletion points and deduplicates shared result markers', () => {
  const raw = mergeLayout(data),
    layout = mergeResultLayout(data, raw);
  assert.deepEqual(mergeOverviewMarkers(layout, 0, false, 1), [
    { line: 1, endLine: 1, kind: 'inserted', change: 0 },
  ]);
  assert.deepEqual(mergeOverviewMarkers(layout, 1, false, 2), [
    { line: 1, endLine: 2, kind: 'inserted', change: 0 },
  ]);
  const deletion: MergeDiffData = {
    ...data,
    contents: ['keep\ngone', 'keep', 'keep'],
    patches: ['@@ -2 +1,0 @@\n', ''],
  };
  const deleted = mergeResultLayout(deletion, mergeLayout(deletion));
  assert.deepEqual(
    mergeOverviewMarkers(deleted, 1, false, 1),
    [{ line: 1, endLine: 1, kind: 'deleted', change: 0 }],
    'a deletion at EOF clamps to a real model line instead of disappearing',
  );
  assert.deepEqual(
    mergeOverviewMarkers(deleted, 2, false, 1),
    [],
    'unchanged parents have no markers',
  );
  assert.deepEqual(
    mergeOverviewMarkers(mergeLayout({ ...data, patches: ['', ''] }), 1, true, 2),
    [],
  );
});

test('overview colors follow Native Style and three-way conflict classification', () => {
  const conflict: MergeDiffData = {
    ...data,
    contents: ['left', 'result', 'right'],
    patches: ['@@ -1 +1 @@\n', '@@ -1 +1 @@\n'],
  };
  const raw = mergeLayout(conflict),
    layout = mergeResultLayout(conflict, raw);
  for (const side of [0, 1, 2])
    assert.equal(mergeOverviewMarkers(layout, side, false, 1)[0].kind, 'conflict');
  assert.equal(mergeOverviewMarkers(raw, 0, true, 1)[0].kind, 'deleted');
  assert.equal(mergeOverviewMarkers(raw, 1, true, 1)[0].kind, 'inserted');
  const theme = mergeTheme(
    {
      getPropertyValue: (key) => (key === '--vscode-editorGutter-addedBackground' ? '#abc' : ''),
    } as any,
    'vscode-light',
  );
  assert.equal(theme.colors['editorGutter.addedBackground'], '#aabbcc');
  assert.equal(theme.colors['editorGutter.deletedBackground'], '#f14c4c');
});

test('overview clicks select actual diff intervals using aligned offsets, including empty and final-line markers', () => {
  const markers = [
    { line: 2, endLine: 2, kind: 'modified' as const, change: 0 },
    { line: 10, endLine: 15, kind: 'inserted' as const, change: 1 },
    { line: 30, endLine: 30, kind: 'deleted' as const, change: 2 },
  ];
  // A Native Style view zone shifts all later source lines by 400 pixels.
  const top = (line: number) => (line - 1) * 20 + (line >= 10 ? 400 : 0);
  assert.equal(nearestOverviewChange(markers, 25, top), 0);
  assert.equal(nearestOverviewChange(markers, 650, top), 1);
  assert.equal(nearestOverviewChange(markers, 980, top), 2);
  assert.equal(nearestOverviewChange([], 980, top), undefined);
});

test('overview pointer navigation snaps to changes without taking over thumb dragging and disposes on style changes', async () => {
  const dom = createReactDom(
    '<div id="editor"><canvas class="decorationsOverviewRuler"></canvas><div class="scrollbar vertical"><div class="slider"></div></div></div>',
  );
  const container = dom.document.getElementById('editor');
  container.getBoundingClientRect = () => ({ top: 50 }) as any;
  const reveals: number[] = [],
    propagated: Event[] = [];
  container.addEventListener('pointerdown', (event) => propagated.push(event));
  const support = createMergeOverviewNavigation(
    container,
    {
      getLayoutInfo: () => ({ overviewRuler: { top: 0, height: 100 } }),
      getScrollHeight: () => 2000,
      getTopForLineNumber: (line) => (line - 1) * 20,
      getModel: () => ({ getLineCount: () => 100 }),
    } as any,
    [{ line: 50, endLine: 55, kind: 'modified', change: 3 }],
    () => 20,
    (index) => reveals.push(index),
  );
  const fire = (target: Element, button = 0) => {
    const event = new dom.window.MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientY: 100,
      button,
    });
    target.dispatchEvent(event);
    return event;
  };
  try {
    const canvas = container.querySelector('canvas');
    assert.equal(fire(canvas).defaultPrevented, true);
    assert.deepEqual(reveals, [3]);
    assert.equal(propagated.length, 0, 'do not also invoke Monaco approximate track scrolling');
    assert.equal(fire(container.querySelector('.scrollbar.vertical')).defaultPrevented, true);
    assert.deepEqual(
      reveals,
      [3, 3],
      'transparent scrollbar tracks also cover the overview canvas',
    );
    assert.equal(fire(container.querySelector('.slider')).defaultPrevented, false);
    assert.equal(fire(canvas, 2).defaultPrevented, false);
    assert.deepEqual(reveals, [3, 3]);
    support.dispose();
    assert.equal(fire(canvas).defaultPrevented, false);
    assert.deepEqual(reveals, [3, 3], 'disposed presentations cannot navigate');
  } finally {
    support.dispose();
    await dom.dispose();
  }
});
