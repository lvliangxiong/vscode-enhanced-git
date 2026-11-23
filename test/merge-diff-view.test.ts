import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushSync } from 'react-dom';
import { createReactDom } from './helpers/react-dom';
import { mountComponent } from './helpers/react-view';
import { MergeDiff } from '../src/webview/react/merge-diff';
import { mergeLayout, transferLine } from '../src/webview/merge/layout';
import { mergeSashWidth } from '../src/webview/merge/pane-widths';
import { mergeTheme } from '../src/webview/merge/theme';
import type { MergeDiffData } from '../src/shared/merge-diff';
import type { MergeEditors } from '../src/webview/merge/types';

function createMergeDom(html = '<div id="root"></div>') {
  const dom = createReactDom(html);
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
    configurable: true,
  });
  return dom;
}

const data: MergeDiffData = {
  path: '<file>.ts',
  labels: ['Parent 1', 'Merge Result', 'Parent 2'],
  contents: ['old\nkeep\nleft extra\nlast\n', 'new\nkeep\nlast', 'keep\nright extra\nlast\n'],
  patches: [
    '@@ -1 +1 @@\n-old\n+new\n@@ -3 +2,0 @@\n-left extra\n',
    '@@ -0,0 +1 @@\n+new\n@@ -2 +2,0 @@\n-right extra\n',
  ],
};
const tick = () =>
  new Promise<void>((resolve) =>
    setImmediate(() => {
      flushSync(() => {});
      resolve();
    }),
  );

test('merge intervals preserve real source boundaries for replacements, deletion points, empty models and trailing EOLs', () => {
  const layout = mergeLayout(data);
  assert.deepEqual(layout.pairs[0], [
    { before: { start: 0, end: 1 }, after: { start: 0, end: 1 }, kind: 'modified' },
    { before: { start: 2, end: 3 }, after: { start: 2, end: 2 }, kind: 'deleted' },
  ]);
  assert.deepEqual(layout.sides[1], [{ start: 0, end: 1, kind: 'modified' }]);
  assert.equal(layout.changes.length, 2);
  assert.deepEqual(layout.changes[1], [
    { start: 2, end: 3 },
    { start: 2, end: 2 },
    { start: 1, end: 2 },
  ]);
  assert.equal(transferLine(layout.anchors[0], 3, 0), 2);
  assert.equal(transferLine(layout.anchors[0], 2, 1), 2);
  const empty = mergeLayout({
    ...data,
    contents: ['', 'new\n', ''],
    patches: ['@@ -0,0 +1 @@\n+new\n', '@@ -0,0 +1 @@\n+new\n'],
  });
  assert.deepEqual(empty.sides, [[], [{ start: 0, end: 1, kind: 'inserted' }], []]);
  assert.deepEqual(empty.changes, [
    [
      { start: 0, end: 0 },
      { start: 0, end: 1 },
      { start: 0, end: 0 },
    ],
  ]);
  assert.deepEqual(empty.anchors[0].at(-1), [1, 2]);
});

