import { mountComponent } from './helpers/react-view';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReactDom } from './helpers/react-dom';
import { FileList, type FileListProps } from '../src/webview/react/file-list';

function setup() {
  const dom = createReactDom(),
    root = dom.document.getElementById('root');
  const view = mountComponent(root, FileList);
  const opened: number[] = [],
    selected: number[] = [];
  const props: FileListProps = {
    files: [
      { index: 0, path: 'src/api/handler.ts', status: 'M' },
      { index: 1, path: 'src/api/model.ts', status: 'A' },
      { index: 2, path: 'README.md', status: 'M' },
    ],
    directoryView: true,
    hasSelection: true,
    folderOpen: new Map(),
    setIcon(node, path) {
      node.className = 'theme-file-icon';
      node.dataset.iconKey = path;
    },
    onSelect(file) {
      selected.push(file.index);
      props.selectedFile = file.index;
      view.render({ ...props });
    },
    onOpen: (file) => opened.push(file.index),
    onFolderChange(path, open) {
      props.folderOpen = new Map(props.folderOpen).set(path, open);
    },
  };
  return {
    dom,
    root,
    props,
    view,
    opened,
    selected,
    async dispose() {
      view.dispose();
      await dom.dispose();
    },
  };
}

test('React file list preserves compact directories, selection and native diff gestures', async () => {
  const fixture = setup(),
    { dom, root, props, view, opened, selected } = fixture;
  try {
    view.render(props);
    assert.equal(root.querySelector('.folder-name').textContent, 'src/api');
    assert.equal(root.querySelector('.folder-count').textContent, '2 files');
    assert.equal(root.querySelectorAll('.file-folder').length, 1);
    const file = root.querySelector<HTMLButtonElement>('[aria-label="M src/api/handler.ts"]');
    assert.equal(file.title, 'src/api/handler.ts');
    assert.equal(file.querySelector('.theme-file-icon').getAttribute('data-icon-key'), file.title);
    file.click();
    assert.deepEqual(selected, [0]);
    assert.equal(root.querySelectorAll('.file.selected').length, 1);
    assert.equal(root.querySelector('.file.selected'), file);
    file.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    const enter = new dom.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    assert.equal(file.dispatchEvent(enter), false);
    assert.deepEqual(opened, [0, 0]);
    root.querySelector<HTMLButtonElement>('[aria-label="M README.md"]').click();
    assert.deepEqual(selected, [0, 2]);
    assert.equal(root.querySelectorAll('.file.selected').length, 1);
  } finally {
    await fixture.dispose();
  }
});

test('React file list preserves folder expansion, flat paths and loading/empty states', async () => {
  const fixture = setup(),
    { dom, root, props, view } = fixture;
  try {
    props.folderOpen = new Map([['src/api', false]]);
    view.render(props);
    const folder = root.querySelector('details');
    assert.equal(folder.open, false);
    folder.open = true;
    folder.dispatchEvent(new dom.window.Event('toggle'));
    assert.equal(props.folderOpen.get('src/api'), true);
    view.render({ ...props, directoryView: false });
    assert.equal(root.querySelector('details'), null);
    assert.equal(root.querySelector('.file-directory').textContent, 'src/api');
    assert.deepEqual(
      [...root.querySelectorAll('.file-name')].map((node) => node.textContent),
      ['handler.ts', 'model.ts', 'README.md'],
    );
    view.render({ ...props, emptyMessage: 'Loading changes…' });
    assert.equal(root.querySelector('.empty').textContent, 'Loading changes…');
    assert.equal(root.querySelector('.file'), null);
    view.render({ ...props, files: [] });
    assert.equal(root.textContent, 'No changes in selected commits.');
    view.render({ ...props, files: [], hasSelection: false });
    assert.equal(root.textContent, 'Select commit to view changes');
  } finally {
    await fixture.dispose();
  }
});

test('file rows expose status badges and a separate Open File action without opening a diff', async () => {
  const fixture = setup();
  const { root, props, view, selected, opened, dom } = fixture;
  const workingFiles: number[] = [];
  try {
    props.files = ['A', 'M', 'D', 'R100'].map((status, index) => ({
      index,
      status,
      path: `src/file-${index}.ts`,
    }));
    props.onOpenWorkingFile = (file) => workingFiles.push(file.index);
    view.render(props);
    assert.deepEqual(
      [...root.querySelectorAll('.file-status')].map((n) => [
        n.textContent,
        n.getAttribute('title'),
      ]),
      [
        ['A', 'Added'],
        ['M', 'Modified'],
        ['D', 'Deleted'],
        ['R', 'Renamed'],
      ],
    );
    const button = root.querySelector<HTMLButtonElement>('[aria-label="Open File: src/file-2.ts"]');
    assert.equal(button.title, 'Open File');
    assert.equal(button.closest('.file'), null, 'open action is not nested inside the diff button');
    button.click();
    button.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    assert.deepEqual(workingFiles, [2]);
    assert.deepEqual(opened, [], 'Open File must not trigger a diff');
    assert.deepEqual(selected, [], 'Open File must not trigger a preview');
    view.render({ ...props, directoryView: false });
    root.querySelector<HTMLButtonElement>('[aria-label="Open File: src/file-0.ts"]').click();
    assert.deepEqual(workingFiles, [2, 0], 'the flat list has the same action');
  } finally {
    await fixture.dispose();
  }
});
