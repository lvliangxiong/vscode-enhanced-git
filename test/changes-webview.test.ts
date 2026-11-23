import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReactDom } from './helpers/react-dom';
import { mountChanges } from '../src/webview/react/changes-app';
import type { TestContext } from 'node:test';

// Exercise actual React/DOM events, including the browser's delayed <details>
// toggle delivery. A bulk action must produce one persistence write/report.
function fixture(t: TestContext, initialState: Record<string, unknown> = {}) {
  const dom = createReactDom('<style id="layout-style"></style><section id="changes"></section>');
  const { document, window } = dom;
  const frames = new Map<number, () => void>();
  let saved = initialState,
    writes = 0,
    frame = 0;
  const messages: Record<string, any>[] = [];
  window.HTMLElement.prototype.getClientRects = function () {
    if (this.hidden) return [];
    for (let parent = this.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === 'DETAILS' && !(parent as HTMLDetailsElement).open) return [];
    return [{}];
  } as unknown as typeof window.HTMLElement.prototype.getClientRects;
  const drawer = document.getElementById('changes')!;
  window.requestAnimationFrame = (callback) => {
    frames.set(++frame, () => callback(0));
    return frame;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  mountChanges({
    api: {
      getState: () => saved,
      setState: (value) => {
        saved = value as Record<string, unknown>;
        writes++;
        return value;
      },
      postMessage: (message) => messages.push(message),
    },
    fileIcons: {
      create: () => ({
        set: (node: HTMLElement, path: string) => {
          node.dataset.path = path;
        },
      }),
    },
    document,
    window: window as unknown as Window,
  });
  t.after(async () => {
    window.dispatchEvent(new window.Event('unload'));
    await dom.dispose();
  });
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  }
  return {
    send: (data) => window.dispatchEvent(new window.MessageEvent('message', { data })),
    settle,
    nodes: () => [drawer, ...drawer.querySelectorAll<HTMLElement>('*')],
    messages,
    saved: () => saved as any,
    writes: () => writes,
    drawer,
    list: drawer.querySelector<HTMLElement>('.branch-changes-files')!,
    document,
    window,
  };
}
const comparison = {
  type: 'branchChanges',
  id: 'first',
  pair: [{ name: 'main' }, { name: 'other' }],
  files: Array.from({ length: 400 }, (_, index) => ({
    index,
    path: `module${index}/file.ts`,
    status: 'M',
  })),
};

test('large comparison batches expansion and ignores delayed toggles after reset', async (t) => {
  const f = fixture(t);
  f.send(comparison);
  await f.settle();
  const folders = f.nodes().filter((node) => node.tagName === 'DETAILS') as HTMLDetailsElement[];
  assert.equal(folders.length, 400);
  assert.equal(f.writes(), 1, 'initial open events do not persist each folder');
  for (const expanded of [false, true, false]) {
    const writes = f.writes(),
      messages = f.messages.length;
    f.send({ type: 'comparisonAction', action: 'expansion', expanded });
    await f.settle();
    assert.equal(f.writes() - writes, 1);
    assert.equal(f.messages.length - messages, 1);
    assert.equal(f.messages.at(-1).expanded, expanded);
    assert.ok(folders.every((folder) => folder.open === expanded));
    assert.ok(f.saved().opened.every(([, open]) => open === expanded));
  }
  folders[0].open = true; // queued before reset, delivered after its DOM is gone
  f.send({ type: 'branchChanges' });
  const writes = f.writes();
  await f.settle();
  assert.equal(f.writes(), writes);
  assert.equal(f.saved().opened.length, 0);
  assert.equal(f.saved().chosen, undefined);
  assert.equal(f.messages.at(-1).hasFolders, false);
  assert.equal(
    f.nodes().some((node) => node.tagName === 'DETAILS'),
    false,
  );
});

test('individual folding and selection persist without redundant toolbar messages', async (t) => {
  const f = fixture(t);
  f.send(comparison);
  await f.settle();
  const folders = f.nodes().filter((node) => node.tagName === 'DETAILS') as HTMLDetailsElement[];
  folders[0].open = false;
  await f.settle();
  assert.equal(f.messages.at(-1).expanded, false);
  assert.equal(f.saved().opened[0][1], false);
  const messages = f.messages.length;
  folders[1].open = false;
  await f.settle();
  assert.equal(f.messages.length, messages, 'all-expanded state has not changed');
  f.nodes()
    .find((node) => node.tagName === 'BUTTON')!
    .click();
  await f.settle();
  assert.equal(f.saved().chosen, 0);
  assert.equal(f.messages.length, messages, 'selection does not update folder controls');
  f.send({ ...comparison, id: 'refresh', previousId: 'first' });
  await f.settle();
  assert.equal(f.saved().chosen, 0);
  assert.equal(
    (f.nodes().find((node) => node.tagName === 'DETAILS') as HTMLDetailsElement).open,
    false,
  );
});

