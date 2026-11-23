import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseValues,
  remember,
  recentEntries,
  branchSelection,
  resolveUsers,
  matchPositions,
  searchEntries,
} from '../src/shared/filters';
const { git, log, pathChildren } = require('../out/extension/git/index');

test('speed search preserves nested branch groups and highlights substring or abbreviated matches', () => {
  const items = [
    { label: 'Select…' },
    { label: 'HEAD' },
    { label: 'origin/feature_aac', branch: {} },
    { label: 'Recent', children: [{ label: 'main|feature_aac', value: ['main', 'feature_aac'] }] },
    { separator: true },
    { label: 'Local', children: [{ label: 'main' }, { label: 'feature_aac' }] },
    { label: 'origin/…', children: [{ label: 'origin/feature_aac' }, { label: 'origin/release' }] },
  ];
  const result = searchEntries(items, 'aac');
  assert.deepEqual(
    result.filter((e) => e.heading).map((e) => e.heading),
    ['Recent', 'Local', 'origin/…'],
  );
  assert.equal(result.filter((e) => e.label).length, 4);
  assert.deepEqual(matchPositions('feature_aac', 'AAC'), [8, 9, 10]);
  assert.deepEqual(matchPositions('feature_aac', 'faac'), [0, 8, 9, 10]);
  assert.ok(matchPositions('auto_respond_action', 'aac'));
  assert.equal(matchPositions('framework_panic', 'aac'), null);
  assert.equal(matchPositions('main', 'xyz'), null);
  assert.deepEqual(searchEntries(items, 'no-such-branch'), []);
});
test('date and path speed search filter actions without losing their callbacks or recent values', () => {
  const action = () => {};
  assert.deepEqual(
    searchEntries(
      [{ label: 'Select…' }, { label: 'Last 24 hours' }, { label: 'Last 7 days', action }],
      '7',
    ).map((e) => e.label),
    ['Last 7 days'],
  );
  const tree = searchEntries([{ label: 'Select…' }, { label: 'Select in Tree…', action }], 'tree');
  assert.equal(tree[0].action, action);
  const paths = searchEntries(
    [
      { label: 'Select…' },
      { heading: 'Recent' },
      { label: 'src/…', value: ['src/very/long/hidden.go'] },
    ],
    'hidden',
  );
  assert.equal(paths[0].heading, 'Recent');
  assert.deepEqual(paths[1].value, ['src/very/long/hidden.go']);
});

