import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountComparisonHost } from '../src/webview/compare-host';
import { createReactDom } from './helpers/react-dom';

test('React comparison host routes isolated state and clamps/resets the shared split without remounting panes', async () => {
  const dom = createReactDom('<style id="host-style"></style><div id="host-app"></div>');
  const { document, window } = dom;
  const sent = [],
    saved = [],
    panes = [];
  window.HTMLElement.prototype.setPointerCapture = () => {};
  const host = mountComparisonHost({
    document,
    window: window as any,
    documents: ['first', 'second'],
    api: {
      getState: () => ({
        split: 0.4,
        0: { columnOrder: ['date'] },
        1: { columnOrder: ['author'] },
      }),
      setState(value) {
        saved.push(value);
        return value;
      },
      postMessage(message) {
        sent.push(message);
      },
    },
    paneFactory(element, html, options) {
      const pane = {
        element,
        html,
        options,
        messages: [],
        disposed: false,
        receive(message) {
          this.messages.push(message);
        },
        dispose() {
          this.disposed = true;
        },
      };
      panes.push(pane);
      return pane;
    },
  });
  const sash = document.getElementById('sash');
  const tick = () => new Promise(setImmediate);
  try {
    assert.deepEqual(
      panes.map((pane) => pane.html),
      ['first', 'second'],
    );
    assert.deepEqual(
      panes.map((pane) => pane.options.state.columnOrder[0]),
      ['date', 'author'],
    );
    assert.equal(sash.getAttribute('aria-valuenow'), '40');
    host.receive({ type: 'data', pane: 1, commits: ['only second'] });
    assert.equal(panes[1].messages.at(-1).commits[0], 'only second');
    assert.ok(panes[0].messages.every((message) => message.type !== 'data'));
    panes[0].options.send({ type: 'frameState', state: { columnOrder: ['hash'] } });
    assert.equal(saved.at(-1)[0].columnOrder[0], 'hash');
    assert.equal(saved.at(-1)[1].columnOrder[0], 'author');
    panes[1].options.send({ type: 'filterRecent', values: ['topic'] });
    assert.equal(sent.at(-1).pane, 1);
    for (const key of ['ArrowDown', 'ArrowUp', 'Home']) {
      sash.dispatchEvent(
        new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      await tick();
    }
    assert.equal(sash.getAttribute('aria-valuenow'), '50');
    assert.equal(saved.at(-1).split, 0.5);
    sash.dispatchEvent(new window.MouseEvent('pointerdown', { button: 0, bubbles: true }));
    await tick();
    assert.ok(document.body.classList.contains('dragging'));
    sash.dispatchEvent(new window.MouseEvent('pointermove', { clientY: 100000, bubbles: true }));
    await tick();
    assert.equal(sash.getAttribute('aria-valuenow'), '85');
    sash.dispatchEvent(new window.MouseEvent('pointermove', { clientY: -10000, bubbles: true }));
    await tick();
    assert.equal(sash.getAttribute('aria-valuenow'), '15');
    sash.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    await tick();
    const savedCount = saved.length;
    sash.dispatchEvent(new window.MouseEvent('lostpointercapture', { bubbles: true }));
    await tick();
    assert.equal(saved.length, savedCount, 'pointer release persists once');
    assert.ok(!document.body.classList.contains('dragging'));
    assert.equal(saved.at(-1).split, 0.15);
    assert.equal(document.querySelector('.log-pane'), panes[0].element);
    host.receive({ type: 'hostVisibility', visible: false });
    assert.ok(panes.every((pane) => pane.messages.at(-1).visible === false));
    document.dispatchEvent(new window.Event('visibilitychange'));
    assert.ok(panes.every((pane) => pane.messages.at(-1).visible === false));
    host.receive({ type: 'hostVisibility', visible: true });
    assert.ok(panes.every((pane) => pane.messages.at(-1).visible === true));
    document.body.className = 'vscode-light';
    await tick();
    assert.ok(panes.every((pane) => pane.messages.at(-1).type === 'vsgitTheme'));
    host.dispose();
    assert.ok(panes.every((pane) => pane.disposed));
    const messageCount = sent.length;
    panes[1].options.send({ type: 'filterRecent', values: ['ignored'] });
    assert.equal(sent.length, messageCount);
  } finally {
    host.dispose();
    await dom.dispose();
  }
});
