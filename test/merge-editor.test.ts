import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  registerMergeEditor,
  parseMergeResource,
  mergeScheme,
} from '../src/extension/views/merge-editor';
import { mergeActions, mergeViewType } from '../src/extension/views/merge-actions';
import type { FileChange } from '../src/shared/model';

const change: FileChange = {
  index: 0,
  status: 'M',
  path: 'src/中文 file.go',
  before: { hash: 'a'.repeat(40), path: 'old.go' },
  after: { hash: 'b'.repeat(40), path: 'src/中文 file.go' },
  mergeParents: [
    { hash: 'a'.repeat(40), path: 'old.go' },
    { hash: 'c'.repeat(40), path: 'src/中文 file.go' },
  ],
};
const disposable = () => ({ dispose() {} });
function host() {
  const commands = new Map<string, (...args: any[]) => any>();
  const contexts: unknown[][] = [],
    errors: string[] = [];
  let custom: any, filesystem: any, open: any[];
  const vscode = {
    EventEmitter: class {
      event = disposable;
      dispose() {}
    },
    FileType: { File: 1, Directory: 2 },
    FilePermission: { Readonly: 1 },
    FileSystemError: { NoPermissions: (message) => Error(message) },
    Uri: { from: (value) => value },
    workspace: {
      registerFileSystemProvider(scheme, provider, options) {
        assert.equal(scheme, mergeScheme);
        assert.equal(options.isReadonly, true);
        filesystem = provider;
        return disposable();
      },
    },
    window: {
      registerCustomEditorProvider(id, provider, options) {
        assert.equal(id, mergeViewType);
        assert.equal(options.supportsMultipleEditorsPerDocument, true);
        custom = provider;
        return disposable();
      },
      showErrorMessage: (message) => errors.push(message),
    },
    commands: {
      registerCommand(id, handler) {
        commands.set(id, handler);
        return disposable();
      },
      executeCommand: async (id, ...args) => {
        if (id === 'setContext') contexts.push(args);
        if (id === 'vscode.openWith') open = args;
      },
    },
  } as any;
  const context = { subscriptions: [] } as any;
  return {
    vscode,
    context,
    commands,
    contexts,
    errors,
    custom: () => custom,
    filesystem: () => filesystem,
    open: () => open,
  };
}

test('historical custom editor restores immutable revisions from its resource and rejects writes', async () => {
  const h = host(),
    renders: unknown[][] = [];
  const editor = registerMergeEditor(h.vscode, h.context, async (...args) => {
    renders.push(args);
  });
  assert.equal(
    registerMergeEditor(h.vscode, h.context, async () => {}),
    editor,
  );
  await editor.open('/repo with spaces', change);
  const [uri, id, options] = h.open();
  assert.equal(id, mergeViewType);
  assert.equal(options.preview, false);
  assert.equal(uri.path, '/src/中文 file.go');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const contribution = manifest.contributes.customEditors.find(
    (editor) => editor.viewType === mergeViewType,
  );
  assert.deepEqual(contribution.selector, [{ filenamePattern: `${mergeScheme}:/` }]);
  assert.notEqual(
    `${uri.scheme}:${uri.path}`,
    contribution.selector[0].filenamePattern,
    'comparison files open explicitly without a second breadcrumb editor association',
  );
  assert.deepEqual(parseMergeResource(uri), { root: '/repo with spaces', change });
  const document = h.custom().openCustomDocument(uri),
    panel = {};
  await h.custom().resolveCustomEditor(document, panel);
  assert.deepEqual(renders, [[panel, { root: '/repo with spaces', change }]]);
  const fs = h.filesystem();
  assert.equal(fs.stat(uri).permissions, h.vscode.FilePermission.Readonly);
  for (const method of ['writeFile', 'delete', 'rename', 'createDirectory'])
    assert.throws(() => fs[method](uri), /read-only/);
  for (const data of [
    null,
    { root: '/repo', change: { ...change, mergeParents: {} } },
    { root: '/repo', change: { ...change, after: null } },
    { root: '/repo', change: { ...change, mergeParents: [change.before] } },
  ])
    assert.throws(() =>
      parseMergeResource({
        ...uri,
        query: new URLSearchParams({ comparison: JSON.stringify(data) }).toString(),
      }),
    );
});

test('native title actions follow the active merge tab, readiness and disposal', async () => {
  const h = host(),
    controller = mergeActions(h.vscode, h.context);
  assert.equal(mergeActions(h.vscode, h.context), controller);
  const messages = [[], []] as any[][],
    comparisons = [],
    openedFiles = [];
  const panels = messages.map((sent) => {
    let changed: () => void;
    return {
      active: false,
      webview: {
        postMessage: async (message) => {
          sent.push(message);
        },
      },
      onDidChangeViewState: (listener) => {
        changed = listener;
        return disposable();
      },
      focus(value) {
        this.active = value;
        changed();
      },
    };
  });
  const attachments = panels.map((panel, i) =>
    controller.attach(
      panel as any,
      async (parent) => {
        comparisons.push([i, parent]);
      },
      async () => {
        openedFiles.push(i);
      },
    ),
  );
  const command = (action: string) => h.commands.get('vscode-git.merge.' + action)();
  panels[0].focus(true);
  await command('next');
  assert.deepEqual(messages, [[], []], 'loading views cannot navigate');
  await command('openFile');
  assert.deepEqual(
    openedFiles,
    [0],
    'opening the working file does not depend on difference navigation',
  );
  attachments[0].ready(true);
  await command('next');
  assert.deepEqual(messages[0], [{ type: 'mergeAction', action: 'next' }]);
  panels[0].focus(false);
  panels[1].focus(true);
  await command('previous');
  assert.equal(messages[1].length, 0);
  attachments[1].ready(true);
  await command('previous');
  await command('compareParent2');
  await command('openFile');
  assert.deepEqual(openedFiles, [0, 1], 'Open File uses the active comparison');
  assert.deepEqual(messages[1], [{ type: 'mergeAction', action: 'previous' }]);
  assert.deepEqual(comparisons, [[1, 1]]);
  attachments[1].dispose();
  await command('compareParent1');
  assert.equal(comparisons.length, 1, 'closed views cannot receive commands');
  await command('openFile');
  assert.deepEqual(openedFiles, [0, 1]);
  assert.deepEqual(h.contexts.at(-1), ['vscode-git.merge.canNavigate', false]);
  panels[0].focus(true);
  attachments[0].dispose();
  const failing = controller.attach(
    panels[0] as any,
    () => {
      throw Error('comparison failed');
    },
    async () => {
      throw Error('file no longer exists in the working tree');
    },
  );
  await command('compareParent1');
  await command('openFile');
  assert.deepEqual(h.errors, [
    'VS Code Git: comparison failed',
    'VS Code Git: file no longer exists in the working tree',
  ]);
  failing.dispose();
});