test('Rebased multiline separators and recent groups preserve paths and deduplicate selections', () => {
  assert.deepEqual(parseValues(' main | feature\nmain\n  ', 'branch'), ['main', 'feature']);
  assert.deepEqual(parseValues('me\nAlice | Bob', 'user'), ['me', 'Alice', 'Bob']);
  assert.deepEqual(parseValues('folder with spaces/a|b.txt\nother/', 'paths'), [
    'folder with spaces/a|b.txt',
    'other/',
  ]);
  let recent = [];
  for (let i = 0; i < 12; i++) recent = remember(recent, [String(i)]);
  assert.equal(recent.length, 10);
  assert.deepEqual(recent[0], ['11']);
  assert.deepEqual(remember([['a', 'b'], ['c']], ['b', 'a']), [['b', 'a'], ['c']]);
});
test('Recent hides stale branch groups and restores complete selections without changing Paths history order', () => {
  const model = {
    root: '/repo',
    branches: ['main', 'feature/a', 'feature/b'].map((name) => ({
      name,
      ref: 'refs/heads/' + name,
    })),
    paths: ['docs/', 'src/'],
    recents: {
      branch: [
        ['deleted'],
        ['main'],
        ['feature/.*', '-feature/b'],
        ['main', 'deleted'],
        ['main..feature/a'],
        ['[invalid'],
        [],
      ],
      user: [['Alice', 'Bob']],
      paths: [['/repo/src', '/repo/docs'], ['/repo/file.txt']],
    },
  };
  assert.deepEqual(
    recentEntries('branch', model).map((e) => e.value),
    [['main'], ['feature/.*', '-feature/b'], ['main', 'deleted'], ['main..feature/a']],
  );
  const paths = recentEntries('paths', model);
  assert.equal(paths[0].checked, true);
  assert.equal(paths[0].label, 'src, docs');
  assert.equal(paths[1].checked, false);
  assert.equal(
    paths[0].addRecent,
    false,
    'selecting an existing Paths entry must not reorder Recent',
  );
  assert.equal(
    recentEntries('user', model)[0].addRecent,
    undefined,
    'User history selections are promoted',
  );
  const values = ['main'];
  const saved = remember([], values);
  values.push('unexpected');
  assert.deepEqual(saved, [['main']]);
});
test('branch filter resolves names, patterns and exclusions without treating exclusion as ancestry subtraction', () => {
  const branches = ['main', 'feature/a', 'feature/b', 'release'].map((name) => ({
    name,
    ref: 'refs/heads/' + name,
  }));
  assert.deepEqual(branchSelection(['feature/.*', '-feature/b'], branches).revisions, [
    'refs/heads/feature/a',
  ]);
  assert.deepEqual(branchSelection(['main', 'release'], branches).revisions, [
    'refs/heads/main',
    'refs/heads/release',
  ]);
  assert.deepEqual(branchSelection(['main..feature/a'], branches).ranges, [['main', 'feature/a']]);
  assert.throws(() => branchSelection(['--all'], branches));
  assert.throws(() => branchSelection(['main..--all'], branches));
  assert.throws(() => branchSelection(['[invalid'], branches));
  assert.deepEqual(branchSelection(['absent'], branches).revisions, []);
});
test('me and author names resolve multiple identities, email prefixes and case', () => {
  const authors = [
    { name: 'Alice Smith', email: 'alice@old.example' },
    { name: 'Alice Smith', email: 'alice@new.example' },
    { name: 'Bob', email: 'bob@example.com' },
  ];
  assert.equal(
    resolveUsers(['me'], authors, { name: 'Alice Smith', email: 'alice@new.example' }).length,
    2,
  );
  assert.equal(resolveUsers(['ALICE.SMITH'], authors, { name: '', email: '' }).length, 2);
  assert.deepEqual(resolveUsers(['bob'], authors, { name: '', email: '' }), [authors[2]]);
  assert.deepEqual(resolveUsers(['unknown'], authors, { name: '', email: '' }), []);
});
test('menus produce working branch ranges, author and timestamp filters, and safe remote-capable path trees', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-popup-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Alice']);
    await git(root, ['config', 'user.email', 'alice@example.com']);
    await fs.mkdir(path.join(root, 'folder space'));
    await fs.writeFile(path.join(root, 'folder space', 'a|b.txt'), 'base');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'base']);
    const base = (await log(root))[0];
    await git(root, ['switch', '-c', 'feature/a']);
    await fs.writeFile(path.join(root, 'a.txt'), 'a');
    await git(root, ['add', '.']);
    await git(root, [
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--author=Bob <bob@example.com>',
      '-m',
      'a',
    ]);
    const a = (await log(root, 'HEAD'))[0];
    await git(root, ['switch', 'main']);
    await git(root, ['switch', '-c', 'feature/b']);
    await fs.writeFile(path.join(root, 'b.txt'), 'b');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'b']);
    const b = (await log(root, 'HEAD'))[0];
    assert.deepEqual(
      new Set((await log(root, ['feature/.*', '-feature/b'])).map((c) => c.hash)),
      new Set([a.hash, base.hash]),
    );
    assert.deepEqual(
      (await log(root, ['main..feature/a'])).map((c) => c.hash),
      [a.hash],
    );
    assert.deepEqual(
      new Set((await log(root, ['main..feature/a', 'main..feature/b'])).map((c) => c.hash)),
      new Set([a.hash, b.hash]),
    );
    assert.equal((await log(root, ['missing-branch'])).length, 0);
    assert.deepEqual(
      (await log(root, [], 300, { authorQueries: ['BOB'] })).map((c) => c.hash),
      [a.hash],
    );
    assert.deepEqual(
      new Set((await log(root, [], 300, { authorQueries: ['me'] })).map((c) => c.hash)),
      new Set([base.hash, b.hash]),
    );
    assert.equal((await log(root, [], 300, { authorQueries: ['me', 'Bob'] })).length, 3);
    assert.equal((await log(root, [], 300, { authorQueries: ['nobody'] })).length, 0);
    assert.equal((await log(root, [], 300, { since: '2100-01-01T00:00:00.000Z' })).length, 0);
    assert.equal(
      (await log(root, [], 300, { since: new Date(Date.parse(b.date) + 60000).toISOString() }))
        .length,
      0,
    );
    assert.equal(
      (await log(root, [], 300, { until: new Date(Date.parse(base.date) - 60000).toISOString() }))
        .length,
      0,
    );
    assert.equal(
      (
        await log(root, [], 300, {
          since: new Date(Date.parse(base.date) - 60000).toISOString(),
          until: new Date(Date.parse(b.date) + 60000).toISOString(),
        })
      ).length,
      3,
    );
    await assert.rejects(log(root, [], 300, { since: '2026-02-31' }));
    assert.deepEqual(
      (await log(root, [], 300, { paths: ['folder space/a|b.txt'] })).map((c) => c.hash),
      [base.hash],
    );
    assert.deepEqual(
      (await log(root, [], 300, { paths: [path.join(root, 'folder space')] })).map((c) => c.hash),
      [base.hash],
    );
    await fs.mkdir(path.join(root, 'untracked'));
    await fs.writeFile(path.join(root, 'untracked', 'new.txt'), 'new');
    const tree = await pathChildren(root);
    assert.ok(tree.some((c) => c.path === 'untracked/' && c.directory));
    assert.ok(!tree.some((c) => c.name === '.git'));
    assert.deepEqual(
      (await pathChildren(root, 'folder space/')).map((c) => c.path),
      ['folder space/a|b.txt'],
    );
    await fs.symlink(os.tmpdir(), path.join(root, 'outside'));
    await assert.rejects(pathChildren(root, '../'));
    await assert.rejects(pathChildren(root, 'outside'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Recent retains full single and grouped labels for uniform CSS width measurement', () => {
  const single = 'origin/' + 'long-branch-'.repeat(8),
    values = ['origin/' + 'a'.repeat(35), 'feature/second'];
  const entries = recentEntries('branch', {
    root: '/repo',
    paths: [],
    branches: [],
    recents: { branch: [[single], values] },
  });
  assert.equal(entries[0].label, single);
  assert.equal(entries[1].label, values.join('|'));
  assert.deepEqual(entries[1].value, values);
});

