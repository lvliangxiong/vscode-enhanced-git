import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const { logDocument } = require('../out/extension/views/log-document');
const { bundlePane } = require('../out/extension/views/bundle-pane');
const project = path.resolve(__dirname, '..');
const resource = (file: string) => fs.readFileSync(path.join(project, 'out/webview', file), 'utf8');

function documentHtml(
  embedded = false,
  comparison?: { start: { name: string }; end: { name: string } },
): string {
  const html = logDocument(
    { Uri: { joinPath: (...parts: string[]) => parts.join('/') } },
    { extensionUri: project, workspaceState: { get: (_key, fallback) => fallback } },
    { webview: { asWebviewUri: (value) => value, cspSource: 'https://vsgit.test' } },
    { nonce: 'react-smoke', embedded, comparison },
    '/fixture',
  );
  if (embedded) return bundlePane(html, path.join(project, 'out/webview'), 'react-smoke');
  return html.replace(
    /<script([^>]*?) src="([^"]+)"[^>]*>\s*<\/script>/g,
    (_match, attrs, source) =>
      `<script${attrs}>${fs.readFileSync(source, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`,
  );
}

function runtime(html: string) {
  const messages: any[] = [],
    errors: Error[] = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error));
  console.on('error', (...values) => errors.push(new Error(values.join(' '))));
  const dom = new JSDOM(html, {
    url: 'https://vsgit.test',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(window) {
      let state = {};
      Object.assign(window, {
        acquireVsCodeApi: () => ({
          postMessage: (message) => messages.push(message),
          getState: () => state,
          setState: (next) => (state = next),
        }),
        ResizeObserver: class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
        Path2D: class {},
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      });
      // jsdom supplies event/DOM behavior, but has no layout or Canvas rasterizer.
      Object.defineProperties(window.HTMLElement.prototype, {
        clientHeight: {
          get() {
            return this.id === 'commits' ? 480 : 600;
          },
        },
        clientWidth: {
          get() {
            return this.id === 'branches' ? 240 : 1000;
          },
        },
        offsetWidth: {
          get() {
            return this.clientWidth;
          },
        },
        offsetHeight: {
          get() {
            return this.classList.contains('commit') ? 24 : 600;
          },
        },
      });
      window.HTMLElement.prototype.getBoundingClientRect = function () {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: this.clientWidth,
          bottom: this.clientHeight,
          width: this.clientWidth,
          height: this.clientHeight,
          toJSON() {},
        };
      };
      window.HTMLElement.prototype.getClientRects = function () {
        return [this.getBoundingClientRect()] as unknown as DOMRectList;
      };
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.HTMLElement.prototype.setPointerCapture = () => {};
      window.HTMLElement.prototype.hasPointerCapture = () => false;
      window.HTMLCanvasElement.prototype.getContext = (() =>
        new Proxy(
          {},
          {
            get: (_target, key) =>
              key === 'measureText' ? (text) => ({ width: text.length * 7 }) : () => {},
            set: () => true,
          },
        )) as any;
      // jsdom does not attach CSSStyleSheet objects to styles inside Shadow DOM.
      const sheet = Object.getOwnPropertyDescriptor(window.HTMLStyleElement.prototype, 'sheet');
      const shadowSheets = new WeakMap();
      Object.defineProperty(window.HTMLStyleElement.prototype, 'sheet', {
        get() {
          const native = sheet.get.call(this);
          if (native) return native;
          if (!shadowSheets.has(this)) shadowSheets.set(this, new window.CSSStyleSheet());
          return shadowSheets.get(this);
        },
      });
    },
  });
  const tick = () => new Promise<void>((resolve) => dom.window.setTimeout(resolve, 30));
  return {
    dom,
    messages,
    errors,
    tick,
    async dispose() {
      dom.window.dispatchEvent(new dom.window.Event('vsgitDispose'));
      dom.window.dispatchEvent(new dom.window.Event('pagehide'));
      await tick();
      dom.window.close();
    },
  };
}

