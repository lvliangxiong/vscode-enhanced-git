import { createReactDom } from './helpers/react-dom';
import { mountComponent } from './helpers/react-view';
import { createBranchControllerFixture } from './helpers/branch-controller';
import { BranchTree } from '../src/webview/react/branch-tree';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushSync } from 'react-dom';
import type { Branch } from '../src/shared/model';

const localBranches = (): Branch[] =>
  ['a', 'b', 'c'].map((name) => ({ name, ref: 'refs/heads/' + name, group: 'Local' }));

test('tree click, keyboard selection and context actions remain independent of the log filter', async (t) => {
  const branches = localBranches();
  const f = createBranchControllerFixture({ branches, ref: ['refs/heads/c'] });
  t.after(() => f.dispose());
  const actions = f.ctx.actions.branches;
  const locate = f.document.getElementById('branch-locate') as HTMLButtonElement;
  const row = (ref: string) => actions.branchRows().find((node) => node.dataset.ref === ref)!;
  const item = (label: string) => f.menu().find((entry) => entry.label === label)!;
  assert.equal(locate.disabled, true);
  actions.selectBranch('refs/heads/a');
  assert.equal(locate.disabled, false);
  actions.selectBranch('refs/heads/b', { metaKey: true });
  assert.deepEqual([...f.store.getState().selectedBranchRefs], ['refs/heads/a', 'refs/heads/b']);
  assert.equal(locate.disabled, true);
  actions.navigateSelectedBranch();
  assert.equal(f.destinations.length, 0);
  actions.openBranchMenu(branches[1], 0, 0);
  assert.equal(f.menu()[0].label, 'Compare Commit History');
  assert.equal(item('Update Selected').disabled, false, 'local selection needs no cached upstream');
  for (const groups of [
    ['Tags', 'Local'],
    ['Local', 'Tags'],
    ['Tags', 'Tags'],
  ] as const) {
    f.set({
      branches: branches.map((branch, index) => ({ ...branch, group: groups[index] || 'Local' })),
    });
    actions.openBranchMenu(f.store.getState().branches[1], 0, 0);
    for (const label of ['Compare Commit History', 'Show File Diffs'])
      assert.equal(item(label).disabled, false);
    assert.equal(item('Update Selected').disabled, true, 'tag selections cannot be updated');
  }
  f.set({ branches });
  assert.deepEqual(
    actions.branchTargets().map((branch) => branch.ref),
    ['refs/heads/a', 'refs/heads/b'],
  );
  actions.openBranchMenu(branches[2], 0, 0);
  assert.equal(item('Update').disabled, false);
  assert.deepEqual([...f.store.getState().selectedBranchRefs], ['refs/heads/c']);
  assert.equal(locate.disabled, false);
  assert.ok(
    f
      .menu()
      .every(
        (entry) =>
          !entry.label?.startsWith('Navigate Log') && !entry.label?.includes('as Favorite'),
      ),
  );
  actions.navigateSelectedBranch();
  assert.deepEqual(f.destinations, ['refs/heads/c']);
  actions.branchKey(
    new f.window.KeyboardEvent('keydown', { key: 'ArrowUp' }) as unknown as KeyboardEvent,
    row('refs/heads/c'),
  );
  assert.equal(f.document.activeElement, row('refs/heads/b'));
  assert.equal(row('refs/heads/b').getAttribute('aria-pressed'), 'true');
  assert.equal(row('refs/heads/c').getAttribute('aria-pressed'), 'false');
  actions.selectBranch('HEAD');
  actions.navigateSelectedBranch();
  assert.equal(f.destinations.at(-1), 'HEAD');
  actions.selectBranch('refs/heads/b', { shiftKey: true });
  assert.deepEqual(
    [...f.store.getState().selectedBranchRefs],
    ['HEAD', 'refs/heads/a', 'refs/heads/b'],
  );
  assert.deepEqual(f.store.getState().ref, ['refs/heads/c']);
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const event = new f.window.KeyboardEvent('keydown', {
      key: 'c',
      [modifier]: true,
      cancelable: true,
    });
    actions.branchKey(event as unknown as KeyboardEvent, row('refs/heads/b'));
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.messages.at(-1)?.text, 'HEAD\na\nb');
  }
  actions.openBranchMenu(branches[0], 0, 0);
  item('Copy Branch Names').action!();
  assert.equal(f.messages.at(-1)?.text, 'HEAD\na\nb');
  actions.selectBranch('refs/heads/c');
  actions.openBranchMenu(branches[2], 0, 0);
  item('Copy Branch Name').action!();
  assert.equal(f.messages.at(-1)?.text, 'c');
  assert.equal(f.counters.loads, 0);
});

