import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutReferenceGroups,
  referenceIconWidth,
  referenceIconStep,
  referenceWidthBudget,
  shortenReferenceName,
} from '../src/shared/reference-layout';
import type { ReferenceGroup } from '../src/shared/reference-labels';
const measure = (text: string) => text.length * 7;
const groups: ReferenceGroup[] = [
  {
    name: 'origin/master_release_saas_11.10.1',
    refs: [{ name: 'origin/master_release_saas_11.10.1', kind: 'remote' }],
  },
  { name: 'release-v2', refs: [{ name: 'release-v2', kind: 'tag' }] },
  { name: 'release-v1', refs: [{ name: 'release-v1', kind: 'tag' }] },
];
test('compact references preserve readable names while expanded references can use more space', () => {
  const compact = referenceWidthBudget(600, 900, true, false);
  const expanded = referenceWidthBudget(600, 900, false, false);
  assert.equal(compact, 0);
  assert.equal(expanded, 520);
  const narrow = layoutReferenceGroups(groups.slice(0, 1), compact, true, measure);
  assert.equal(narrow[0].name.length, 22);
  assert.ok(narrow[0].name.startsWith('../'));
  assert.deepEqual(layoutReferenceGroups(groups, expanded, false, measure), groups);
  assert.equal(shortenReferenceName('origin/main', 0, measure), 'origin/main');
  assert.equal(shortenReferenceName(groups[0].name, 1000, measure), groups[0].name);
});
test('expanded overflow combines remaining references and preserves their hover names', () => {
  const labels = layoutReferenceGroups(groups, 270, false, measure);
  assert.equal(labels.length, 2);
  assert.equal(labels[1].name, '');
  assert.deepEqual(
    labels.flatMap((label) => label.refs),
    groups.flatMap((group) => group.refs),
  );
  assert.equal(referenceWidthBudget(600, 20, true, false), 200);
  assert.equal(referenceWidthBudget(600, 900, true, true), 200);
  assert.equal(referenceWidthBudget(-20, 900, false, false), 0);
});

test('Rebased tag offsets scale from LabelIcon.SIZE rather than treating the source offset as pixels', () => {
  assert.equal(referenceIconStep, 5.12);
  const refs = [
    { name: 'HEAD', kind: 'head' as const },
    { name: 'main', kind: 'local' as const },
    { name: 'origin/main', kind: 'remote' as const },
  ];
  assert.deepEqual(
    [1, 2, 3].map((count) => referenceIconWidth(refs.slice(0, count))),
    [16, 21, 26],
  );
  assert.equal(
    referenceIconWidth(
      Array.from({ length: 20 }, (_, index) => ({
        name: `branch-${index}`,
        kind: 'local' as const,
      })),
    ),
    21,
    'same-type references still use at most two layers',
  );
});
