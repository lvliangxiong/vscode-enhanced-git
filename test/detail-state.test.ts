import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createReactDom } from './helpers/react-dom';
import { createLogStore } from '../src/webview/state/log';
import { createFilesController } from '../src/webview/log/files';
import { createDetailsController } from '../src/webview/log/details';
import {
  FilesContent,
  FileCount,
  MessageContent,
  PreviewContent,
} from '../src/webview/react/details-panel';
import type { LogContext } from '../src/webview/log/context';

function fixture() {
  let saved: Record<string, unknown> = {};
  const messages: { type: string; [key: string]: unknown }[] = [];
  const store = createLogStore();
  store.setState({
    commits: [{ hash: 'a', parents: [], author: 'Me', email: 'me@example.com', subject: 'First' }],
    selected: new Set(['a']),
  });
  const ctx = {
    store,
    actions: {},
    env: {
      api: { getState: () => saved, setState: (value: Record<string, unknown>) => (saved = value) },
      send: (type: string, data: object = {}) => messages.push({ type, ...data }),
      setStatus() {},
      themedFileIcons: {
        set(node: HTMLElement, path: string) {
          node.dataset.path = path;
        },
      },
    },
  } as unknown as LogContext;
  ctx.actions.files = createFilesController(ctx);
  ctx.actions.details = createDetailsController(ctx);
  return { ctx, messages, saved: () => saved };
}
const files = [
  { index: 0, path: 'src/a.ts', status: 'M' },
  { index: 1, path: 'test/b.ts', status: 'A' },
];

test('merge parents expand without a Git reload, retain distinct endpoints and reject hidden previews', async () => {
  const dom = createReactDom();
  const { ctx, messages, saved } = fixture();
  const root = createRoot(dom.document.getElementById('root')!);
  const controller = ctx.actions.files;
  const parentFile = {
    index: 1,
    path: 'src/a.ts',
    status: 'M',
    before: { hash: 'second', path: 'src/a.ts' },
    after: { hash: 'a', path: 'src/a.ts' },
  };
  try {
    flushSync(() => root.render(createElement(FilesContent, { ctx })));
    flushSync(() =>
      controller.receive({
        type: 'details',
        key: 'a',
        files: [],
        items: [],
        parents: [
          { hash: 'first', files: [{ ...parentFile, index: 0 }] },
          { hash: 'second', files: [parentFile] },
        ],
      }),
    );
    assert.match(dom.document.body.textContent, /No merge conflicts/);
    assert.equal(dom.document.querySelector('.file'), null);
    flushSync(() => dom.document.querySelector<HTMLButtonElement>('.merge-parent-link').click());
    assert.equal(messages.length, 0, 'parent diffs are already part of the selection snapshot');
    assert.equal(saved().showParentChanges, true);
    assert.equal(dom.document.querySelectorAll('.merge-parent-group').length, 2);
    ctx.store.setState({ showPreview: true });
    flushSync(() => controller.selectFile(parentFile));
    const previewKey = String(messages.at(-1).key);
    controller.openFile(parentFile);
    assert.equal(messages.at(-1).index, 1);
    assert.equal(messages.at(-1).open, true);
    flushSync(() => controller.expandFileFolders(false));
    assert.ok(
      [...dom.document.querySelectorAll<HTMLDetailsElement>('.file-folder')].every(
        (folder) => !folder.open,
      ),
    );
    assert.ok(
      [...dom.document.querySelectorAll<HTMLDetailsElement>('.merge-parent-group')].every(
        (group) => !group.open,
      ),
      'Collapse All also closes each parent group',
    );
    const empty = dom.document.querySelector('.merge-empty');
    assert.ok(empty.classList.contains('merge-empty-row'));
    assert.ok(empty.querySelector('.folder-chevron[aria-hidden="true"]'));
    assert.equal(
      empty.nextElementSibling.classList.contains('merge-parent-group'),
      true,
      'the empty node sits directly above the parent groups',
    );
    flushSync(() => controller.toggleParentChanges());
    controller.receive({ type: 'preview', key: previewKey, text: 'late hidden parent' });
    assert.equal(controller.store.getState().previewText, undefined);
    const count = messages.length;
    controller.openFile(parentFile);
    assert.equal(messages.length, count, 'hidden parent rows cannot open files');
  } finally {
    flushSync(() => root.unmount());
    await dom.dispose();
  }
});