test('Recent displays short branch names but retains exact refs for selection and deletion', () => {
  const branches = [
    { name: 'main', ref: 'refs/heads/main' },
    { name: 'origin/main', ref: 'refs/remotes/origin/main' },
  ];
  const values = ['refs/heads/main', 'refs/remotes/origin/main'];
  const groups = [
    values,
    ['-refs/heads/main'],
    ['refs/heads/main..refs/remotes/origin/main'],
    ['HEAD', 'feature/.*'],
  ];
  const entries = recentEntries('branch', {
    root: '/repo',
    paths: [],
    branches,
    recents: { branch: groups },
  });
  assert.equal(entries[0].label, 'main|origin/main');
  assert.deepEqual(entries[0].displayValues, ['main', 'origin/main']);
  assert.equal(entries[0].value, values, 'display formatting must not rewrite stored history');
  assert.deepEqual(branchSelection(entries[0].value, branches).revisions, values);
  assert.equal(entries[1].label, '-main');
  assert.equal(entries[2].label, 'main..origin/main');
  assert.equal(entries[3].label, 'HEAD|feature/.*');
  assert.deepEqual(
    entries.map((entry) => entry.value),
    groups,
  );
  const unloaded = recentEntries('branch', {
    root: '/repo',
    paths: [],
    branches: [],
    recents: { branch: [values, ['refs/heads/feature/.*']] },
  });
  assert.equal(unloaded[0].label, 'main|origin/main');
  assert.equal(unloaded[1].label, 'refs/heads/feature/.*', 'do not shorten regex patterns');
});
