import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountRepositoryHost } from '../src/webview/repository-host';
import { createReactDom } from './helpers/react-dom';

test('repository switch retains instances and routes late data, state and status only to their own log', async () => {
  const dom = createReactDom('<style id="layout-style"></style><div id="host-app"></div>');
  const sent = [],
    frames = new Map();
  let persisted;
  const { document, window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const host = mountRepositoryHost({
    document,
    window: window as any,
    api: {
      getState: () => ({ repositories: { '/a': { columnOrder: ['date', 'subject'] } } }),
      setState(value) {
        persisted = value;
        return value;
      },
      postMessage: (message) => sent.push(message),
    },
    paneFactory(element, _html, options) {
      const frame = {
        element,
        send: options.send,
        messages: [],
        receive(message) {
          this.messages.push(message);
        },
        dispose() {},
      };
      frames.set(options.pane, frame);
      return frame;
    },
  });
  const message = host.receive;
  const tabs = () => [...document.getElementById('repositories').children] as HTMLButtonElement[];
  const logs = document.getElementById('logs');
  const summary = document.getElementById('status');
  const popup = () => document.getElementById('selected-branches-popup');
  const clickSummary = () => (summary.querySelector('button') as HTMLButtonElement).click();
  try {
    message({
      type: 'repositories',
      repositories: [
        { root: '/a', name: 'A' },
        { root: '/b', name: 'B' },
      ],
    });
    assert.equal(sent.at(-1).root, '/a');
    assert.equal(tabs()[0].getAttribute('aria-pressed'), 'true');
    message({ type: 'repositoryDocument', root: '/a', name: 'A', html: 'A document' });
    const a = frames.get('/a');
    tabs()[1].click();
    assert.equal(a.element.hidden, true);
    assert.equal(sent.at(-1).root, '/b');
    message({ type: 'repositoryDocument', root: '/b', name: 'B', html: 'B document' });
    const b = frames.get('/b');
    message({ type: 'data', pane: '/a', commits: ['late A'] });
    assert.equal(a.messages.at(-1).commits[0], 'late A');
    assert.equal(b.messages.filter((message) => message.type === 'data').length, 0);
    a.send({ type: 'frameStatus', status: 'A ready', count: '500' });
    assert.equal(summary.textContent, 'Loading repository…');
    b.send({ type: 'frameStatus', status: 'B ready', count: '1' });
    assert.equal(summary.textContent, 'B ready');
    b.send({ type: 'frameState', state: { columnOrder: ['author', 'subject'] } });
    assert.equal(persisted.repositories['/a'].columnOrder[0], 'date');
    assert.equal(persisted.repositories['/b'].columnOrder[0], 'author');
    b.send({ type: 'filterRecent', values: ['B'] });
    assert.equal(sent.at(-1).pane, '/b');
    const requests = sent.length;
    tabs()[0].click();
    assert.equal(sent.length, requests, 'returning to a repository does not reload it');
    assert.equal(logs.children[0], a.element);
    assert.equal(a.element.hidden, false);
    assert.equal(b.element.hidden, true);
    assert.equal(summary.textContent, 'A ready');
    a.send({ type: 'frameStatus', status: 'ready', branchNames: ['main', 'origin/topic'] });
    assert.equal(summary.querySelector('button').textContent, 'Selected Branches');
    clickSummary();
    await new Promise(setImmediate);
    assert.equal(popup().hidden, false);
    assert.deepEqual(
      [...popup().querySelectorAll('li')].map((item) => item.textContent),
      ['main', 'origin/topic'],
    );
    a.send({
      type: 'frameStatus',
      status: 'ready',
      branchNames: ['main', 'origin/topic'],
      count: '501',
    });
    assert.equal(popup().hidden, false, 'count-only changes leave the list open');
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise(setImmediate);
    assert.equal(popup().hidden, true);
    clickSummary();
    await new Promise(setImmediate);
    a.send({ type: 'dismissBranchSummary' });
    await new Promise(setImmediate);
    assert.equal(popup().hidden, true);
    clickSummary();
    await new Promise(setImmediate);
    b.send({ type: 'dismissBranchSummary' });
    assert.equal(popup().hidden, false, 'inactive repository cannot dismiss the active popup');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise(setImmediate);
    assert.equal(popup().hidden, true, 'hiding the panel dismisses its footer popup');
    assert.equal(a.messages.at(-1).visible, false);
    assert.equal(b.messages.at(-1).visible, false);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise(setImmediate);
    assert.equal(a.messages.at(-1).visible, true);
    assert.equal(b.messages.at(-1).visible, false);
    clickSummary();
    await new Promise(setImmediate);
    message({ type: 'hostVisibility', visible: false });
    await new Promise(setImmediate);
    assert.equal(popup().hidden, true);
    assert.equal(a.messages.at(-1).visible, false);
    document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise(setImmediate);
    assert.equal(a.messages.at(-1).visible, false);
    message({ type: 'hostVisibility', visible: true });
    assert.equal(a.messages.at(-1).visible, true);
    message({ type: 'repositoryHostError', root: '/b', message: 'B unavailable' });
    assert.equal(
      summary.querySelector('button').textContent,
      'Selected Branches',
      'late errors cannot replace another repository status',
    );
    clickSummary();
    await new Promise(setImmediate);
    tabs()[1].click();
    await new Promise(setImmediate);
    assert.equal(popup().hidden, true, 'repository switch closes previous list');
    b.send({ type: 'frameStatus', status: 'ready', branchNames: ['topic'] });
    assert.equal(summary.querySelector('.branch-summary-label').textContent, 'topic');
    assert.equal(summary.querySelector('.branch-summary-label').tagName, 'SPAN');
    b.send({ type: 'frameStatus', status: 'ready', branchNames: [] });
    assert.equal(summary.querySelector('.branch-summary-label').textContent, 'All Branches');
    b.send({ type: 'frameStatus', status: 'Loading history…' });
    assert.equal(summary.querySelector('.branch-summary-label'), null);
    assert.equal(summary.textContent, 'Loading history…');
    message({ type: 'repositories', repositories: [{ root: '/b', name: 'B' }] });
    assert.equal(logs.children.length, 1);
    assert.equal(b.element.hidden, false);
    assert.equal(tabs()[0].getAttribute('aria-pressed'), 'true');
    // A root may disappear while its document is still loading and later return.
    message({ type: 'repositories', repositories: [{ root: '/pending', name: 'Pending' }] });
    assert.equal(sent.at(-1).root, '/pending');
    message({ type: 'repositories', repositories: [] });
    const beforeReopen = sent.length;
    message({ type: 'repositories', repositories: [{ root: '/pending', name: 'Pending' }] });
    assert.equal(sent.length, beforeReopen + 1);
    assert.equal(sent.at(-1).root, '/pending');
  } finally {
    host.dispose();
    await dom.dispose();
  }
});

test('external commit location selects the correct repository and waits for its initial history', async () => {
  const dom = createReactDom('<style id="layout-style"></style><div id="host-app"></div>');
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const frames = new Map<string | number, any>();
  const sent: any[] = [];
  const host = mountRepositoryHost({
    document: dom.document,
    window: dom.window as any,
    api: {
      getState: () => ({}),
      setState: (value) => value,
      postMessage: (message) => sent.push(message),
    },
    paneFactory(_element, _html, options) {
      const frame = {
        element: _element,
        messages: [],
        receive(message) {
          this.messages.push(message);
        },
        dispose() {},
      };
      frames.set(options.pane, frame);
      return frame;
    },
  });
  try {
    host.receive({ type: 'locateCommit', root: '/b', target: 'first' });
    host.receive({
      type: 'repositories',
      repositories: [
        { root: '/a', name: 'A' },
        { root: '/b', name: 'B' },
      ],
    });
    assert.equal(sent.at(-1).root, '/b');
    host.receive({ type: 'repositoryDocument', root: '/b', name: 'B', html: '' });
    const frame = frames.get('/b');
    assert.equal(
      frame.messages.some((message) => message.type === 'historyReveal'),
      false,
    );
    host.receive({ type: 'locateCommit', root: '/b', target: 'latest' });
    host.receive({ type: 'data', pane: '/b', root: '/b', commits: [] });
    assert.deepEqual(frame.messages.at(-1), {
      type: 'historyReveal',
      root: '/b',
      target: 'latest',
    });
    host.receive({ type: 'data', pane: '/b', root: '/b', commits: [] });
    assert.equal(frame.messages.filter((message) => message.type === 'historyReveal').length, 1);
    host.receive({ type: 'locateCommit', root: '/b', target: 'already-loaded' });
    assert.equal(frame.messages.at(-1).target, 'already-loaded');
    assert.equal(dom.document.querySelector('[data-root="/b"]').hasAttribute('hidden'), false);
  } finally {
    host.dispose();
    await dom.dispose();
  }
});