test('non-adjacent commit selection opens comparison without losing either endpoint', async (t) => {
  const commits = ['a', 'b', 'c', 'd'].map((hash) => ({
    hash,
    parents: [] as string[],
    graphParents: undefined as string[] | undefined,
  }));
  const f = createBranchControllerFixture({ commits });
  t.after(() => f.dispose());
  const actions = f.ctx.actions.branches;
  const item = (label: string) => f.menu().find((entry) => entry.label === label);
  f.ctx.actions.commits.select(commits[0]);
  f.ctx.actions.commits.select(commits[2], { metaKey: true });
  actions.openCommitMenu(commits[2], 0, 0);
  assert.deepEqual([...f.store.getState().selected], ['a', 'c']);
  assert.ok(item('New Branch…')!.disabled);
  assert.ok(item('Go to Parent Commit')!.disabled);
  item('Compare Commit History')!.action!();
  assert.deepEqual(f.messages.at(-1), { type: 'commitCompare', hashes: ['a', 'c'] });
  actions.openCommitMenu(commits[0], 0, 0);
  item('Show File Diffs')!.action!();
  assert.deepEqual(f.messages.at(-1), { type: 'commitFiles', hashes: ['c', 'a'] });
  actions.openCommitMenu(commits[1], 0, 0);
  assert.deepEqual([...f.store.getState().selected], ['b']);
  assert.equal(item('Compare Commit History'), undefined);
  assert.equal(item('New Branch…')!.disabled, false);
  const next = commits.map((commit) =>
    commit.hash === 'b' ? { ...commit, parents: ['hidden'], graphParents: ['c'] } : commit,
  );
  f.set({ commits: next });
  assert.deepEqual(actions.commitNeighbors(next[1], true), ['c']);
  assert.deepEqual(actions.commitNeighbors(next[2], false), ['b']);
});

test('double-click branch activation replaces only the branch filter and remembers it', async (t) => {
  const f = createBranchControllerFixture({
    branches: [
      { name: 'main', ref: 'refs/heads/main', group: 'Local' },
      { name: 'origin/topic', ref: 'refs/remotes/origin/topic', group: 'Remote' },
    ],
    ref: ['old'],
  });
  t.after(() => f.dispose());
  for (const value of ['refs/heads/main', 'refs/remotes/origin/topic', 'HEAD']) {
    f.ctx.actions.branches.filterBranchFromTree(value);
    assert.deepEqual(f.store.getState().ref, [value]);
    assert.deepEqual([...f.store.getState().selectedBranchRefs], [value]);
    assert.equal(f.messages.at(-1)?.kind, 'branch');
    assert.deepEqual(f.messages.at(-1)?.values, [value]);
  }
  assert.equal(f.counters.loads, 3);
  assert.equal(f.counters.closed, 3);
  f.ctx.actions.branches.filterBranchFromTree('missing');
  assert.equal(f.counters.loads, 3);
});

