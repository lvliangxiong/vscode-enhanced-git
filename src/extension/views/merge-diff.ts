import type * as VSCode from 'vscode';
import type { FileChange, Revision } from '../../shared/model';
import { mergeDiffStyle, type MergeDiffData } from '../../shared/merge-diff';
import { git } from '../git/client';
import { selectionPatch } from '../git/changes';
import { readCommitMetadata, readCommitHoverStats } from '../git/commit-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { mergeSyntaxService } from '../syntax/service';
import { registerMergeEditor } from './merge-editor';
import { mergeActions } from './merge-actions';

export function registerHistoricalMergeEditor(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  snapshots: Map<string, string>,
) {
  mergeActions(vscode, context);
  return registerMergeEditor(vscode, context, async (panel, { root, change }) => {
    await renderMergeDiff(vscode, context, snapshots, root, change, panel);
  });
}

/** Historical versions are immutable. Never launch VS Code's editable conflict
 * resolver on a committed merge result or the user's working tree.
 */
export async function openMergeDiff(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  snapshots: Map<string, string>,
  root: string,
  change: FileChange,
) {
  if (change.after && change.mergeParents?.length === 2 && change.mergeParents.every(Boolean))
    return registerHistoricalMergeEditor(vscode, context, snapshots).open(root, change);
  return renderMergeDiff(vscode, context, snapshots, root, change);
}
async function renderMergeDiff(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  snapshots: Map<string, string>,
  root: string,
  change: FileChange,
  panel?: VSCode.WebviewPanel,
) {
  const [left, right] = change.mergeParents;
  const result = change.after;
  const revisions = [left, result, right] as const;
  const contents = await Promise.all(
    revisions.map((revision) =>
      revision ? git(root, ['show', `${revision.hash}:${revision.path}`]) : Promise.resolve(''),
    ),
  );
  const make = (revision: Revision | null, text: string) => {
    const uri = vscode.Uri.from({
      scheme: 'vscode-git',
      path: '/' + (revision?.path || change.path),
      query: new URLSearchParams({
        revision: revision?.hash || 'empty',
        snapshot: randomUUID(),
      }).toString(),
    });
    snapshots.set(uri.toString(), text);
    return uri;
  };
  const label = (revision: Revision | null) => revision?.hash.slice(0, 8) || 'Absent';
  const compare = (a: number, b: number) =>
    vscode.commands.executeCommand(
      'vscode.diff',
      make(revisions[a], contents[a]),
      make(revisions[b], contents[b]),
      `${change.path} · ${label(revisions[a])} → ${label(revisions[b])}`,
    );
  // Rebased falls back to two sides when a parent or the result is absent.
  if (!left) return compare(1, 2);
  if (!right) return compare(0, 1);
  if (!result) return compare(0, 2);
  const [patches, commits] = await Promise.all([
    Promise.all(
      [left, right].map((before, parent) =>
        selectionPatch(
          root,
          {
            ...change,
            before,
            mergeParents: undefined,
          },
          0,
          [contents[parent === 0 ? 0 : 2], contents[1]],
          'histogram',
        ),
      ),
    ),
    readCommitMetadata(
      root,
      revisions.map((revision) => revision.hash),
    ),
  ]);
  const data: MergeDiffData = {
    path: change.path,
    labels: [
      `Parent 1 · ${label(left)}`,
      `Merge Result · ${label(result)}`,
      `Parent 2 · ${label(right)}`,
    ],
    contents: contents as MergeDiffData['contents'],
    patches: patches as [string, string],
    commits: commits as MergeDiffData['commits'],
  };
  if (!panel) throw Error('Missing historical merge editor');
  panel.title = `${change.path.split('/').pop()} (${label(result)})`;
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
  };
  const actions = mergeActions(vscode, context).attach(
    panel,
    (parent) => compare(parent === 0 ? 0 : 2, 1),
    () =>
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(root, result.path)), {
        preview: false,
      }),
  );
  const nonce = randomBytes(16).toString('hex');
  const syntax = mergeSyntaxService(vscode, context);
  const syntaxListener = syntax?.subscribe(() => {
    void panel.webview.postMessage({ type: 'mergeSyntaxChanged' });
  });
  const repository = vscode.Uri.file?.(root);
  const style = () =>
    mergeDiffStyle(
      vscode.workspace
        .getConfiguration?.('vscode-git', repository)
        ?.get('mergeDiffStyle', 'native'),
    );
  const styleListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
    if (event.affectsConfiguration('vscode-git.mergeDiffStyle', repository))
      void panel.webview.postMessage({ type: 'mergeDiffStyle', style: style() });
  });
  const hoverStats = new Map<string, ReturnType<typeof readCommitHoverStats>>();
  const resource = (file: string) =>
    panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', file));
  const subscription = panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (message.type === 'ready')
        await panel.webview.postMessage({
          type: 'mergeDiff',
          data: { ...data, style: style() },
        });
      if (message.type === 'mergeEditorState') {
        actions.ready(message.ready === true);
        if (message.ready)
          await panel.webview.postMessage({ type: 'mergeDiffStyle', style: style() });
      }
      if (message.type === 'mergeCommitAction') {
        const commit = commits.find((item) => item.hash === message.hash);
        if (!commit) return;
        if (message.action === 'copy') await vscode.env.clipboard.writeText(commit.hash);
        if (message.action === 'email')
          await vscode.env.openExternal(
            vscode.Uri.parse('mailto:' + encodeURIComponent(commit.email)),
          );
        if (message.action === 'stats') {
          let pending = hoverStats.get(commit.hash);
          if (!pending) {
            pending = readCommitHoverStats(root, commit.hash);
            hoverStats.set(commit.hash, pending);
          }
          try {
            await panel.webview.postMessage({
              type: 'mergeCommitStats',
              hash: commit.hash,
              stats: await pending,
            });
          } catch {
            hoverStats.delete(commit.hash);
            await panel.webview.postMessage({
              type: 'mergeCommitStats',
              hash: commit.hash,
              stats: null,
            });
          }
        }
      }
      if (message.type === 'mergeSyntax') {
        try {
          const value =
            message.action === 'snapshot'
              ? await syntax?.snapshot(
                  path.join(root, change.path),
                  typeof message.theme === 'string' ? message.theme : undefined,
                )
              : message.action === 'grammar' && typeof message.scope === 'string'
                ? await syntax?.grammar(message.scope)
                : null;
          await panel.webview.postMessage({ type: 'mergeSyntax', request: message.request, value });
        } catch {
          await panel.webview.postMessage({
            type: 'mergeSyntax',
            request: message.request,
            value: null,
          });
        }
      }
      if (message.type === 'compareParent' && (message.parent === 0 || message.parent === 1))
        await compare(message.parent === 0 ? 0 : 2, 1);
    } catch (error) {
      void vscode.window.showErrorMessage(`VS Code Git: ${error.message}`);
    }
  });
  panel.onDidDispose(() => {
    subscription.dispose();
    syntaxListener?.dispose();
    styleListener?.dispose();
    actions.dispose();
    hoverStats.clear();
  });
  // Monaco uses inline styles for token colors and editor layout. Only this
  // dedicated editor view permits them; scripts remain nonce restricted.
  panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; font-src ${panel.webview.cspSource}; connect-src ${panel.webview.cspSource}; worker-src blob:;">
    <meta name="merge-worker" content="${resource('monaco/editor.worker.js')}">
    <meta name="merge-oniguruma" content="${resource('monaco/onig.wasm')}">
    <link rel="stylesheet" href="${resource('monaco/merge-diff.css')}"><link rel="stylesheet" href="${resource('merge-diff.css')}">
    </head><body><div id="merge-app"></div><script nonce="${nonce}" src="${resource('monaco/merge-diff.js')}"></script></body></html>`;
}