test('merge shell handles native action messages, binary files and disposal', async () => {
  const dom = createMergeDom('<div id="root"></div>');
  const view = mountComponent(dom.document.getElementById('root'), MergeDiff);
  const calls: unknown[] = [];
  const instance: MergeEditors = {
    navigate: (n) => calls.push(n),
    dispose: () => calls.push('dispose'),
  };
  try {
    view.render({
      data,
      send: (message) => calls.push(message),
      mountEditors: async (containers, received) => {
        assert.equal(containers.length, 3);
        assert.equal(received.contents, data.contents);
        return instance;
      },
    });
    await tick();
    assert.equal(dom.document.querySelectorAll('.merge-editor').length, 3);
    assert.equal(dom.document.querySelectorAll('button').length, 0);
    assert.equal(dom.document.querySelector('[aria-label="File path"]'), null);
    for (const action of ['previous', 'next'])
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', { data: { type: 'mergeAction', action } }),
      );
    assert.deepEqual(
      calls.filter((value) => typeof value === 'number'),
      [-1, 1],
    );
    assert.ok(calls.some((value: any) => value.type === 'mergeEditorState' && value.ready));
    view.render({
      data: { ...data, contents: ['\0', '', ''] },
      send() {},
      mountEditors: async () => {
        throw Error('must not mount binary');
      },
    });
    assert.match(dom.document.body.textContent, /Binary content/);
    assert.equal(dom.document.querySelectorAll('.merge-editor').length, 0);
    assert.ok(calls.includes('dispose'));
    assert.deepEqual(calls.at(-1), { type: 'mergeEditorState', ready: false });
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('late editor initialization is disposed after unmount and loading failures retain parent comparisons', async () => {
  const dom = createMergeDom('<div id="root"></div>');
  const view = mountComponent(dom.document.getElementById('root'), MergeDiff);
  let finish: (editors: MergeEditors) => void;
  let disposed = 0;
  view.render({
    data,
    send() {},
    mountEditors: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  view.dispose();
  finish({
    navigate() {},
    dispose() {
      disposed++;
    },
  });
  await tick();
  assert.equal(disposed, 1);
  const second = mountComponent(dom.document.getElementById('root'), MergeDiff);
  second.render({
    data,
    send() {},
    mountEditors: async () => {
      throw Error('worker unavailable');
    },
  });
  await tick();
  assert.match(dom.document.body.textContent, /Unable to load editors/);
  assert.equal(dom.document.querySelectorAll('button').length, 0);
  second.dispose();
  await dom.dispose();
});

test('Monaco theme follows webview light, dark and high contrast colors', async () => {
  const dom = createMergeDom('<div></div>');
  try {
    const style = dom.document.body.style;
    style.setProperty('--vscode-editor-background', '#102030');
    style.setProperty('--vscode-editor-foreground', 'rgb(210, 220, 230)');
    assert.deepEqual(mergeTheme(style, 'vscode-light').colors, {
      'editor.background': '#102030',
      'editor.foreground': '#d2dce6',
      'editorGutter.addedBackground': '#73c991',
      'editorGutter.deletedBackground': '#f14c4c',
      'editorGutter.modifiedBackground': '#569cd6',
    });
    assert.equal(mergeTheme(style, 'vscode-light').base, 'vs');
    assert.equal(mergeTheme(style, 'vscode-dark').base, 'vs-dark');
    assert.equal(mergeTheme(style, 'vscode-high-contrast').base, 'hc-black');
    assert.equal(mergeTheme(style, 'vscode-high-contrast-light').base, 'hc-light');
    style.setProperty('--vscode-editor-background', '#fff');
    style.setProperty('--vscode-editor-foreground', '#123');
    style.setProperty('--vscode-editor-selectionBackground', '#abcd');
    assert.deepEqual(mergeTheme(style, 'vscode-light').colors, {
      'editor.background': '#ffffff',
      'editor.foreground': '#112233',
      'editor.selectionBackground': '#aabbccdd',
      'editorGutter.addedBackground': '#73c991',
      'editorGutter.deletedBackground': '#f14c4c',
      'editorGutter.modifiedBackground': '#569cd6',
    });
    style.setProperty('--vscode-editor-background', '#12345');
    assert.equal(mergeTheme(style, 'vscode-light').colors['editor.background'], undefined);
  } finally {
    await dom.dispose();
  }
});

test('merge revision headers show author/time and isolated, literal full commit hovers without remounting editors', async () => {
  const dom = createMergeDom(),
    view = mountComponent(dom.document.getElementById('root'), MergeDiff);
  const commits = ['Parent One', 'Merge Author', 'Parent Two'].map((author, i) => ({
    hash: String(i + 1).repeat(40),
    author,
    email: `author${i}@example.com`,
    authorDate: '2026-10-20T10:00:00+08:00',
    date: '2026-10-21T11:00:00+08:00',
    committer: 'Committer',
    committerEmail: 'commit@example.com',
    message: `Subject ${i}\n\nDetailed body ${i}\n<script>literal</script>\nCo-authored-by: Other <other@example.com>`,
  })) as MergeDiffData['commits'];
  let mounts = 0;
  const actions: any[] = [];
  const wait = async () => {
    await new Promise((resolve) => setTimeout(resolve, 230));
    await tick();
  };
  try {
    view.render({
      data: { ...data, commits },
      send(message) {
        actions.push(message);
      },
      mountEditors: async () => {
        mounts++;
        return { navigate() {}, dispose() {} };
      },
    });
    await tick();
    const headers = [...dom.document.querySelectorAll<HTMLElement>('.merge-revision-header')];
    assert.equal(headers.length, 3);
    for (const [i, header] of headers.entries()) {
      assert.match(header.textContent, new RegExp(commits[i].author));
      assert.equal(header.querySelector('time').dateTime, commits[i].authorDate);
    }
    headers[0].dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    await wait();
    let hover = dom.document.querySelector('[role="tooltip"]');
    assert.match(hover.textContent, /Parent One/);
    assert.match(hover.textContent, /Detailed body 0/);
    assert.equal(hover.querySelector('.merge-commit-hash').getAttribute('title'), commits[0].hash);
    assert.equal(
      hover.querySelector('.merge-commit-person a').getAttribute('title'),
      commits[0].email,
    );
    assert.equal(
      hover.querySelector('h3'),
      null,
      'native hover message uses normal paragraph text',
    );
    assert.equal(hover.querySelector('.merge-commit-person .merge-commit-date') !== null, true);
    assert.deepEqual(
      actions.filter((item) => item.type === 'mergeCommitAction'),
      [{ type: 'mergeCommitAction', action: 'stats', hash: commits[0].hash }],
    );
    flushSync(() =>
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: {
            type: 'mergeCommitStats',
            hash: commits[0].hash,
            stats: { files: 2, insertions: 3, deletions: 1 },
          },
        }),
      ),
    );
    await tick();
    assert.match(
      hover.querySelector('.merge-commit-stats').textContent,
      /2 files changed, 3 insertions\(\+\), 1 deletion\(-\)/,
    );
    (hover.querySelector('.merge-commit-copy') as HTMLElement).click();
    assert.deepEqual(actions.at(-1), {
      type: 'mergeCommitAction',
      action: 'copy',
      hash: commits[0].hash,
    });
    (hover.querySelector('.merge-commit-person a') as HTMLElement).click();
    assert.deepEqual(actions.at(-1), {
      type: 'mergeCommitAction',
      action: 'email',
      hash: commits[0].hash,
    });
    assert.match(hover.textContent, /Committed by Committer/);
    assert.match(hover.textContent, /<script>literal<\/script>/);
    assert.equal(hover.querySelector('script'), null);
    assert.equal(headers[0].getAttribute('aria-describedby'), hover.id);
    assert.ok(parseFloat((hover as HTMLElement).style.left) >= 8);
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    assert.equal(dom.document.querySelector('[role="tooltip"]'), null);
    headers[2].focus();
    await wait();
    hover = dom.document.querySelector('[role="tooltip"]');
    assert.match(hover.textContent, /Parent Two/);
    assert.match(hover.textContent, /Detailed body 2/);
    headers[2].blur();
    await tick();
    assert.equal(dom.document.querySelector('[role="tooltip"]'), null);
    assert.equal(mounts, 1, 'hovering and focusing metadata must not rebuild Monaco');
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('merge sashes resize live without remounting Monaco, save on release, cancel cleanly and retain proportions on window resize', async () => {
  const dom = createMergeDom(),
    view = mountComponent(dom.document.getElementById('root'), MergeDiff);
  let width = 900 + mergeSashWidth * 2,
    resized: () => void,
    disconnected = false,
    mounts = 0,
    captures = 0;
  const saved: number[][] = [];
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: this.classList.contains('merge-panes') ? width : 0,
      height: 500,
      left: 0,
      top: 0,
      bottom: 500,
      right: width,
      x: 0,
      y: 0,
      toJSON() {},
    };
  };
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: class {
      constructor(callback) {
        resized = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
    configurable: true,
  });
  dom.window.HTMLElement.prototype.setPointerCapture = () => {
    captures++;
  };
  const fire = (node: Element, type: string, x = 0) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    flushSync(() => node.dispatchEvent(event));
  };
  const key = (node: Element, key: string) =>
    flushSync(() =>
      node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, key })),
    );
  const ratios = () =>
    [
      ...dom.document
        .querySelector<HTMLElement>('.merge-panes')
        .style.gridTemplateColumns.matchAll(/([\d.e+-]+)fr/g),
    ].map((match) => Number(match[1]));
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
  try {
    view.render({
      data: { ...data, style: 'jetbrains' },
      send() {},
      onPaneWidthsChange: (widths) => saved.push(widths),
      mountEditors: async () => {
        mounts++;
        return { navigate() {}, dispose() {} };
      },
    });
    await tick();
    const [left, right] = [...dom.document.querySelectorAll('[role="separator"]')];
    assert.equal(left.getAttribute('aria-orientation'), 'vertical');
    fire(left, 'pointerdown', 300);
    fire(left, 'pointermove', 390);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await tick();
    near(ratios()[0] * 900, 390);
    near(ratios()[2] * 900, 300);
    assert.equal(saved.length, 0, 'do not persist every pointer event');
    fire(left, 'pointerup', 390);
    assert.equal(saved.length, 1);
    assert.equal(captures, 1);
    assert.equal(dom.document.querySelector('.merge-panes-resizing'), null);
    fire(left, 'pointerdown', 390);
    fire(left, 'pointermove', 600);
    key(left, 'Escape');
    near(ratios()[0] * 900, 390);
    assert.equal(saved.length, 1);
    fire(left, 'dblclick');
    near(ratios()[0], 1 / 3);
    near(ratios()[1], 1 / 3);
    key(right, 'ArrowLeft');
    near(ratios()[0], 1 / 3);
    near(ratios()[1] * 900, 284);
    const preferred = ratios();
    width = 240 + mergeSashWidth * 2;
    flushSync(() => resized());
    ratios().forEach((value) => near(value, 1 / 3));
    width = 900 + mergeSashWidth * 2;
    flushSync(() => resized());
    ratios().forEach((value, i) => near(value, preferred[i]));
    key(left, 'End');
    near(ratios()[1] * 900, 120);
    fire(left, 'pointerdown', 500);
    fire(left, 'pointermove', 100);
    fire(left, 'pointercancel');
    near(ratios()[1] * 900, 120);
    assert.equal(mounts, 1);
    assert.equal(saved.length, 4);
  } finally {
    view.dispose();
    assert.ok(disconnected);
    await dom.dispose();
  }
});

