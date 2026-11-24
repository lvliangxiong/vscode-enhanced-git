import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceGroups } from '../src/shared/reference-labels';
import type { Branch } from '../src/shared/model';
const branches: Branch[] = [
  {
    name: 'main',
    ref: 'refs/heads/main',
    group: 'Local',
    current: true,
    upstream: 'refs/remotes/origin/main',
  },
  { name: 'origin/main', ref: 'refs/remotes/origin/main', group: 'Remote', current: false },
  { name: 'feature/test', ref: 'refs/heads/feature/test', group: 'Local', current: false },
];
test('reference labels merge HEAD and tracking labels and preserve full tooltip names', () => {
  assert.deepEqual(referenceGroups('HEAD -> main', branches), [
    {
      name: 'main',
      refs: [
        { name: 'HEAD', kind: 'head' },
        { name: 'main', kind: 'local' },
      ],
    },
  ]);
  const groups = referenceGroups('tag: v1, origin/main, HEAD -> main, feature/test', branches);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'origin & main');
  assert.deepEqual(
    groups[0].refs.map((r) => r.name),
    ['HEAD', 'main', 'origin/main', 'feature/test', 'v1'],
  );
  const expanded = referenceGroups(
    'tag: v1, origin/main, HEAD -> main, feature/test',
    branches,
    false,
  );
  assert.deepEqual(
    expanded.map((g) => g.name),
    ['origin & main', 'feature/test', 'v1'],
  );
});
test('stash labels deduplicate refs/stash and keep detached HEAD and same-name tag distinct', () => {
  assert.deepEqual(referenceGroups('refs/stash, stash@{0}'), [
    { name: 'stash@{0}', refs: [{ name: 'stash@{0}', kind: 'stash' }] },
  ]);
  assert.equal(referenceGroups('stash@{2}')[0].name, 'stash@{2}');
  assert.deepEqual(
    referenceGroups('HEAD, tag: main', branches).map((g) => g.name),
    ['HEAD', 'main'],
  );
  assert.equal(referenceGroups('HEAD')[0].name, 'HEAD');
  assert.deepEqual(
    referenceGroups(
      'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/main',
      branches,
    )[0].refs.map((r) => r.kind),
    ['head', 'local', 'remote', 'tag'],
  );
  assert.deepEqual(referenceGroups(''), []);
});