test('merge Collapse All leaves only the combined root and parent roots; Expand All restores files without Git reads', async () => {
  const dom = createReactDom();
  const { ctx, messages } = fixture();
  const controller = ctx.actions.files;
  const root = createRoot(dom.document.getElementById('root')!);
  try {
    flushSync(() =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement('div', { id: 'count' }, createElement(FileCount, { ctx })),
          createElement(FilesContent, { ctx }),
        ),
      ),
    );
    flushSync(() =>
      controller.receive({
        type: 'details',
        key: 'a',
        files,
        items: [],
        parents: [
          {
            hash: 'first',
            files: [
              {
                ...files[0],
                index: 2,
                before: { hash: 'first', path: files[0].path },
                after: { hash: 'a', path: files[0].path },
              },
            ],
          },
          {
            hash: 'second',
            files: [
              {
                ...files[1],
                index: 3,
                before: { hash: 'second', path: files[1].path },
                after: { hash: 'a', path: files[1].path },
              },
            ],
          },
        ],
      }),
    );
    flushSync(() => controller.toggleParentChanges());
    const groups = [...dom.document.querySelectorAll<HTMLDetailsElement>('.merge-file-group')];
    assert.equal(groups.length, 3);
    assert.deepEqual(controller.expansionState(), { enabled: true, expanded: true });
    assert.match(groups[0].querySelector('summary').textContent, /2 files/);
    assert.match(groups[1].querySelector('summary').textContent, /Changes to first/);
    assert.equal(
      dom.document.getElementById('count').textContent,
      '2 files',
      'parent comparisons do not inflate the combined file count',
    );
    flushSync(() => controller.expandFileFolders(false));
    assert.deepEqual(controller.expansionState(), { enabled: true, expanded: false });
    assert.ok(groups.every((group) => !group.open));
    assert.ok(
      [...dom.document.querySelectorAll<HTMLDetailsElement>('.file-folder')].every(
        (folder) => !folder.open,
      ),
    );
    flushSync(() => controller.expandFileFolders(true));
    assert.deepEqual(controller.expansionState(), { enabled: true, expanded: true });
    assert.ok(groups.every((group) => group.open));
    assert.ok(
      [...dom.document.querySelectorAll<HTMLDetailsElement>('.file-folder')].every(
        (folder) => folder.open,
      ),
    );
    assert.equal(messages.length, 0);
    flushSync(() => {
      groups[1].open = false;
      groups[1].dispatchEvent(new dom.window.Event('toggle', { bubbles: false }));
    });
    assert.equal(groups[1].open, false);
    assert.equal(groups[0].open, true, 'manually closing a parent leaves the combined root open');
    assert.equal(groups[2].open, true, 'parent groups have independent state');
    flushSync(() => controller.toggleDirectory());
    assert.equal(
      dom.document.querySelectorAll<HTMLDetailsElement>('.merge-file-group')[1].open,
      false,
      'changing directory view preserves a manually collapsed group',
    );
  } finally {
    flushSync(() => root.unmount());
    await dom.dispose();
  }
});

test('file expansion follows visible roots, ignoring hidden descendants and stale selections', () => {
  const { ctx, messages } = fixture();
  const controller = ctx.actions.files;
  assert.equal(controller.expansionState().enabled, false);
  controller.receive({
    type: 'details',
    key: 'a',
    files: [
      { index: 0, path: 'src/a/one.ts', status: 'M' },
      { index: 1, path: 'src/b/two.ts', status: 'M' },
    ],
    items: [],
  });
  assert.deepEqual(controller.expansionState(), { enabled: true, expanded: true });
  controller.setFolder('\0merge/combined', false);
  assert.equal(
    controller.expansionState().expanded,
    false,
    'hidden children are not expanded roots',
  );
  controller.expandFileFolders(true);
  assert.equal(controller.expansionState().expanded, true);
  controller.toggleDirectory();
  assert.equal(controller.expansionState().enabled, true, 'flat files retain the collapsible root');
  controller.toggleDirectory();
  assert.equal(controller.expansionState().enabled, true);
  controller.resetDetails();
  assert.equal(controller.expansionState().enabled, false);
  assert.equal(messages.length, 0, 'expansion never rereads Git');
});

