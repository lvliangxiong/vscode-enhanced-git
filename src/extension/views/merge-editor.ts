import type * as VSCode from 'vscode';
import type { FileChange } from '../../shared/model';
import { git } from '../git/client';
import { mergeViewType } from './merge-actions';

export const mergeScheme = 'vsgit-merge';
export interface MergeResource {
  root: string;
  change: FileChange;
}
export function parseMergeResource(uri: VSCode.Uri): MergeResource {
  const value = JSON.parse(new URLSearchParams(uri.query).get('comparison') || 'null');
  if (
    uri.scheme !== mergeScheme ||
    !value ||
    typeof value.root !== 'string' ||
    !value.root ||
    !value.change ||
    typeof value.change.path !== 'string' ||
    !value.change.path ||
    !Array.isArray(value.change.mergeParents) ||
    value.change.mergeParents.length !== 2 ||
    ![value.change.after, ...value.change.mergeParents].every(
      (revision) =>
        revision && /^[a-f\d]{40,64}$/i.test(revision.hash) && typeof revision.path === 'string',
    )
  )
    throw Error('Invalid historical merge resource');
  return value;
}
interface MergeDocument extends VSCode.CustomDocument {
  resource: MergeResource;
}
const editors = new WeakMap<VSCode.ExtensionContext, ReturnType<typeof createEditor>>();

export function registerMergeEditor(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  render: (panel: VSCode.WebviewPanel, resource: MergeResource) => Promise<void>,
) {
  if (!editors.has(context)) editors.set(context, createEditor(vscode, context, render));
  return editors.get(context);
}
function createEditor(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  render: (panel: VSCode.WebviewPanel, resource: MergeResource) => Promise<void>,
) {
  const readonly = () => {
    throw vscode.FileSystemError.NoPermissions('Historical revisions are read-only');
  };
  const emitter = new vscode.EventEmitter<VSCode.FileChangeEvent[]>();
  const provider: VSCode.FileSystemProvider = {
    onDidChangeFile: emitter.event,
    watch: () => ({ dispose() {} }),
    stat: (uri) => {
      if (uri.query) parseMergeResource(uri);
      return {
        type: uri.query ? vscode.FileType.File : vscode.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
        permissions: vscode.FilePermission.Readonly,
      };
    },
    readDirectory: () => [],
    readFile: async (uri) => {
      const { root, change } = parseMergeResource(uri);
      return Buffer.from(await git(root, ['show', `${change.after.hash}:${change.after.path}`]));
    },
    writeFile: readonly,
    createDirectory: readonly,
    delete: readonly,
    rename: readonly,
  };
  const custom: VSCode.CustomReadonlyEditorProvider<MergeDocument> = {
    openCustomDocument: (uri) => ({ uri, resource: parseMergeResource(uri), dispose() {} }),
    resolveCustomEditor: (document, panel) => render(panel, document.resource),
  };
  context.subscriptions.push(
    emitter,
    vscode.workspace.registerFileSystemProvider(mergeScheme, provider, {
      isReadonly: true,
      isCaseSensitive: true,
    }),
    vscode.window.registerCustomEditorProvider(mergeViewType, custom, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
  );
  return {
    open(root: string, change: FileChange) {
      // The manifest registers the factory on the virtual root only. Open file
      // resources by editor ID so they keep native labels without contributing
      // a second file association (and its breadcrumb editor-type picker).
      const uri = vscode.Uri.from({
        scheme: mergeScheme,
        path: '/' + change.path.replace(/^\/+/, ''),
        query: new URLSearchParams({ comparison: JSON.stringify({ root, change }) }).toString(),
      });
      return vscode.commands.executeCommand('vscode.openWith', uri, mergeViewType, {
        preview: false,
      });
    },
  };
}