function history(requestId: number, root = '/fixture') {
  const commits = [0, 1, 2].map((index) => ({
    hash: String(index + 1).repeat(40),
    parents: index < 2 ? [String(index + 2).repeat(40)] : [],
    author: 'Me',
    email: 'me@example.com',
    date: '2026-10-19T00:00:00Z',
    subject: `Commit ${index}`,
    decorations: index === 0 ? 'HEAD -> main' : '',
  }));
  return {
    type: 'data',
    root,
    requestId,
    commits,
    headHashes: [commits[0].hash],
    branches: [
      { ref: 'refs/heads/main', name: 'main', group: 'Local', current: true },
      { ref: 'refs/heads/topic', name: 'topic', group: 'Local' },
    ],
    favorites: [],
    favoriteVersion: 0,
    branchSnapshotVersion: 1,
    branchSnapshotKey: 'fixture',
    historyLimit: 500,
    hasMore: false,
    remotes: ['origin'],
    user: 'me@example.com',
    userName: 'Me',
  };
}

function iconResponse(request, color = 'blue') {
  const image =
    'data:image/svg+xml;base64,' +
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="M0 0h16v16H0z"/></svg>`,
    ).toString('base64');
  return {
    type: 'fileIcons',
    pane: request.pane,
    request: request.request,
    generation: request.generation,
    icons: { file: { image } },
    fonts: {},
    entries: request.entries.map(({ key }) => ({ key, id: 'file' })),
  };
}

function assertFileIcon(root: Document | ShadowRoot, response: ReturnType<typeof iconResponse>) {
  const icon = root.querySelector<HTMLElement>('#files .theme-file-icon');
  assert.ok(icon, 'a changed file has an icon element');
  assert.ok(
    icon.classList.contains(`theme-file-${response.generation}-0`),
    'the host response reaches the file icon renderer',
  );
  const sheet = (root.getElementById('layout-style') as HTMLStyleElement).sheet;
  assert.ok(
    [...sheet.cssRules].some((rule) => rule.cssText.includes(response.icons.file.image)),
    'the icon asset is installed in this pane stylesheet',
  );
}

test('packaged React log retains branch favorites, commit selection, detail gestures and global shortcuts', async () => {
  const app = runtime(documentHtml()),
    { dom, messages, errors } = app;
  const { document } = dom.window;
  const receive = (data) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
  try {
    await app.tick();
    assert.deepEqual(errors.map(String), []);
    const init = messages.find((message) => message.type === 'init');
    assert.ok(init);
    receive({ type: 'repos', roots: ['/fixture'] });
    const data = history(init.requestId);
    receive(data);
    await app.tick();
    assert.deepEqual(errors.map(String), []);
    assert.equal(document.querySelectorAll('.commit').length, 3);
    const rightSash = document.getElementById('split-right');
    rightSash.dispatchEvent(
      new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }),
    );
    rightSash.dispatchEvent(
      new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 900 }),
    );
    rightSash.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    await app.tick();
    assert.equal(rightSash.getAttribute('aria-valuemin'), '260');
    assert.ok(Number(rightSash.getAttribute('aria-valuenow')) >= 260);
    for (const id of [
      'files-options',
      'files-history',
      'files-sidebar',
      'files-expansion',
      'details-toggle',
    ]) {
      const button = document.getElementById(id);
      button.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 380));
      await app.tick();
      const tooltip = document.getElementById('toolbar-tooltip');
      assert.equal(tooltip.hidden, false, id);
      assert.equal(tooltip.textContent, button.getAttribute('aria-label'), id);
      button.dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true }));
    }
    assert.equal(document.getElementById('fileCount'), null);
    for (const [id, endX, expandId, field] of [
      ['split-left', -2000, 'branches-toggle', 'branchesCollapsed'],
      ['split-right', 2000, 'details-expand', 'detailsCollapsed'],
      ['split-junction', 2000, 'details-expand', 'detailsCollapsed'],
    ] as const) {
      const sash = document.getElementById(id);
      const before = messages.filter((message) => message.type === 'layoutState').at(-1)?.layout;
      for (const [type, clientX] of [
        ['pointerdown', 0],
        ['pointermove', endX],
        ['pointerup', endX],
      ]) {
        sash.dispatchEvent(
          new dom.window.MouseEvent(type as string, {
            bubbles: true,
            button: 0,
            clientX: clientX as number,
            clientY: 0,
          }),
        );
      }
      await app.tick();
      const saved = messages.filter((message) => message.type === 'layoutState').at(-1).layout;
      assert.equal(saved[field], true, id);
      if (before) {
        assert.equal(saved.left, before.left);
        assert.equal(saved.right, before.right);
      }
      assert.equal(document.body.classList.contains('resizing'), false);
      assert.equal(document.body.classList.contains('resizing-both'), false);
      document.getElementById(expandId).click();
      await app.tick();
      assert.equal(
        messages.filter((message) => message.type === 'layoutState').at(-1).layout[field],
        false,
      );
    }
    const detail = document.getElementById('detail');
    const filesPanel = document.getElementById('files');
    document.getElementById('details-toggle').click();
    await app.tick();
    assert.ok(detail.classList.contains('details-collapsed'));
    assert.equal(document.getElementById('details-expand').hidden, false);
    assert.equal(document.getElementById('split-right').hidden, true);
    assert.equal(document.getElementById('split-junction').hidden, true);
    assert.equal(filesPanel.hidden, true);
    assert.equal(
      messages.filter((message) => message.type === 'layoutState').at(-1).layout.detailsCollapsed,
      true,
    );
    document.getElementById('details-expand').click();
    await app.tick();
    assert.equal(detail.classList.contains('details-collapsed'), false);
    assert.equal(document.getElementById('split-right').hidden, false);
    assert.equal(document.getElementById('files'), filesPanel);
    assert.equal(filesPanel.hidden, false);
    assert.equal(
      messages.filter((message) => message.type === 'layoutState').at(-1).layout.detailsCollapsed,
      false,
    );

    const branch = document.querySelector<HTMLButtonElement>(
      '.branch[data-ref="refs/heads/topic"]',
    );
    branch.click();
    await app.tick();
    document.getElementById('branch-favorite').click();
    await app.tick();
    assert.equal(document.querySelectorAll('.branch[data-ref="refs/heads/topic"]').length, 1);
    assert.ok(document.querySelector('.branch[data-ref="refs/heads/topic"] .icon-star'));
    assert.equal(document.querySelector('#branches [data-key="Favorite"]'), null);
    assert.equal(messages.filter((message) => message.type === 'favorites').length, 1);
    document.getElementById('filter-branch').click();
    await app.tick();
    assert.match(document.getElementById('filter-popup').textContent, /topic/);
    const filterPopup = document.getElementById('filter-popup');
    filterPopup.querySelector<HTMLElement>('[role="menuitem"]').click();
    await app.tick();
    assert.ok(filterPopup.querySelector('textarea'));
    const selectInput = filterPopup.querySelector('textarea');
    document
      .querySelector('.graph-cell')
      .dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true }));
    document
      .querySelector('.subject-text')
      .dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await app.tick();
    assert.equal(filterPopup.hidden, false, 'Select stays open after hover updates');
    assert.equal(filterPopup.querySelector('textarea'), selectInput);

    const rows = document.querySelectorAll<HTMLElement>('.commit');
    rows[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, metaKey: true }));
    const selection = messages.filter((message) => message.type === 'select').at(-1);
    assert.deepEqual([...selection.hashes], [data.commits[0].hash, data.commits[1].hash]);
    const sidebarButton = document.getElementById('files-sidebar') as HTMLButtonElement;
    assert.ok(sidebarButton.disabled, 'wait for the selected file list to load');
    const files = [{ index: 0, path: 'src/main.ts', status: 'M' }];
    receive({
      type: 'details',
      key: selection.key,
      files,
      items: [{ hash: data.commits[0].hash, message: 'A title\n\nSee https://example.com' }],
    });
    await app.tick();
    assert.equal(sidebarButton.disabled, false);
    assert.equal(sidebarButton.getAttribute('aria-label'), 'Show File Diffs');
    assert.equal(sidebarButton.dataset.toolbarTooltip, 'Show File Diffs');
    sidebarButton.click();
    assert.equal(messages.at(-1).type, 'selectionChanges');
    assert.deepEqual([...messages.at(-1).hashes], [...selection.hashes]);
    const iconRequest = messages.find((message) => message.type === 'fileIcons');
    assert.ok(iconRequest, 'detail files request the active file icon theme');
    assert.equal(iconRequest.entries[0].path, 'src/main.ts');
    const initialIcons = iconResponse(iconRequest);
    receive(initialIcons);
    assertFileIcon(document, initialIcons);
    const file = document.querySelector<HTMLButtonElement>('#files .file');
    file.click();
    file.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(messages.filter((message) => message.type === 'selectionFile').at(-1).open, true);
    document.querySelector<HTMLAnchorElement>('.commit-revision').click();
    assert.equal(messages.at(-1).type, 'commitChanges');
    receive({
      type: 'detailStats',
      key: selection.key,
      items: [{ hash: data.commits[0].hash, stats: { files: 1, insertions: 2, deletions: 1 } }],
    });
    await app.tick();
    assert.match(document.querySelector('.commit-stats').textContent, /2 insertions/);
    let shortcutCount = 0;
    document.addEventListener('keydown', () => shortcutCount++);
    for (const key of ['j', 'b']) {
      const event = new dom.window.KeyboardEvent('keydown', {
        key,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      rows[1].dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    }
    assert.equal(shortcutCount, 2);
    document.body.className = 'vscode-light';
    dom.window.dispatchEvent(new dom.window.Event('vsgitTheme'));
    receive({ type: 'fileIconsChanged' });
    await app.tick();
    const themeRequest = messages.filter((message) => message.type === 'fileIcons').at(-1);
    assert.equal(themeRequest.generation, iconRequest.generation + 1);
    const refreshedIcons = iconResponse(themeRequest, 'green');
    receive(refreshedIcons);
    receive(initialIcons);
    assertFileIcon(document, refreshedIcons);
    assert.deepEqual(errors.map(String), []);
  } finally {
    await app.dispose();
  }
});

test('packaged React log boots in isolated shadow panes and disposes without cross-pane state', async () => {
  const app = runtime(
    '<!doctype html><html><head><style id="layout-style"></style><script nonce="smoke"></script></head><body><div id="host-app"></div></body></html>',
  );
  const { dom, errors, messages } = app;
  const receive = (data) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
  try {
    dom.window.eval(resource('repository-host.js'));
    receive({
      type: 'repositories',
      repositories: [
        { root: '/fixture-0', name: 'First' },
        { root: '/fixture-1', name: 'Second' },
      ],
    });
    for (let index = 0; index < 2; index++) {
      const button =
        dom.window.document.querySelectorAll<HTMLButtonElement>('#repositories button')[index];
      button.click();
      receive({
        type: 'repositoryDocument',
        root: `/fixture-${index}`,
        name: `Pane ${index}`,
        html: documentHtml(true),
      });
      await app.tick();
      assert.deepEqual(errors.map(String), []);
      const init = messages.find(
        (message) => message.type === 'init' && message.pane === `/fixture-${index}`,
      );
      assert.ok(init);
      receive({ type: 'repos', roots: [`/fixture-${index}`], pane: `/fixture-${index}` });
      receive({ ...history(init.requestId, `/fixture-${index}`), pane: `/fixture-${index}` });
    }
    await app.tick();
    assert.deepEqual(errors.map(String), []);
    const [firstElement, secondElement] = [
      ...dom.window.document.querySelectorAll<HTMLElement>('.log-pane'),
    ];
    const first = firstElement.shadowRoot,
      second = secondElement.shadowRoot;
    for (let index = 0; index < 2; index++) {
      const pane = `/fixture-${index}`;
      const selection = messages
        .filter((message) => message.type === 'select' && message.pane === pane)
        .at(-1);
      assert.ok(selection);
      receive({
        type: 'details',
        pane,
        key: selection.key,
        files: [{ index: 0, path: 'src/main.ts', status: 'M' }],
        items: [{ hash: selection.hashes[0], message: `Pane ${index} changes` }],
      });
    }
    await app.tick();
    const requests = [0, 1].map((index) =>
      messages.find(
        (message) => message.type === 'fileIcons' && message.pane === `/fixture-${index}`,
      ),
    );
    assert.ok(requests.every(Boolean), 'each repository requests its own file icons');
    const firstIcons = iconResponse(requests[0]);
    const secondIcons = iconResponse(requests[1], 'orange');
    receive(firstIcons);
    assertFileIcon(first, firstIcons);
    assert.equal(
      second.querySelector('#files .theme-file-icon').className,
      'theme-file-icon',
      'the first pane response does not populate another repository',
    );
    receive(secondIcons);
    assertFileIcon(second, secondIcons);
    const iconRequestsBefore = messages.filter((message) => message.type === 'fileIcons').length;
    receive({ type: 'fileIconsChanged', pane: '/fixture-0' });
    await app.tick();
    assert.equal(
      messages.filter((message) => message.type === 'fileIcons').length,
      iconRequestsBefore + 1,
    );
    const changedRequest = messages.filter((message) => message.type === 'fileIcons').at(-1);
    assert.equal(changedRequest.pane, '/fixture-0');
    assert.equal(changedRequest.generation, requests[0].generation + 1);
    assert.equal(first.querySelector('#files .theme-file-icon').className, 'theme-file-icon');
    const changedIcons = iconResponse(changedRequest, 'green');
    receive(changedIcons);
    receive(firstIcons);
    assertFileIcon(first, changedIcons);
    assertFileIcon(second, secondIcons);
    first.querySelector<HTMLButtonElement>('.branch[data-ref="refs/heads/topic"]').click();
    await app.tick();
    first.getElementById('branch-favorite').click();
    await app.tick();
    assert.equal(first.querySelectorAll('.branch[data-ref="refs/heads/topic"]').length, 1);
    assert.ok(first.querySelector('.branch[data-ref="refs/heads/topic"] .icon-star'));
    assert.equal(second.querySelectorAll('.branch[data-ref="refs/heads/topic"]').length, 1);
    assert.equal(second.querySelector('.branch[data-ref="refs/heads/topic"] .icon-star'), null);
    dom.window.document.body.className = 'vscode-light';
    await app.tick();
    assert.ok(first.querySelector('.pane-body').classList.contains('vscode-light'));
    let shortcutCount = 0;
    dom.window.document.addEventListener('keydown', () => shortcutCount++);
    const event = new dom.window.KeyboardEvent('keydown', {
      key: 'j',
      metaKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    first.querySelector('.commit').dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(shortcutCount, 1);
    receive({ type: 'repositories', repositories: [{ root: '/fixture-1', name: 'Second' }] });
    assert.equal(firstElement.isConnected, false);
    assert.equal(second.querySelectorAll('.commit').length, 3);
    await app.tick();
    assert.deepEqual(errors.map(String), []);
  } finally {
    await app.dispose();
  }
});

test('packaged comparison panes deliver file icon responses to the selected numeric pane', async () => {
  const documents = [
    documentHtml(true, { start: { name: 'main' }, end: { name: 'topic' } }),
    documentHtml(true, { start: { name: 'topic' }, end: { name: 'main' } }),
  ];
  const app = runtime(
    `<!doctype html><html><head><style id="host-style"></style><script nonce="smoke"></script></head><body><div id="host-app"></div><script id="compare-documents" type="application/json">${JSON.stringify(documents).replace(/</g, '\\u003c')}</script></body></html>`,
  );
  const { dom, messages, errors } = app;
  const receive = (data) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
  try {
    dom.window.eval(resource('compare-host.js'));
    await app.tick();
    assert.deepEqual(errors.map(String), []);
    const panes = [...dom.window.document.querySelectorAll<HTMLElement>('.log-pane')].map(
      (element) => element.shadowRoot,
    );
    for (let pane = 0; pane < 2; pane++) {
      const init = messages.find((message) => message.type === 'init' && message.pane === pane);
      assert.ok(init);
      receive({ type: 'repos', roots: ['/fixture'], pane });
      receive({ ...history(init.requestId), pane });
      panes[pane].querySelector<HTMLElement>('.commit').click();
    }
    await app.tick();
    for (let pane = 0; pane < 2; pane++) {
      const selection = messages
        .filter((message) => message.type === 'select' && message.pane === pane)
        .at(-1);
      assert.ok(selection);
      receive({
        type: 'details',
        pane,
        key: selection.key,
        files: [{ index: 0, path: 'main.go', status: 'M' }],
        items: [{ hash: selection.hashes[0], message: `Comparison ${pane}` }],
      });
    }
    await app.tick();
    const requests = [0, 1].map((pane) =>
      messages.find((message) => message.type === 'fileIcons' && message.pane === pane),
    );
    assert.ok(requests.every(Boolean));
    const rightIcons = iconResponse(requests[1], 'orange');
    receive(rightIcons);
    assertFileIcon(panes[1], rightIcons);
    assert.equal(panes[0].querySelector('#files .theme-file-icon').className, 'theme-file-icon');
    const leftIcons = iconResponse(requests[0]);
    receive(leftIcons);
    assertFileIcon(panes[0], leftIcons);
    const shortcuts: KeyboardEvent[] = [];
    const forwarded: KeyboardEvent[] = [];
    dom.window.document.addEventListener('keydown', (event) => forwarded.push(event));
    for (let n = 0; n < 6; n++) {
      const pane = n % 2;
      const target = panes[pane].querySelector<HTMLElement>(n < 2 ? '#search' : '.commit');
      for (const [key, modifiers] of [
        ['j', { metaKey: true }],
        ['b', { metaKey: true }],
        ['p', { metaKey: true, shiftKey: true }],
        ['w', { metaKey: true }],
        ['PageUp', { ctrlKey: true }],
        ['ArrowUp', { metaKey: true, altKey: true }],
      ] as const) {
        const event = new dom.window.KeyboardEvent('keydown', {
          key,
          ...modifiers,
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        shortcuts.push(event);
        target.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, `${key} must reach the workbench`);
      }
      receive({ type: 'hostVisibility', visible: n % 2 === 0 });
    }
    assert.equal(
      forwarded.length,
      shortcuts.length,
      'each key reaches the workbench document exactly once',
    );
    receive({ type: 'hostVisibility', visible: false });
    let hiddenFocus = 0;
    for (const pane of panes) {
      const row = pane.querySelector<HTMLElement>('.commit');
      row.focus = () => {
        hiddenFocus++;
      };
    }
    receive({
      type: 'historyReveal',
      pane: 0,
      root: '/fixture',
      target: history(0).commits[1].hash,
    });
    await app.tick();
    assert.equal(
      hiddenFocus,
      0,
      'late commit navigation cannot focus and reopen a collapsed panel',
    );

    assert.deepEqual(errors.map(String), []);
  } finally {
    await app.dispose();
  }
});

test('packaged commit rows update tag visibility, overlapping highlights, keyboard selection and column order', async () => {
  const app = runtime(documentHtml()),
    { dom, messages, errors } = app;
  const { document } = dom.window;
  const receive = (data) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
  const toggle = async (id: string, checked: boolean) => {
    if (document.getElementById('view-menu').hidden) {
      document.getElementById('view-options').click();
      await app.tick();
    }
    const labels = {
      'show-tags': 'Tag Names',
      'highlight-me': 'My Commits',
      'highlight-merges': 'Merge Commits',
    };
    const item = [
      ...document.querySelectorAll<HTMLElement>('#view-menu [role="menuitemcheckbox"]'),
    ].find((node) => node.textContent.trim().endsWith(labels[id]));
    assert.ok(item, `View option ${id} is available`);
    if ((item.getAttribute('aria-checked') === 'true') !== checked) {
      item.click();
      await app.tick();
    }
  };
  try {
    await app.tick();
    const init = messages.find((message) => message.type === 'init');
    receive({ type: 'repos', roots: ['/fixture'] });
    const data = history(init.requestId);
    data.commits[0].decorations += ', tag: v1.0';
    data.commits[0].parents.push(data.commits[2].hash);
    receive(data);
    await app.tick();
    const row = document.querySelector<HTMLElement>('.commit');
    const canvas = row.querySelector('canvas');
    assert.match(row.querySelector('.refs').getAttribute('aria-label'), /v1.0/);
    await toggle('show-tags', false);
    assert.equal(document.querySelector('.commit'), row);
    assert.equal(row.querySelector('canvas'), canvas);
    assert.doesNotMatch(row.querySelector('.refs').getAttribute('aria-label'), /v1.0/);
    await toggle('show-tags', true);
    assert.match(row.querySelector('.refs').getAttribute('aria-label'), /v1.0/);
    await toggle('highlight-me', true);
    assert.ok(row.classList.contains('highlighted'));
    assert.ok(!row.classList.contains('merge-muted'));
    await toggle('highlight-merges', true);
    assert.ok(row.classList.contains('highlighted'));
    assert.ok(row.classList.contains('merge-muted'));
    await toggle('highlight-merges', false);
    assert.ok(row.classList.contains('highlighted'));
    assert.ok(!row.classList.contains('merge-muted'));

    const subject = row.querySelector('[data-column="subject"]');
    const author = row.querySelector('[data-column="author"]');
    for (const [type, clientX] of [
      ['pointerdown', 1500],
      ['pointermove', -2000],
      ['pointerup', -2000],
    ] as const)
      author.dispatchEvent(
        new dom.window.MouseEvent(type, { bubbles: true, clientX, clientY: 10, button: 0 }),
      );
    await app.tick();
    assert.deepEqual(
      [...row.querySelectorAll<HTMLElement>('.log-column')].map((cell) => cell.dataset.column),
      ['author', 'subject', 'date'],
    );
    assert.equal(row.querySelector('[data-column="subject"]'), subject);
    assert.equal(row.querySelector('[data-column="author"]'), author);
    assert.equal(row.querySelector('canvas'), canvas);
    await toggle('show-tags', false);
    assert.equal(row.firstElementChild, author, 'later React updates preserve reordered columns');
    const key = new dom.window.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    row.dispatchEvent(key);
    assert.equal(key.defaultPrevented, true);
    const rows = [...document.querySelectorAll<HTMLElement>('.commit')];
    assert.deepEqual(
      rows.map((entry) => entry.getAttribute('aria-selected')),
      ['false', 'true', 'false'],
    );
    assert.equal(document.activeElement, rows[1]);
    assert.equal(row.querySelector('canvas'), canvas);
    await app.tick();
    assert.deepEqual(errors.map(String), []);
  } finally {
    await app.dispose();
  }
});