test('sidebar action snapshots only the loaded selection in log order, including empty changes', () => {
  const { ctx, messages } = fixture();
  const controller = ctx.actions.files;
  ctx.store.setState({
    commits: ['newest', 'skipped', 'oldest'].map((hash) => ({ hash, parents: [] })),
    selected: new Set(['oldest', 'newest']),
  });
  assert.equal(controller.canShowInSidebar(), false);
  controller.showInSidebar();
  assert.equal(messages.length, 0, 'loading details cannot export a stale list');
  controller.receive({ type: 'details', key: 'oldest,newest', files: [], items: [] });
  assert.equal(
    controller.canShowInSidebar(),
    true,
    'an empty change list is still a valid selection',
  );
  controller.showInSidebar();
  assert.deepEqual(messages.at(-1), {
    type: 'selectionChanges',
    hashes: ['newest', 'oldest'],
  });
  ctx.store.setState({ selected: new Set(['skipped']) });
  assert.equal(controller.canShowInSidebar(), false);
  controller.showInSidebar();
  assert.equal(messages.length, 1, 'a changed selection cannot export the previous list');
  controller.resetDetails();
  controller.receive({ type: 'details', key: 'oldest,newest', files, items: [] });
  assert.equal(controller.canShowInSidebar(), false, 'late details are ignored');
  controller.receive({ type: 'details', key: 'skipped', files, items: [] });
  assert.equal(controller.canShowInSidebar(), true);
  controller.dispose();
  controller.showInSidebar();
  assert.equal(messages.length, 1);
});

test('detail messages reject stale selections and previews while keeping stats and selection coherent', () => {
  const { ctx, messages } = fixture();
  const controller = ctx.actions.files;
  controller.resetDetails();
  controller.receive({ type: 'details', key: 'old', files, items: [] });
  assert.equal(controller.store.getState().files.length, 0);
  controller.receive({
    type: 'details',
    key: 'a',
    files,
    items: [{ hash: 'a', message: 'First' }],
  });
  assert.equal(controller.store.getState().items[0].message, 'First');
  controller.receive({
    type: 'detailStats',
    key: 'a',
    items: [{ hash: 'a', stats: { files: 2, insertions: 5, deletions: 1 } }],
  });
  assert.equal(controller.store.getState().items[0].stats?.insertions, 5);
  ctx.store.setState({ showPreview: true });
  controller.selectFile(files[0]);
  assert.deepEqual(messages.at(-1), {
    type: 'selectionFile',
    hashes: ['a'],
    index: 0,
    key: 'a:0:1',
    open: false,
  });
  controller.selectFile(files[1]);
  controller.receive({ type: 'preview', key: 'a:0:1', text: 'stale' });
  assert.equal(controller.store.getState().previewLoading, true);
  controller.receive({ type: 'preview', key: 'a:1:2', text: '+new' });
  assert.equal(controller.store.getState().previewText, '+new');
  controller.openFile(files[1]);
  assert.equal(messages.at(-1)?.open, true);
  ctx.store.setState({ selected: new Set() });
  controller.resetDetails();
  assert.equal(controller.store.getState().items.length, 0);
  assert.equal(controller.store.getState().files.length, 0);
  assert.equal(controller.store.getState().selectedFile, undefined);
  assert.equal(controller.store.getState().previewText, undefined);
  assert.equal(controller.store.getState().previewLoading, false);
  controller.receive({ type: 'preview', key: 'a:1:2', text: 'late after reset' });
  assert.equal(controller.store.getState().previewText, undefined);
  assert.equal(controller.store.getState().emptyMessage, 'Select commits to explore changes');
});