test('Cmd double-click appends distinct branches and remembers the complete filter', async (t) => {
  const f = createBranchControllerFixture({
    branches: [
      { name: 'main', ref: 'refs/heads/main', group: 'Local' },
      { name: 'origin/topic', ref: 'refs/remotes/origin/topic', group: 'Remote' },
    ],
  });
  t.after(() => f.dispose());
  const activate = f.ctx.actions.branches.filterBranchFromTree;
  activate('refs/heads/main', true);
  assert.deepEqual(f.store.getState().ref, ['refs/heads/main']);
  activate('refs/remotes/origin/topic', true);
  const expected = ['refs/heads/main', 'refs/remotes/origin/topic'];
  assert.deepEqual(f.store.getState().ref, expected);
  assert.deepEqual(f.messages.at(-1)?.values, expected);
  assert.deepEqual(f.store.getState().filterRecents.branch[0], expected);
  activate('refs/heads/main', true);
  assert.deepEqual(f.store.getState().ref, expected);
  assert.equal(f.store.getState().filterRecents.branch.length, 2);
  f.set({ ref: ['main', 'refs/remotes/origin/topic'] });
  activate('refs/heads/main', true);
  assert.deepEqual(f.store.getState().ref, expected);
  // Exercise the real HEAD row's modifier handler, not a source-code assertion.
  flushSync(() =>
    f.document
      .getElementById('all')!
      .dispatchEvent(new f.window.MouseEvent('dblclick', { bubbles: true, metaKey: true })),
  );
  assert.deepEqual(f.store.getState().ref, [...expected, 'HEAD']);
  const loads = f.counters.loads;
  activate('missing', true);
  assert.equal(f.counters.loads, loads);
  activate('refs/heads/main');
  assert.deepEqual(f.store.getState().ref, ['refs/heads/main']);
});