test('comparison React view preserves welcome, flat sorting, file actions and reset', async (t) => {
  const f = fixture(t);
  assert.match(f.list.textContent!, /Select two branches or commits/);
  f.list.querySelector<HTMLButtonElement>('.open-git-log')!.click();
  assert.equal(f.messages.at(-1)!.type, 'openGitLog');
  assert.ok(f.messages.some((message) => message.type === 'ready'));
  const files = [
    { index: 5, path: 'src/nested/z.ts', status: 'M' },
    { index: 7, path: 'README.md', status: 'A' },
    { index: 12, path: 'lib/a.ts', status: 'D' },
  ];
  f.send({ ...comparison, files });
  await f.settle();
  assert.equal(f.list.getAttribute('aria-label'), 'Branch changes');
  assert.equal(f.drawer.getAttribute('aria-label'), 'File Diffs between Branches');
  assert.equal(
    f.list.querySelector('.folder-count'),
    null,
    'sidebar keeps its existing count-free folder labels',
  );
  assert.deepEqual(
    Array.from(f.list.querySelectorAll('summary .folder-name'), (node) => node.textContent),
    ['lib', 'src/nested'],
  );
  const original = f.list.querySelector<HTMLButtonElement>('[data-index="5"]')!;
  original.click();
  await f.settle();
  assert.equal(f.saved().chosen, 5);
  assert.ok(original.classList.contains('selected'));
  assert.equal(
    f.list.querySelector('[data-index="5"]'),
    original,
    'selection keeps the file row and focus target stable',
  );
  original.dispatchEvent(new f.window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(f.messages.at(-1)!.type, 'branchChangesFile');
  assert.equal(f.messages.at(-1)!.index, 5);
  assert.equal(f.messages.at(-1)!.id, 'first');
  const enter = new f.window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  original.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(f.messages.at(-1)!.index, 5);

  f.send({ type: 'comparisonAction', action: 'tree', tree: false });
  await f.settle();
  assert.equal(f.saved().tree, false);
  assert.equal(f.list.querySelector('details'), null);
  assert.deepEqual(
    Array.from(f.list.querySelectorAll('.file'), (node: HTMLElement) => node.dataset.index),
    ['12', '7', '5'],
  );
  assert.equal(f.list.querySelector('[data-index="5"] .file-directory')!.textContent, 'src/nested');
  assert.equal(f.list.querySelector('[data-index="7"] .file-directory'), null);
  assert.equal(f.messages.at(-1)!.hasFolders, false);
  f.send({ ...comparison, id: 'empty', files: [] });
  await f.settle();
  assert.equal(f.list.textContent, 'No differences.');
  f.list.scrollTop = 123;
  f.send({ type: 'branchChanges' });
  await f.settle();
  assert.match(f.list.textContent!, /Open Git Log/);
  assert.equal(f.list.scrollTop, 0);
  assert.equal(f.saved().chosen, undefined);
  assert.equal(f.saved().opened.length, 0);
});

test('comparison restoration, refresh and visible-row keyboard navigation retain their state', async (t) => {
  const f = fixture(t, { id: 'first', chosen: 0, scroll: 88, opened: [['closed', false]] });
  const data = {
    ...comparison,
    pair: [
      { name: 'before', kind: 'commit', hash: 'a' },
      { name: 'after', kind: 'commit', hash: 'b' },
    ],
    files: [
      { index: 0, path: 'open/first.ts', status: 'M' },
      { index: 1, path: 'closed/hidden.ts', status: 'M' },
      { index: 2, path: 'open/second.ts', status: 'M' },
    ],
  };
  f.send(data);
  await f.settle();
  assert.equal(f.saved().chosen, 0);
  assert.equal(f.list.scrollTop, 88);
  assert.equal(f.drawer.getAttribute('aria-label'), 'File Diffs between Commits');
  assert.equal(f.list.getAttribute('aria-label'), 'Commit changes');
  assert.match(f.drawer.title, /File Diffs: before ↔ after/);
  assert.match(f.drawer.title, /a\nb$/);
  const first = f.list.querySelector<HTMLButtonElement>('[data-index="0"]')!;
  first.focus();
  first.dispatchEvent(
    new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
  );
  await f.settle();
  assert.equal(f.saved().chosen, 2, 'keyboard skips files inside closed folders');
  assert.equal((f.document.activeElement as HTMLElement).dataset.index, '2');
  f.document.activeElement!.dispatchEvent(
    new f.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
  );
  await f.settle();
  assert.equal(f.saved().chosen, 0);
  const openFile = f.list.querySelector<HTMLButtonElement>(
    '[aria-label="Open File: open/first.ts"]',
  )!;
  openFile.focus();
  openFile.dispatchEvent(
    new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
  );
  await f.settle();
  assert.equal(f.saved().chosen, 2, 'arrow navigation from Open File follows its own row');
  f.document.activeElement!.dispatchEvent(
    new f.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
  );
  await f.settle();
  f.send({
    ...data,
    id: 'refresh',
    previousId: 'first',
    files: data.files.map((file) => ({ ...file, index: file.index + 10 })),
  });
  await f.settle();
  assert.equal(f.saved().chosen, 10, 'refresh restores selection by path when indices change');
  assert.equal(f.list.scrollTop, 88);
  assert.equal(f.list.querySelector('[data-index="11"]')!.closest('details')!.open, false);
  f.send({
    ...data,
    id: 'working',
    pair: [
      { name: 'HEAD', kind: 'commit' },
      { name: 'Working Tree', kind: 'workingTree' },
    ],
  });
  await f.settle();
  assert.equal(f.drawer.getAttribute('aria-label'), 'File Diffs with Working Tree');
  assert.equal(f.list.getAttribute('aria-label'), 'Working Tree changes');
  assert.equal(f.saved().chosen, undefined, 'a new comparison does not inherit the selected file');
});

test('selected commit changes retain exact selection labels, file actions, icons and refresh state', async (t) => {
  const f = fixture(t);
  const selection = {
    type: 'selectionChanges',
    kind: 'selection',
    id: 'selection',
    repository: '/workspace/repo',
    commits: [
      { hash: 'c'.repeat(40), subject: 'Third commit' },
      { hash: 'a'.repeat(40), subject: 'First commit' },
    ],
    files: [
      { index: 4, path: 'src/selected.ts', status: 'M' },
      { index: 8, path: 'README.md', status: 'A' },
    ],
  };
  f.send(selection);
  await f.settle();
  const summary = f.drawer.querySelector<HTMLDetailsElement>('.selected-commit-summary')!;
  assert.equal(summary.querySelector('summary')!.getAttribute('aria-label'), '2 selected commits');
  assert.equal(summary.open, false);
  assert.deepEqual(
    [...summary.querySelectorAll('li')].map((node) => node.textContent),
    ['ccccccccThird commit', 'aaaaaaaaFirst commit'],
    'shows the chosen commits rather than inventing a continuous range',
  );
  assert.match(
    f.drawer.querySelector('[role="tooltip"]')!.textContent!,
    /intervening edits to the same file may appear/,
  );
  assert.equal(
    summary.querySelector('p'),
    null,
    'explanation does not take space from the file tree',
  );
  assert.equal(f.drawer.getAttribute('aria-label'), 'File Diffs for Selected Commits');
  assert.equal(f.list.getAttribute('aria-label'), 'Selected commit changes');
  assert.match(f.drawer.title, /2 selected commits\n\/workspace\/repo/);
  assert.ok(f.drawer.title.endsWith(selection.commits.map((commit) => commit.hash).join('\n')));
  assert.equal(
    f.list.querySelector<HTMLElement>('[data-index="4"] > span')!.dataset.path,
    'src/selected.ts',
    'selection mode uses the shared file theme service',
  );
  const selected = f.list.querySelector<HTMLButtonElement>('[data-index="4"]')!;
  selected.dispatchEvent(new f.window.MouseEvent('dblclick', { bubbles: true }));
  await f.settle();
  assert.deepEqual(f.messages.at(-1), { type: 'branchChangesFile', id: 'selection', index: 4 });
  f.list.scrollTop = 40;
  f.list.dispatchEvent(new f.window.Event('scroll'));
  await f.settle();
  f.send({ type: 'comparisonAction', action: 'expansion', expanded: false });
  await f.settle();
  f.send({
    ...selection,
    id: 'selection-refresh',
    previousId: 'selection',
    files: selection.files.map((file) => ({ ...file, index: file.index + 10 })),
  });
  await f.settle();
  assert.equal(f.saved().chosen, 14);
  assert.equal(f.list.scrollTop, 40);
  assert.equal(f.list.querySelector<HTMLDetailsElement>('.file-folder')!.open, false);
  assert.equal(summary.querySelector('summary')!.getAttribute('aria-label'), '2 selected commits');
  f.send({ ...selection, id: 'single', commits: selection.commits.slice(0, 1), files: [] });
  await f.settle();
  assert.equal(summary.querySelector('summary')!.getAttribute('aria-label'), '1 selected commit');
  assert.equal(f.list.textContent, 'No changes in selected commits.');
  f.send({ type: 'branchChanges' });
  await f.settle();
  assert.equal(f.drawer.querySelector('.selected-commit-summary'), null);
  assert.match(f.list.textContent!, /Open Git Log/);
  assert.equal(f.saved().chosen, undefined);
});