test('preview request generations, reset and disposal prevent late data from replacing current selection', () => {
  const { ctx, messages } = fixture();
  const controller = ctx.actions.files;
  const details = { type: 'details' as const, key: 'a', files, items: [] };
  ctx.store.setState({ showPreview: true });
  controller.receive(details);
  controller.selectFile(files[0]);
  const oldKey = String(messages.at(-1)?.key);
  controller.resetDetails();
  controller.toggleDirectory();
  assert.equal(controller.store.getState().emptyMessage, 'Loading changes…');
  controller.setFolder('removed', false);
  assert.equal(controller.store.getState().opened.size, 0);
  controller.openFile(files[0]);
  assert.equal(messages.length, 1, 'reset file rows cannot dispatch a native diff');
  controller.receive(details);
  controller.selectFile(files[0]);
  const currentKey = String(messages.at(-1)?.key);
  assert.notEqual(currentKey, oldKey);
  controller.receive({ type: 'preview', key: oldKey, text: 'old' });
  assert.equal(controller.store.getState().previewLoading, true);
  controller.openFile(files[0]);
  controller.receive({ type: 'preview', key: currentKey, text: 'current' });
  assert.equal(
    controller.store.getState().previewText,
    'current',
    'opening native diff leaves pending preview valid',
  );
  controller.dispose();
  const state = controller.store.getState();
  const count = messages.length;
  controller.receive({ type: 'preview', key: currentKey, text: 'after disposal' });
  controller.receive(details);
  controller.openFile(files[0]);
  controller.resetDetails();
  assert.equal(controller.store.getState(), state);
  assert.equal(messages.length, count);
});

test('detail components react to model updates without a render adapter and preserve stable file nodes', async () => {
  const dom = createReactDom();
  const { ctx, saved } = fixture();
  const root = createRoot(dom.document.getElementById('root')!);
  const controller = ctx.actions.files;
  try {
    flushSync(() =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(FilesContent, { ctx }),
          createElement(MessageContent, { ctx }),
          createElement(PreviewContent, { ctx }),
        ),
      ),
    );
    flushSync(() =>
      controller.receive({
        type: 'details',
        key: 'a',
        files,
        items: [{ hash: 'a', message: 'First' }],
      }),
    );
    const file = dom.document.querySelector<HTMLButtonElement>('[data-index="0"]')!;
    assert.ok(file);
    assert.match(dom.document.querySelector('.commit-title')!.textContent!, /First/);
    flushSync(() => controller.selectFile(files[0]));
    assert.equal(dom.document.querySelector('[data-index="0"]'), file);
    assert.equal(file.classList.contains('selected'), true);
    let notifications = 0;
    const unsubscribe = controller.store.subscribe(() => notifications++);
    flushSync(() => controller.expandFileFolders(false));
    assert.equal(notifications, 1);
    assert.ok([...dom.document.querySelectorAll('details')].every((folder) => !folder.open));
    flushSync(() => controller.toggleDirectory());
    assert.equal(saved().directoryView, false);
    assert.equal(dom.document.querySelectorAll('details').length, 1);
    assert.equal(dom.document.querySelector<HTMLDetailsElement>('.merge-file-group').open, false);
    unsubscribe();
  } finally {
    flushSync(() => root.unmount());
    await dom.dispose();
  }
});

test('ordinary commit changes share one file-count root in tree and flat views', async () => {
  const dom = createReactDom();
  const { ctx, messages } = fixture();
  const controller = ctx.actions.files;
  const root = createRoot(dom.document.getElementById('root')!);
  try {
    flushSync(() => root.render(createElement(FilesContent, { ctx })));
    const changes = [...files, { index: 2, path: 'README.md', status: 'M' }];
    flushSync(() => controller.receive({ type: 'details', key: 'a', files: changes, items: [] }));
    const group = dom.document.querySelector<HTMLDetailsElement>('.merge-file-group');
    assert.equal(group.querySelector('summary').textContent, '3 files');
    assert.ok(group.querySelector('.file-group-icon'));
    assert.equal(group.querySelectorAll('.file').length, 3, 'loose files share the same root');
    assert.equal(group.open, true);
    flushSync(() => controller.expandFileFolders(false));
    assert.equal(group.open, false);
    flushSync(() => controller.toggleDirectory());
    assert.equal(dom.document.querySelectorAll('details').length, 1);
    assert.equal(group.open, false);
    flushSync(() => controller.expandFileFolders(true));
    assert.equal(group.open, true);
    flushSync(() =>
      controller.receive({ type: 'details', key: 'a', files: [changes[2]], items: [] }),
    );
    assert.equal(group.querySelector('summary').textContent, '1 file');
    flushSync(() => controller.receive({ type: 'details', key: 'a', files: [], items: [] }));
    assert.equal(dom.document.querySelector('.merge-file-group'), null);
    assert.equal(messages.length, 0);
  } finally {
    flushSync(() => root.unmount());
    await dom.dispose();
  }
});

