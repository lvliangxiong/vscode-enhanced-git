import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VsCodeGitFileIcons } from '../src/webview/theme-file-icons';
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
test('themed icons batch/deduplicate requests, reuse CSS and discard responses from old themes', async () => {
  const sent = [],
    elements = [],
    events = {};
  function sheet() {
    return {
      cssRules: [],
      insertRule(text) {
        const rule = text.startsWith('@media')
          ? sheet()
          : {
              style: {
                setProperty(key, value) {
                  this[key] = value;
                },
              },
              text,
            };
        this.cssRules.push(rule);
        return this.cssRules.length - 1;
      },
      deleteRule(i) {
        this.cssRules.splice(i, 1);
      },
    };
  }
  const css = sheet();
  const api = VsCodeGitFileIcons.create({
    send: (type, msg) => sent.push({ type, ...msg }),
    sheet: css as unknown as CSSStyleSheet,
    window: {
      addEventListener: (key, fn) => (events[key] = fn),
      removeEventListener: (key) => delete events[key],
    } as unknown as Window,
    document: {
      querySelectorAll: () => elements,
      createElement: () => {
        const node = { dataset: {}, setAttribute() {} };
        elements.push(node);
        return node;
      },
    } as unknown as Document,
  });
  const a = api.node('a.go'),
    b = api.node('a.go');
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].entries.length, 1);
  api.receive({
    type: 'fileIcons',
    generation: 0,
    icons: { go: { image: 'data:image/svg+xml;base64,PHN2Zy8+' } },
    entries: [{ key: a.dataset.iconKey, id: 'go' }],
  });
  assert.equal(a.className, b.className);
  assert.match(a.className, /theme-file-0-0/);
  const c = api.node('a.go');
  assert.equal(c.className, a.className);
  await tick();
  assert.equal(sent.length, 1);
  api.receive({ type: 'fileIconsChanged' });
  await tick();
  assert.equal(sent.at(-1).generation, 1);
  api.receive({
    type: 'fileIcons',
    generation: 0,
    icons: {},
    entries: [{ key: a.dataset.iconKey, id: 'go' }],
  });
  assert.equal(a.className, 'theme-file-icon');
  api.receive({
    type: 'fileIcons',
    generation: 1,
    fonts: { seti: { sources: [{ data: 'data:font/woff;base64,Zm9udA==' }] } },
    icons: { go: { font: 'seti', character: '\ue001', size: '150%', color: '#123456' } },
    entries: [{ key: a.dataset.iconKey, id: 'go' }],
  });
  assert.match(a.className, /theme-file-1-0/);
  assert.ok(
    css.cssRules[0].cssRules.some((rule) =>
      rule.style.fontFamily?.startsWith('vscode-git-file-font-1'),
    ),
  );
  const folder = api.node('src', true);
  await tick();
  api.set(folder, 'src', true, true);
  await tick();
  assert.equal(sent.at(-1).entries[0].expanded, true);
  api.dispose();
  assert.equal(events['message'], undefined);
});
test('remote icon requests route to the UI bridge with associations and notify subscribed views', async () => {
  const { createIconThemeService } = require('../out/extension/icons/service'),
    commands = new Map(),
    calls = [],
    posts = [];
  let changed;
  const disposable = { dispose() {} };
  const vscode = {
    env: { remoteName: 'ssh-remote' },
    Uri: { file: (fsPath) => ({ fsPath }) },
    workspace: {
      onDidChangeConfiguration: () => disposable,
      getConfiguration: () => ({ get: () => ({ '*.go': 'go' }) }),
    },
    window: {
      onDidChangeActiveColorTheme: (fn) => {
        changed = fn;
        return disposable;
      },
    },
    extensions: {
      all: [{ packageJSON: { contributes: { languages: [{ id: 'go', extensions: ['.go'] }] } } }],
      onDidChange: () => disposable,
    },
    commands: {
      registerCommand: (name, fn) => {
        commands.set(name, fn);
        return disposable;
      },
      executeCommand: async (name, request) => {
        calls.push({ name, request });
        return { entries: [], icons: {}, fonts: {} };
      },
    },
  };
  const service = createIconThemeService(vscode, { subscriptions: [] });
  let notifications = 0;
  const subscription = service.subscribe(() => notifications++);
  await service.handle(
    { type: 'fileIcons', entries: [{ key: 'a', path: 'a.go' }], generation: 2, request: 7 },
    (msg) => posts.push(msg),
    '/repo',
  );
  assert.equal(calls[0].name, 'vscode-git.icons.resolve');
  assert.equal(calls[0].request.languages[0].id, 'go');
  assert.deepEqual(calls[0].request.associations, { '*.go': 'go' });
  assert.equal(posts[0].generation, 2);
  assert.equal(posts[0].request, 7);
  changed();
  assert.equal(notifications, 1);
  subscription.dispose();
  changed();
  assert.equal(notifications, 1);
});
test('shadow panes register uniquely named fonts in the outer document and clear them on theme changes', () => {
  function sheet() {
    return {
      cssRules: [],
      insertRule(text) {
        this.cssRules.push(
          text.startsWith('@media')
            ? sheet()
            : {
                style: {
                  setProperty(key, value) {
                    this[key] = value;
                  },
                },
                text,
              },
        );
        return this.cssRules.length - 1;
      },
      deleteRule(i) {
        this.cssRules.splice(i, 1);
      },
    };
  }
  const outer = sheet(),
    inner = sheet();
  const api = VsCodeGitFileIcons.create({
    send() {},
    sheet: inner as unknown as CSSStyleSheet,
    scope: {
      vsCodeGitFontSheet: outer as unknown as CSSStyleSheet,
      vsCodeGitFontPrefix: 'pane-7-',
    },
    window: { addEventListener() {}, removeEventListener() {} } as unknown as Window,
    document: { querySelectorAll: () => [] } as unknown as Document,
  });
  api.receive({
    type: 'fileIcons',
    generation: 0,
    fonts: { seti: { sources: [{ data: 'data:font/woff;base64,Zm9udA==' }] } },
    icons: { go: { font: 'seti', character: '\ue001' } },
    entries: [],
  });
  const face = outer.cssRules[0].cssRules[0],
    icon = inner.cssRules[0].cssRules[0];
  assert.equal(face.text, '@font-face {}');
  assert.equal(face.style.fontFamily, 'vscode-git-file-font-pane-7-0-0');
  assert.equal(icon.style.fontFamily, face.style.fontFamily);
  assert.equal(inner.cssRules[0].cssRules.length, 1);
  api.reset();
  assert.equal(outer.cssRules[0].cssRules.length, 0);
  assert.equal(inner.cssRules[0].cssRules.length, 0);
  api.dispose();
});