test('marked branches stay in their original groups with selection, focus and search intact', async (t) => {
  const branches: Branch[] = [
    { name: 'main', ref: 'main', group: 'Local', current: true },
    { name: 'topic', ref: 'topic', group: 'Local' },
    { name: 'origin/topic', ref: 'origin/topic', group: 'Remote', remote: 'origin' },
  ];
  const f = createBranchControllerFixture({
    branches,
    favorites: new Set(['topic', 'origin/topic']),
    treeOpen: new Map([['Favorite', true]]),
  });
  t.after(() => f.dispose());
  const tree = f.document.getElementById('branches')!,
    all = f.document.getElementById('all')!;
  const actions = f.ctx.actions.branches;
  const group = (key: string) =>
    [...tree.children].find((node: HTMLElement) => node.dataset.key === key) as HTMLDetailsElement;
  const row = (ref: string, location: string) =>
    actions
      .branchRows()
      .find((node) => node.dataset.ref === ref && node.dataset.location === location);
  const rowRefs = () => actions.branchRows().map((node) => node.dataset.ref);
  assert.deepEqual(
    [...tree.children].map((node: HTMLElement) => node.dataset.key),
    ['Local', 'Remote'],
  );
  assert.equal(all.textContent, 'HEAD (Current Branch)');
  assert.equal(all.title, 'HEAD (main)');
  assert.deepEqual(rowRefs(), ['HEAD', 'main', 'topic', 'origin/topic']);
  assert.equal(row('origin/topic', 'Remote/origin')!.children[1].textContent, 'topic');
  assert.ok(row('topic', 'Local')!.querySelector('.icon-star'));
  assert.ok(row('origin/topic', 'Remote/origin')!.querySelector('.icon-star'));
  actions.selectBranch('topic', {}, row('topic', 'Local'));
  assert.equal(row('topic', 'Local')!.getAttribute('aria-pressed'), 'true');
  actions.selectBranch('origin/topic', { shiftKey: true }, row('origin/topic', 'Remote/origin'));
  assert.deepEqual([...f.store.getState().selectedBranchRefs], ['topic', 'origin/topic']);
  f.set({ branches: [...branches] });
  assert.equal((f.document.activeElement as HTMLElement).dataset.location, 'Remote/origin');
  actions.selectBranch('topic', {}, row('topic', 'Local'));
  tree.scrollTop = 125;
  tree.scrollLeft = 70;
  const icon = row('topic', 'Local')!.children[0] as HTMLElement;
  assert.equal(icon.onpointerdown ?? null, null);
  assert.equal(icon.onclick, null);
  assert.equal(icon.ondblclick, null);
  f.set({ favorites: new Set(['origin/topic']) });
  assert.ok(row('topic', 'Local')!.querySelector('.icon-branch'));
  assert.equal((f.document.activeElement as HTMLElement).dataset.ref, 'topic');
  assert.equal(tree.scrollTop, 125);
  assert.equal(tree.scrollLeft, 70);
  f.set({ favorites: new Set(['topic', 'origin/topic']) });
  assert.ok(row('topic', 'Local')!.querySelector('.icon-star'));
  assert.equal((f.document.activeElement as HTMLElement).dataset.location, 'Local');
  assert.equal(f.messages.length, 0);
  assert.deepEqual([...f.store.getState().selectedBranchRefs], ['topic']);
  f.set({ branchSearch: 'origin' });
  assert.deepEqual(
    [...tree.children].map((node: HTMLElement) => node.dataset.key),
    ['Remote'],
  );
  assert.deepEqual(rowRefs(), ['HEAD', 'origin/topic']);
  f.set({ branchSearch: 'does-not-exist' });
  assert.deepEqual(rowRefs(), ['HEAD']);
  assert.equal(group('Favorite'), undefined);
  assert.equal(tree.lastElementChild!.textContent, 'No matching branches, tags or stashes');
  f.set({ branchSearch: '', favorites: new Set() });
  assert.deepEqual(rowRefs(), ['HEAD', 'main', 'topic', 'origin/topic']);
  assert.equal(group('Favorite'), undefined);
  f.set({ branches: branches.map((branch) => ({ ...branch, current: branch.ref === 'topic' })) });
  assert.equal(all.textContent, 'HEAD (Current Branch)');
  assert.equal(all.title, 'HEAD (topic)');
  f.set({ branches: branches.map((branch) => ({ ...branch, current: false })) });
  assert.equal(all.textContent, 'HEAD (Current Branch)');
  f.set({ headLabel: 'release-v1' });
  assert.equal(all.title, 'HEAD (release-v1)');
  f.set({ headLabel: '1234abcd' });
  assert.equal(all.title, 'HEAD (1234abcd)');
  f.set({ branches: [branches[0]] });
  assert.deepEqual(
    [...tree.children].map((node: HTMLElement) => node.dataset.key),
    ['Local'],
  );
  f.set({ branches: [...branches, { name: 'v1', ref: 'refs/tags/v1', group: 'Tags' }] });
  assert.ok(group('Tags'));
  f.set({ branchSearch: 'v1' });
  assert.deepEqual(
    [...tree.children].map((node: HTMLElement) => node.dataset.key),
    ['Tags'],
  );
  f.set({ branches: [], branchSearch: '' });
  assert.equal(tree.children.length, 0);
  assert.equal(all.textContent, 'HEAD (Current Branch)');
});