test('file history requires a selected visible file and snapshots the current loaded selection', () => {
  const { ctx, messages } = fixture();
  const controller = ctx.actions.files;
  assert.equal(controller.canShowHistory(), false);
  controller.showHistory();
  controller.receive({ type: 'details', key: 'a', files, items: [] });
  assert.equal(controller.canShowHistory(), false);
  controller.selectFile(files[1]);
  assert.equal(controller.canShowHistory(), true);
  controller.showHistory();
  assert.deepEqual(messages.at(-1), { type: 'selectionFileHistory', hashes: ['a'], index: 1 });
  ctx.store.setState({ selected: new Set(['other']) });
  controller.showHistory();
  assert.equal(messages.length, 1, 'stale loaded file cannot open history for another selection');
  ctx.store.setState({ selected: new Set(['a']) });
  controller.toggleDirectory();
  assert.equal(controller.canShowHistory(), false);
  controller.dispose();
});

test('merge parent Show File Diffs compares parent to selected merge without toggling the group or using stale selections', async () => {
  const dom = createReactDom();
  const { ctx, messages } = fixture();
  const root = createRoot(dom.document.getElementById('root')!);
  const controller = ctx.actions.files;
  try {
    flushSync(() => {
      root.render(createElement(FilesContent, { ctx }));
      controller.receive({
        type: 'details',
        key: 'a',
        files: [],
        items: [],
        parents: [
          ...['first-parent', 'second-parent'].map((hash) => ({
            hash,
            files: files.map((file) => ({
              ...file,
              before: { hash, path: file.path },
              after: { hash: 'a', path: file.path },
            })),
          })),
        ],
      });
      controller.toggleParentChanges();
      controller.expandFileFolders(false);
    });
    const groups = [...dom.document.querySelectorAll<HTMLDetailsElement>('.merge-parent-group')];
    for (const [index, group] of groups.entries()) {
      const button = group.querySelector<HTMLButtonElement>('.merge-parent-diff')!;
      assert.equal(button.title, 'Show File Diffs');
      assert.ok(button.querySelector('.file-diff-icon'), 'reuse the toolbar comparison icon');
      assert.equal(group.open, false);
      button.click();
      assert.equal(group.open, false, 'comparison must not expand a collapsed group');
      assert.deepEqual(messages.at(-1), {
        type: 'commitFiles',
        hashes: [index ? 'second-parent' : 'first-parent', 'a'],
      });
    }
    flushSync(() => controller.expandFileFolders(true));
    groups[0].querySelector<HTMLButtonElement>('.merge-parent-diff')!.click();
    assert.equal(groups[0].open, true, 'comparison must not collapse an expanded group');
    const count = messages.length;
    controller.showParentDiff('unrelated');
    ctx.store.setState({ selected: new Set(['other']) });
    controller.showParentDiff('first-parent');
    assert.equal(messages.length, count, 'late clicks must not compare with a new selection');
    ctx.store.setState({ selected: new Set(['a']) });
    flushSync(() => controller.toggleParentChanges());
    controller.showParentDiff('first-parent');
    assert.equal(messages.length, count, 'hidden parent actions are ignored');
    assert.equal(dom.document.querySelector('.merge-parent-diff'), null);
  } finally {
    flushSync(() => root.unmount());
    await dom.dispose();
  }
});
