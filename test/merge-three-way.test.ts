import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { selectionPatch } from '../src/extension/git/changes';
import { mergeLayout } from '../src/webview/merge/layout';
import { mergeResultLayout } from '../src/webview/merge/three-way';
import type { MergeDiffData } from '../src/shared/merge-diff';

function layout(contents: [string, string, string], patches: [string, string]) {
  const data: MergeDiffData = {
    path: 'file',
    labels: ['left', 'result', 'right'],
    contents,
    patches,
  };
  return mergeResultLayout(data, mergeLayout(data));
}

test('overlapping parent changes form one conflicting three-way fragment with matching boundaries', () => {
  const data: MergeDiffData = {
    path: 'file',
    labels: ['left', 'result', 'right'],
    contents: [
      'start\nleft call\nend',
      'start\n<<<<<<< HEAD\nleft call\n=======\nright call\n>>>>>>> other\nend',
      'start\nright call\nend',
    ],
    patches: ['@@ -1,0 +2 @@\n@@ -2,0 +4,3 @@\n', '@@ -1,0 +2,3 @@\n@@ -2,0 +6 @@\n'],
  };
  const raw = mergeLayout(data),
    merged = mergeResultLayout(data, raw);
  assert.equal(raw.pairs[0].length, 2, 'the raw/native layout keeps independent hunks');
  assert.deepEqual(merged.pairs, [
    [{ before: { start: 1, end: 2 }, after: { start: 1, end: 6 }, kind: 'conflict' }],
    [{ before: { start: 1, end: 2 }, after: { start: 1, end: 6 }, kind: 'conflict' }],
  ]);
  assert.deepEqual(merged.sides[1], [{ start: 1, end: 6, kind: 'conflict' }]);
  assert.equal(merged.anchors, raw.anchors, 'scrolling retains precise pairwise matching');
  assert.equal(raw.pairs[0].length, 2, 'presentation does not mutate the native layout');
});

test('merge-result colors distinguish insertions, deletions, equal edits and conflicts; unchanged parents stay unshaded', () => {
  const cases: {
    contents: [string, string, string];
    patches: [string, string];
    kind: string;
    parents: number[];
  }[] = [
    {
      contents: ['A\nC', 'A\nB\nC', 'A\nB\nC'],
      patches: ['@@ -1,0 +2 @@\n', ''],
      kind: 'inserted',
      parents: [0],
    },
    {
      contents: ['A\nB\nC', 'A\nB\nC', 'A\nC'],
      patches: ['', '@@ -1,0 +2 @@\n'],
      kind: 'inserted',
      parents: [1],
    },
    {
      contents: ['A\nC', 'A\nB\nC', 'A\nC'],
      patches: ['@@ -1,0 +2 @@\n', '@@ -1,0 +2 @@\n'],
      kind: 'inserted',
      parents: [0, 1],
    },
    {
      contents: ['A\nB\nC', 'A\nC', 'A\nC'],
      patches: ['@@ -2 +1,0 @@\n', ''],
      kind: 'deleted',
      parents: [0],
    },
    {
      contents: ['A\nB\nC', 'A\nC', 'A\nB\nC'],
      patches: ['@@ -2 +1,0 @@\n', '@@ -2 +1,0 @@\n'],
      kind: 'deleted',
      parents: [0, 1],
    },
    {
      contents: ['A\nold\nC', 'A\nnew\nC', 'A\nnew\nC'],
      patches: ['@@ -2 +2 @@\n', ''],
      kind: 'modified',
      parents: [0],
    },
    {
      contents: ['A\nold\nC', 'A\nnew\nC', 'A\nold\nC'],
      patches: ['@@ -2 +2 @@\n', '@@ -2 +2 @@\n'],
      kind: 'modified',
      parents: [0, 1],
    },
    {
      contents: ['A\nleft\nC', 'A\nresult\nC', 'A\nright\nC'],
      patches: ['@@ -2 +2 @@\n', '@@ -2 +2 @@\n'],
      kind: 'conflict',
      parents: [0, 1],
    },
    {
      contents: ['A\nleft\nC', 'A\nC', 'A\nright\nC'],
      patches: ['@@ -2 +1,0 @@\n', '@@ -2 +1,0 @@\n'],
      kind: 'conflict',
      parents: [0, 1],
    },
  ];
  for (const item of cases) {
    const value = layout(item.contents, item.patches);
    assert.deepEqual(
      value.pairs.flatMap((pair, index) => (pair.length ? [index] : [])),
      item.parents,
    );
    assert.ok(
      value.pairs.flat().every((pair) => pair.kind === item.kind),
      JSON.stringify(item),
    );
    for (const parent of [0, 1])
      if (!item.parents.includes(parent)) assert.deepEqual(value.sides[parent ? 2 : 0], []);
    assert.ok(value.sides.flat().every((range) => range.start < range.end));
  }
});

test('merge matching keeps repeated function bodies together instead of matching an error line hundreds of lines later', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-merge-matching-'));
  const func = (name: string, operation: string, response = name) =>
    [
      `function ${name}() {`,
      '  const ctx = context();',
      `  const req = ${name}Request();`,
      '  if (!bind(req)) {',
      `    report("${operation}");`,
      '    return;',
      '  }',
      `  ${operation}(ctx, req);`,
      `  respond("${response}");`,
      '}',
      '',
    ].join('\n');
  const left = func('oldTask', 'oldOperation', 'current response') + 'const tail = true;\n';
  const result =
    func('newTask', 'newOperation', 'current response') +
    Array.from({ length: 30 }, (_, i) => func(`inserted${i}`, `operation${i}`)).join('') +
    'const tail = true;\n';
  try {
    const patch = await selectionPatch(
      root,
      {
        path: 'file.ts',
        before: { hash: 'a'.repeat(40), path: 'file.ts' },
        after: { hash: 'b'.repeat(40), path: 'file.ts' },
      },
      0,
      [left, result],
      'histogram',
    );
    const value = layout([left, result, result], [patch, '']);
    const inserted = value.pairs[0].filter((pair) => pair.kind === 'inserted');
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].after.end - inserted[0].after.start, 300);
    assert.ok(
      value.pairs[0]
        .filter((pair) => pair.kind === 'modified')
        .every((pair) => pair.after.end <= 10),
    );
    assert.deepEqual(value.sides[2], [], 'result-matching parent receives no extra changes');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