test('React branch rows preserve native activation, menu, keyboard, badges and folder expansion', (t) => {
  const dom = createReactDom();
  const { document, window } = dom;
  const container = document.getElementById('root')!;
  const view = mountComponent(container, BranchTree);
  t.after(async () => {
    view.dispose();
    await dom.dispose();
  });
  const calls: { action: string; values: unknown[] }[] = [];
  const openGroups = new Map<string, boolean>();
  const model: Parameters<typeof view.render>[0] = {
    branches: [
      {
        name: 'feature/topic',
        ref: 'refs/heads/feature/topic',
        group: 'Local',
        behind: 123,
        ahead: 2,
      },
      { name: 'main', ref: 'refs/heads/main', group: 'Local', current: true },
      { name: 'v1', ref: 'refs/tags/v1', group: 'Tags' },
    ],
    favorites: new Set(),
    selectedRefs: new Set(),
    openGroups,
    query: '',
    onSelect: (...values) => calls.push({ action: 'select', values }),
    onActivate: (...values) => calls.push({ action: 'activate', values }),
    onContextMenu: (...values) => calls.push({ action: 'menu', values }),
    onKeyDown: (...values) => calls.push({ action: 'key', values }),
    onToggle: (key, open) => openGroups.set(key, open),
  };
  view.render(model);
  const row = container.querySelector<HTMLButtonElement>('[data-ref="refs/heads/feature/topic"]')!;
  const folder = row.parentElement as HTMLDetailsElement;
  assert.equal(folder.dataset.key, 'Local/feature');
  assert.equal(folder.open, false);
  assert.equal(row.querySelector('.branch-label')!.textContent, 'topic');
  assert.deepEqual(
    Array.from(row.querySelectorAll('.branch-count'), (badge: HTMLElement) => [
      badge.textContent,
      badge.title,
    ]),
    [
      ['↙ 99+', '123 incoming commits'],
      ['↗ 2', '2 outgoing commits'],
    ],
  );
  assert.ok(container.querySelector('[data-ref="refs/tags/v1"] .icon-tag'));
  assert.equal(
    container.querySelector('[data-ref="refs/heads/main"]')!.getAttribute('aria-current'),
    'true',
  );
  folder.open = true;
  folder.dispatchEvent(new window.Event('toggle'));
  assert.equal(openGroups.get('Local/feature'), true);

  const icon = row.querySelector('.branch-status-icon')!;
  const click = new window.MouseEvent('click', { bubbles: true, metaKey: true });
  icon.dispatchEvent(click);
  assert.equal(calls.at(-1)!.action, 'select');
  assert.equal(calls.at(-1)!.values[0], 'refs/heads/feature/topic');
  assert.equal(calls.at(-1)!.values[1], click, 'selection receives the original modifier event');
  assert.equal(calls.at(-1)!.values[2], row);

  for (const metaKey of [false, true]) {
    const event = new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, metaKey });
    row.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(calls.at(-1), {
      action: 'activate',
      values: ['refs/heads/feature/topic', metaKey, row],
    });
  }
  const menuEvent = new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 32,
    clientY: 48,
  });
  row.dispatchEvent(menuEvent);
  assert.equal(menuEvent.defaultPrevented, true);
  assert.deepEqual(calls.at(-1), {
    action: 'menu',
    values: [{ ...model.branches[0], display: 'feature/topic' }, 32, 48, row],
  });
  const keyEvent = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'F10',
    shiftKey: true,
  });
  row.dispatchEvent(keyEvent);
  assert.equal(keyEvent.defaultPrevented, true);
  assert.deepEqual(calls.at(-2), { action: 'key', values: [keyEvent, row] });
  assert.deepEqual(calls.at(-1), {
    action: 'menu',
    values: [{ ...model.branches[0], display: 'feature/topic' }, 0, 0, row],
  });

  model.query = 'feature';
  view.render(model);
  assert.equal(folder.open, true);
  folder.open = false;
  folder.dispatchEvent(new window.Event('toggle'));
  assert.equal(
    openGroups.get('Local/feature'),
    true,
    'search expansion must not overwrite saved expansion',
  );
  model.query = '';
  model.selectedRefs = new Set(['refs/heads/feature/topic']);
  view.render(model);
  assert.equal(folder.open, true, 'leaving search restores the saved folder expansion');
  assert.equal(
    container.querySelector('[data-ref="refs/heads/feature/topic"]'),
    row,
    'stable ref keys preserve existing row DOM',
  );
  assert.equal(row.getAttribute('aria-pressed'), 'true');
  assert.ok(row.classList.contains('active'));
});

