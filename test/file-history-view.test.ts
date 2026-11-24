import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushSync } from 'react-dom';
import { createReactDom } from './helpers/react-dom';
import { mountComponent } from './helpers/react-view';
import { FileHistory } from '../src/webview/react/file-history';

test('history virtualizes rows, compares selected endpoints and rejects stale native acknowledgments', async () => {
  const dom = createReactDom();
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  const view = mountComponent(dom.document.getElementById('root'), FileHistory);
  const sent: any[] = [];
  let saved: any = {};
  const api = {
    getState: () => saved,
    setState: (value: any) => (saved = value),
    postMessage: (message: any) => sent.push(message),
  };
  const dispatch = (data: any) =>
    flushSync(() => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })));
  const last = (type: string) => sent.filter((message) => message.type === type).at(-1);
  const button = (label: string) =>
    dom.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  try {
    view.render({ api });
    assert.deepEqual(sent[0], { type: 'ready' });
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      hash: String(i),
      subject: `Change ${i}`,
      path: 'file.ts',
      author: 'Author',
      email: 'author@example.com',
      parents: [],
      date: '2026-10-22T00:00:00Z',
      message: 'Detailed message',
    }));
    dispatch({
      type: 'historyPage',
      entries,
      hasMore: true,
      path: 'file.ts',
      revision: 'a'.repeat(40),
      generation: 0,
      capabilities: { affected: true, locate: true },
    });
    assert.ok(dom.document.querySelectorAll('.commit').length < 40);
    assert.equal(dom.document.querySelectorAll('.commit .subject-text')[0].textContent, 'Change 0');
    assert.equal(
      dom.document.querySelectorAll('.commit .log-column').length,
      dom.document.querySelectorAll('.commit').length * 4,
    );
    assert.equal(
      dom.document.querySelector('.history-metadata'),
      null,
      'history uses the shared single-row table',
    );
    const firstRequest = last('historyDiff');
    assert.deepEqual(firstRequest.hashes, ['0']);
    flushSync(() => dom.document.querySelectorAll<HTMLButtonElement>('.commit')[1].click());
    const secondRequest = last('historyDiff');
    assert.deepEqual(secondRequest.hashes, ['1']);
    dispatch({ type: 'historyDiffReady', key: firstRequest.key, generation: 0 });
    assert.match(
      dom.document.querySelector('.history-status').textContent,
      /Opening/,
      'old diff acknowledgement cannot overwrite the new selection status',
    );
    dispatch({ type: 'historyDiffReady', key: secondRequest.key, generation: 0 });
    assert.match(dom.document.querySelector('.history-status').textContent, /open in the editor/);
    assert.equal(button('Next Difference'), null);
    assert.equal(button('Load All History'), null);
    assert.equal(dom.document.querySelectorAll('[role="toolbar"]').length, 0);
    flushSync(() =>
      dom.document
        .querySelectorAll('.commit')[0]
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, metaKey: true })),
    );
    assert.deepEqual(last('historyDiff').hashes, ['1', '0']);
    assert.equal(last('historyToolbarState').state.selected, 2);
    dispatch({ type: 'historyAction', action: 'affected', generation: 0 });
    assert.deepEqual(last('historyAffected').hashes, ['1', '0']);
    dispatch({
      type: 'historyViewOptions',
      view: { author: false, date: true, hash: false, details: true },
    });
    assert.equal(saved.historyView.details, true);
    assert.equal(
      dom.document.querySelectorAll('.history-commit-details .commit-details').length,
      2,
    );
    assert.deepEqual(last('historyDetails').hashes, ['1', '0']);
    dispatch({
      type: 'historyDetails',
      generation: 0,
      items: [{ hash: '1', stats: { files: 3, insertions: 5, deletions: 2 } }],
    });
    assert.match(
      dom.document.querySelector('.history-commit-details .commit-stats').textContent,
      /3 files changed, 5 insertions/,
    );
    flushSync(() =>
      dom.document.querySelector<HTMLButtonElement>('.history-commit-details .commit-copy').click(),
    );
    assert.equal(last('historyCopy').hashes.length, 1);
    flushSync(() =>
      dom.document
        .querySelector<HTMLAnchorElement>('.history-commit-details .commit-author')
        .click(),
    );
    assert.equal(last('historyOpenLink').url, 'mailto:author@example.com');

    assert.equal(dom.document.querySelectorAll('.log-column.hash').length, 0);
    dispatch({ type: 'historyAction', action: 'refresh', generation: 0 });
    assert.equal(last('historyRefresh').type, 'historyRefresh');
    dispatch({
      type: 'historyPage',
      entries: entries.slice(0, 3),
      reset: true,
      hasMore: false,
      path: 'file.ts',
      revision: 'a'.repeat(40),
      generation: 1,
    });
    assert.equal(
      dom.document.querySelectorAll('.commit').length,
      3,
      'refresh replaces old history',
    );
    assert.match(dom.document.querySelector('footer').textContent, /3 commits/);
    dispatch({ type: 'historyStart', path: 'other.ts', revision: 'b'.repeat(40), generation: 2 });
    assert.equal(dom.document.querySelectorAll('.commit').length, 0);
    assert.equal(button('Next Difference'), null);
    dispatch({
      type: 'historyPage',
      entries,
      hasMore: false,
      path: 'old.ts',
      revision: 'a',
      generation: 1,
    });
    assert.equal(dom.document.querySelectorAll('.commit').length, 0, 'old file page is ignored');
    dispatch({ type: 'historyEmpty' });
    assert.match(
      dom.document.querySelector('.history-placeholder').textContent,
      /History Up To Here/,
    );
    assert.equal(
      dom.document.querySelector('footer'),
      null,
      'no zero-commit footer in the empty welcome',
    );
    flushSync(() => dom.document.querySelector<HTMLButtonElement>('.open-git-log').click());
    assert.equal(last('openGitLog').type, 'openGitLog');
    assert.equal(button('Refresh'), null);
    assert.equal(last('historyToolbarState').state.selected, 0);
    assert.equal(
      dom.document.querySelectorAll('.monaco-editor').length,
      0,
      'the history Webview never mounts a second diff implementation',
    );
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('batched history scrolls retain the sidebar and render the latest viewport', async () => {
  const dom = createReactDom();
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  const view = mountComponent(dom.document.getElementById('root'), FileHistory);
  const api = {
    getState: () => ({}),
    setState<T>(state: T) {
      return state;
    },
    postMessage() {},
  };
  try {
    view.render({ api });
    flushSync(() =>
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: {
            type: 'historyPage',
            path: 'file.ts',
            revision: 'a',
            generation: 0,
            hasMore: false,
            entries: Array.from({ length: 1000 }, (_, i) => ({
              hash: String(i),
              subject: `Change ${i}`,
              path: 'file.ts',
              author: 'Author',
              email: 'author@example.com',
              date: '2026-10-22T00:00:00Z',
              message: 'Message',
              parents: [],
            })),
          },
        }),
      ),
    );
    const list = dom.document.querySelector<HTMLDivElement>('.history-commits');
    flushSync(() => {
      for (const top of [240, 2400, 4800]) {
        list.scrollTop = top;
        list.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }));
      }
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(
      dom.document.querySelector('.file-history'),
      'scrolling must not unmount the sidebar',
    );
    assert.ok(
      dom.document.getElementById('history-200'),
      'latest viewport: ' +
        list.scrollTop +
        ' ' +
        Array.from(dom.document.querySelectorAll('.commit'))
          .map((row) => row.id)
          .join(','),
    );
    assert.match(dom.document.querySelector('footer').textContent, /1000 commits/);
    assert.ok(dom.document.querySelectorAll('.commit').length < 40);
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('file history shares Canvas graph tiles, virtualizes them, follows arrows and repaints on theme changes', async () => {
  const dom = createReactDom();
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(dom.window, 'Path2D', {
    value: class {
      constructor(public path: string) {}
    },
  });
  dom.window.HTMLCanvasElement.prototype.getContext = (() => ({
    setTransform() {},
    clearRect() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
  })) as any;
  const view = mountComponent(dom.document.getElementById('root'), FileHistory);
  const sent: any[] = [];
  const api = {
    getState: () => ({}),
    setState: <T>(value: T) => value,
    postMessage: (message: any) => sent.push(message),
  };
  try {
    view.render({ api });
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      hash: String(index),
      parents: index ? (index < 999 ? [String(index + 1)] : []) : ['hidden'],
      subject: `Change ${index}`,
      path: 'file.ts',
      author: 'Author',
      email: 'author@example.com',
      date: '2026-10-22T00:00:00Z',
      message: 'Message',
    }));
    const graph = entries.map((entry, index) => ({
      hash: entry.hash,
      graphParents: index ? entry.parents : ['999'],
      graphUnloadedParents: [],
    }));
    flushSync(() =>
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: {
            type: 'historyPage',
            path: 'file.ts',
            generation: 0,
            entries,
            graph,
            hasMore: false,
          },
        }),
      ),
    );
    const canvasCount = dom.document.querySelectorAll('canvas').length;
    assert.ok(canvasCount > 0 && canvasCount < 40, 'only visible rows allocate Canvas buffers');
    const before = dom.document.querySelector('.graph-node').getAttribute('fill');
    dom.document.body.classList.add('vscode-light');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.notEqual(dom.document.querySelector('.graph-node').getAttribute('fill'), before);
    const arrow = dom.document.querySelector('.graph-jump[data-target="999"]');
    assert.ok(arrow, 'the same long-edge arrow renderer is reused');
    flushSync(() => arrow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(sent.filter((message) => message.type === 'historyDiff').at(-1).hashes, [
      '999',
    ]);
    assert.ok(dom.document.getElementById('history-999'), 'arrow reveals its target row');
    assert.ok(dom.document.querySelectorAll('canvas').length < 40);
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('resizing the history viewport keeps the selected commit above the details pane', async () => {
  const dom = createReactDom();
  const callbacks: Array<() => void> = [];
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  });
  const view = mountComponent(dom.document.getElementById('root'), FileHistory);
  try {
    view.render({
      api: {
        getState: () => ({ historyView: { details: true } }),
        setState<T>(state: T) {
          return state;
        },
        postMessage() {},
      },
    });
    flushSync(() =>
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: {
            type: 'historyPage',
            generation: 0,
            path: 'file.ts',
            hasMore: false,
            entries: Array.from({ length: 25 }, (_, i) => ({
              hash: String(i),
              subject: `Change ${i}`,
              author: 'Author',
              email: 'a@example.com',
              date: '2026-10-22',
              path: 'file.ts',
              parents: [],
              message: i === 20 ? 'Long message\n'.repeat(100) : 'Short message',
            })),
          },
        }),
      ),
    );
    const list = dom.document.querySelector<HTMLDivElement>('.history-commits');
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 600 });
    flushSync(() => dom.document.getElementById('history-20').click());
    assert.match(dom.document.querySelector('.history-commit-details').textContent, /Long message/);
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
    flushSync(() => callbacks[0]());
    assert.equal(list.scrollTop, 204);
    assert.ok(dom.document.getElementById('history-20'));
    assert.equal(dom.document.getElementById('history-20').getAttribute('aria-selected'), 'true');
  } finally {
    view.dispose();
    await dom.dispose();
  }
});