test('merge style settings update existing editors and separators, including settings received during initialization', async () => {
  const dom = createMergeDom();
  const view = mountComponent(dom.document.getElementById('root'), MergeDiff);
  let mounts = 0,
    disposals = 0;
  let finish: (instance: MergeEditors) => void;
  const styles: string[] = [];
  const instance: MergeEditors = {
    navigate() {},
    dispose() {
      disposals++;
    },
    setStyle(style) {
      styles.push(style);
    },
  };
  const send = () => {};
  const mountEditors = () => {
    mounts++;
    return new Promise<MergeEditors>((resolve) => {
      finish = resolve;
    });
  };
  const change = (style: string) =>
    flushSync(() =>
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', { data: { type: 'mergeDiffStyle', style } }),
      ),
    );
  try {
    view.render({ data, send, mountEditors });
    assert.match(
      dom.document.querySelector<HTMLElement>('.merge-panes').style.gridTemplateColumns,
      / 1px /,
    );
    change('jetbrains');
    finish(instance);
    await tick();
    assert.deepEqual(styles, ['jetbrains']);
    assert.match(
      dom.document.querySelector<HTMLElement>('.merge-panes').style.gridTemplateColumns,
      / 28px /,
    );
    change('native');
    assert.equal(styles.at(-1), 'native');
    assert.match(
      dom.document.querySelector<HTMLElement>('.merge-panes').style.gridTemplateColumns,
      / 1px /,
    );
    assert.equal(mounts, 1);
    assert.equal(disposals, 0);
  } finally {
    view.dispose();
    await dom.dispose();
  }
  assert.equal(disposals, 1);
});