test('Stashes shows reflog order, searches descriptions and navigates hashes without branch actions', async (t) => {
  const f = createBranchControllerFixture({ branches: localBranches() });
  t.after(() => f.dispose());
  const stashes = [
    { ref: 'stash@{0}', hash: 'newest', subject: 'On feature/topic: <draft> newer work' },
    { ref: 'stash@{1}', hash: 'older', subject: 'On main: older work' },
  ];
  const navigated: string[] = [];
  f.ctx.actions.commits.navigateToRevision = (hash) => navigated.push(hash);
  f.set({ stashes, selectedBranchRefs: new Set(['main']) });
  const group = f.document.querySelector<HTMLDetailsElement>('[data-key="Stashes"]')!;
  assert.equal(group.open, true);
  const rows = [...group.querySelectorAll<HTMLButtonElement>('.stash-row')];
  assert.deepEqual(
    rows.map((row) => row.textContent),
    stashes.map((stash) => `${stash.ref}: ${stash.subject}`),
  );
  assert.equal(rows[0].querySelector('draft'), null, 'stash messages remain literal text');
  assert.equal(
    group.querySelectorAll('details').length,
    0,
    'slashes in descriptions are not folders',
  );
  rows[1].click();
  assert.deepEqual(navigated, ['older']);
  assert.equal(f.store.getState().selectedBranchRefs.size, 0);
  assert.deepEqual(f.ctx.actions.branches.branchTargets(), []);
  assert.equal(f.ctx.actions.branchTools.branchToolState().delete, false);
  assert.ok(
    f.ctx.actions.branches.branchRows().every((row) => !row.classList.contains('stash-row')),
  );
  f.set({ selected: new Set(['older']), branchSearch: 'older work' });
  assert.equal(f.document.querySelectorAll('.stash-row').length, 1);
  assert.equal(f.document.querySelector('.stash-row')!.getAttribute('aria-pressed'), 'true');
  f.set({ stashes: [], branchSearch: '' });
  assert.equal(f.document.querySelector('[data-key="Stashes"]'), null);
  f.ctx.actions.branches.navigateStash(stashes[0]);
  assert.deepEqual(
    navigated,
    ['older'],
    'removed entries cannot navigate using a recycled stash number',
  );
});

test('Rebased current-reference icons retain checkout identity when favorites and selection change', async (t) => {
  const branches: Branch[] = [
    { name: 'main', ref: 'refs/heads/main', group: 'Local', current: true },
    { name: 'topic', ref: 'refs/heads/topic', group: 'Local' },
    { name: 'v1', ref: 'refs/tags/v1', group: 'Tags' },
  ];
  const f = createBranchControllerFixture({
    branches,
    favorites: new Set(['refs/heads/main', 'refs/heads/topic']),
  });
  t.after(() => f.dispose());
  const icon = (ref: string) => f.document.querySelector(`[data-ref="${ref}"] .branch-icon`)!;
  assert.ok(icon('refs/heads/main').classList.contains('icon-current-branch-favorite'));
  assert.ok(icon('refs/heads/topic').classList.contains('icon-star'));
  f.set({
    favorites: new Set(['refs/heads/topic']),
    selectedBranchRefs: new Set(['refs/heads/main']),
  });
  assert.ok(icon('refs/heads/main').classList.contains('icon-current-branch'));
  f.set({ selectedBranchRefs: new Set(['refs/heads/topic']) });
  assert.ok(
    icon('refs/heads/main').classList.contains('icon-current-branch'),
    'selection is independent from the checked-out reference',
  );
  f.set({ branches: branches.map((branch) => ({ ...branch, current: branch.name === 'topic' })) });
  assert.ok(icon('refs/heads/topic').classList.contains('icon-current-branch-favorite'));
  assert.ok(icon('refs/heads/main').classList.contains('icon-branch'));
  f.set({
    branches: branches.map((branch) => ({ ...branch, current: false })),
    headLabel: 'v1',
    favorites: new Set(),
  });
  assert.ok(icon('refs/tags/v1').classList.contains('icon-current-branch'));
  f.set({ favorites: new Set(['refs/tags/v1']) });
  assert.ok(icon('refs/tags/v1').classList.contains('icon-current-branch-favorite'));
  assert.equal(f.messages.length, 0, 'rendering never performs a Git write operation');
});
