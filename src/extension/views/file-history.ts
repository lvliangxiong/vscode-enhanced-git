import type * as VSCode from 'vscode';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createFileHistory, fileHistoryDiff, compareHistoryEntries } from '../git/file-history';
import type {
  FileHistoryEntry,
  FileHistoryToolbarState,
  FileHistoryViewOptions,
} from '../../shared/file-history';
import { readCommitHoverStats } from '../git/commit-metadata';
import { projectGraph } from '../git/topology';
import type { FileHistoryPage } from '../../shared/file-history';
import { nativeFileDiff } from './native-file-diff';

export interface FileHistoryActions {
  snapshots: Map<string, string>;
  showAffected?: (entries: FileHistoryEntry[]) => PromiseLike<unknown>;
  selectInLog?: (entry: FileHistoryEntry) => PromiseLike<unknown>;
}
/** Retained SCM sidebar; native comparisons occupy the existing editor group. */
export class FileHistoryView implements VSCode.WebviewViewProvider {
  private view?: VSCode.WebviewView;
  private ready = false;
  private generation = 0;
  private toolbar?: FileHistoryToolbarState;
  private contexts = new Map<string, boolean>();
  private pending?: {
    root: string;
    revision: string;
    file: string;
    actions: FileHistoryActions;
  };
  private session?: ReturnType<typeof historySession>;
  constructor(
    private vscode: typeof VSCode,
    private context: VSCode.ExtensionContext,
    private workingFiles: Map<string, VSCode.Uri>,
  ) {
    for (const action of ['refresh', 'compareLocal', 'affected', 'viewOptions', 'locate'])
      context.subscriptions.push(
        vscode.commands.registerCommand(`vsgit.fileHistory.${action}`, () =>
          this.runAction(action).catch((error) => {
            void vscode.window.showErrorMessage(`VS Code Git: ${error.message}`);
          }),
        ),
      );
  }

  private updateToolbar(state?: FileHistoryToolbarState) {
    this.toolbar = state;
    const available = !!this.pending && !!state && !state.loading;
    const compare = available && state.selected >= 1 && state.selected <= 2;
    const values = {
      canRefresh: available,
      canCompareLocal: available && state.selected === 1,
      canAffected: compare && state.affected,
      canLocate: available && state.selected === 1 && state.locate,
    };
    for (const [key, value] of Object.entries(values)) {
      if (this.contexts.get(key) === value) continue;
      this.contexts.set(key, value);
      void this.vscode.commands.executeCommand('setContext', `vsgit.fileHistory.${key}`, value);
    }
  }

  private async runAction(action: string) {
    if (!this.ready || !this.view) return;
    if (action === 'viewOptions') {
      const view = this.view;
      const current = this.toolbar?.view || {
        author: true,
        date: true,
        hash: true,
        details: false,
      };
      const options: { key: keyof FileHistoryViewOptions; label: string; picked: boolean }[] = [
        { key: 'author', label: 'Show Author', picked: current.author },
        { key: 'date', label: 'Show Date', picked: current.date },
        { key: 'hash', label: 'Show Commit Hash', picked: current.hash },
        { key: 'details', label: 'Show Commit Details', picked: current.details },
      ];
      const picked = await this.vscode.window.showQuickPick(options, {
        canPickMany: true,
        title: 'File History: View Options',
      });
      if (!picked || this.view !== view || !this.ready) return;
      const settings = Object.fromEntries(
        options.map((option) => [option.key, picked.some((item) => item.key === option.key)]),
      );
      await view.webview.postMessage({ type: 'historyViewOptions', view: settings });
      return;
    }
    const enablement: Record<string, string> = {
      refresh: 'canRefresh',
      compareLocal: 'canCompareLocal',
      affected: 'canAffected',
      locate: 'canLocate',
    };
    if (!this.contexts.get(enablement[action])) return;
    await this.view.webview.postMessage({
      type: 'historyAction',
      action,
      generation: this.generation,
    });
  }

  async show(root: string, revision: string, file: string, actions: FileHistoryActions) {
    this.session?.dispose();
    this.session = undefined;
    this.updateToolbar();
    this.pending = {
      root,
      revision,
      file,
      actions,
    };
    void this.vscode.commands.executeCommand('vsgit.fileHistory.focus');
    if (this.ready) await this.start();
  }

  private async start() {
    if (!this.pending || !this.view) return;
    const { root, revision, file, actions } = this.pending;
    this.view.description = `${path.basename(file)} · Up to ${revision.slice(0, 8)}`;
    this.updateToolbar();
    this.session = historySession(
      this.vscode,
      this.view,
      root,
      revision,
      file,
      actions,
      this.workingFiles,
      () => ++this.generation,
    );
    await this.session.receive({ type: 'ready' });
  }

  resolveWebviewView(view: VSCode.WebviewView) {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.vscode.Uri.joinPath(this.context.extensionUri, 'out/webview')],
    };
    const subscription = view.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openGitLog') {
        await this.vscode.commands.executeCommand('vsgit.open');
      } else if (message.type === 'ready') {
        if (this.ready) return;
        this.ready = true;
        if (this.pending) await this.start();
        else await view.webview.postMessage({ type: 'historyEmpty' });
      } else if (message.type === 'historyToolbarState') {
        if (message.generation === this.generation) this.updateToolbar(message.state);
      } else await this.session?.receive(message);
    });
    view.onDidDispose(() => {
      subscription.dispose();
      this.dispose();
      this.view = undefined;
      this.ready = false;
    });
    const nonce = randomBytes(16).toString('hex');
    const resource = (name: string) =>
      view.webview.asWebviewUri(
        this.vscode.Uri.joinPath(this.context.extensionUri, 'out/webview', name),
      );
    view.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${view.webview.cspSource};">
      <link rel="stylesheet" href="${resource('file-history.css')}"></head><body><div id="file-history-app"></div><script nonce="${nonce}" src="${resource('file-history.js')}"></script></body></html>`;
  }

  dispose() {
    this.session?.dispose();
    this.session = undefined;
    this.updateToolbar();
  }
}

function historySession(
  vscode: typeof VSCode,
  panel: VSCode.WebviewView,
  root: string,
  revision: string,
  file: string,
  actions: FileHistoryActions,
  workingFiles: Map<string, VSCode.Uri>,
  nextGeneration: () => number,
) {
  let history = createFileHistory(root, revision, file);
  let pendingPage: FileHistoryPage;
  const column = () => vscode.window.tabGroups?.activeTabGroup.viewColumn || vscode.ViewColumn.One;
  const native = nativeFileDiff(
    vscode,
    column,
    actions.snapshots,
    vscode.Uri.file(path.join(root, file)),
    workingFiles,
  );
  const entries = new Map<string, FileHistoryEntry>();
  let disposed = false,
    loading = false,
    started = false,
    generation = nextGeneration(),
    diffRequest = 0;
  const selectedEntries = (message: any) => {
    const hashes: unknown[] = Array.isArray(message.hashes) ? message.hashes : [message.hash];
    if (
      !hashes.length ||
      hashes.length > 2 ||
      hashes.some((hash) => typeof hash !== 'string' || !entries.has(hash))
    )
      return [];
    return [...entries.values()].filter((entry) => hashes.includes(entry.hash));
  };
  void panel.webview.postMessage({ type: 'historyStart', path: file, revision, generation });
  const receive = async (message: any) => {
    let receivedGeneration = generation;
    try {
      if (disposed || (message.generation !== undefined && message.generation !== generation))
        return;
      if (
        message.type === 'ready' ||
        message.type === 'historyMore' ||
        message.type === 'historyRefresh'
      ) {
        if (loading || (message.type === 'ready' && started)) return;
        const reset = message.type === 'historyRefresh';
        if (reset) {
          history = createFileHistory(root, revision, file);
          pendingPage = undefined;
          generation = nextGeneration();
          receivedGeneration = generation;
          diffRequest++;
          entries.clear();
          await panel.webview.postMessage({
            type: 'historyStart',
            refresh: true,
            path: file,
            revision,
            generation,
          });
        }
        started = true;
        loading = true;
        try {
          const page = pendingPage || (await history.next());
          pendingPage = page;
          if (disposed) return;
          if (reset) entries.clear();
          for (const entry of page.entries) entries.set(entry.hash, entry);
          const projected = await projectGraph(root, [...entries.values()], {
            hasMore: page.hasMore,
            revision,
            sortByTopology: true,
          });
          if (disposed) return;
          const orderedEntries = projected.map((commit) => entries.get(commit.hash));
          entries.clear();
          for (const entry of orderedEntries) entries.set(entry.hash, entry);
          const graph = projected.map(
            ({ hash, graphParents, graphUnloadedParents, graphLayout, graphColor }) => ({
              hash,
              graphParents,
              graphUnloadedParents,
              graphLayout,
              graphColor,
            }),
          );
          await panel.webview.postMessage({
            type: 'historyPage',
            ...page,
            graph,
            path: file,
            revision,
            reset,
            generation,
            capabilities: { affected: !!actions.showAffected, locate: !!actions.selectInLog },
          });
          pendingPage = undefined;
        } finally {
          loading = false;
        }
      }
      if (message.type === 'historyDiff' || message.type === 'historyCompareLocal') {
        const chosen = selectedEntries(message);
        if (
          !chosen.length ||
          (message.generation !== undefined && message.generation !== generation)
        )
          return;
        const request = ++diffRequest;
        let data =
          chosen.length === 1
            ? await fileHistoryDiff(root, chosen[0])
            : await compareHistoryEntries(root, chosen[1], chosen[0]);
        if (message.type === 'historyCompareLocal') {
          if (chosen.length !== 1) return;
          let text = '';
          try {
            text = await fs.readFile(path.join(root, file), 'utf8');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          data = {
            ...data,
            beforeLabel: data.afterLabel,
            afterLabel: 'Working Tree',
            contents: [data.contents[1], text],
          };
        }
        if (disposed || request !== diffRequest) return;
        await native.open(data);
        if (!disposed && request === diffRequest)
          await panel.webview.postMessage({
            type: 'historyDiffReady',
            key: message.key,
            generation,
          });
      }
      if (message.type === 'historyDetails') {
        const chosen = selectedEntries(message);
        const items = await Promise.all(
          chosen.map(async (entry) => ({
            hash: entry.hash,
            stats: await readCommitHoverStats(root, entry.hash),
          })),
        );
        if (!disposed && receivedGeneration === generation)
          await panel.webview.postMessage({ type: 'historyDetails', items, generation });
      }
      if (message.type === 'historyCopy') {
        const chosen = selectedEntries(message);
        if (chosen.length === 1) await vscode.env.clipboard.writeText(chosen[0].hash);
      }
      if (message.type === 'historyOpenLink' && typeof message.url === 'string') {
        const uri = vscode.Uri.parse(message.url);
        if (['https', 'http', 'mailto'].includes(uri.scheme)) await vscode.env.openExternal(uri);
      }
      if (message.type === 'historyAffected') {
        const chosen = selectedEntries(message);
        if (chosen.length) await actions.showAffected?.(chosen);
      }
      if (message.type === 'historyLocate') {
        const chosen = selectedEntries(message);
        if (chosen.length === 1) await actions.selectInLog?.(chosen[0]);
      }
    } catch (error) {
      if (disposed || receivedGeneration !== generation) return;
      void vscode.window.showErrorMessage(`VS Code Git: ${error.message}`);
      await panel.webview.postMessage({
        type: 'historyError',
        key: message.key,
        hash: message.hash,
        message: error.message,
        operation: message.type,
        generation,
      });
    }
  };
  return {
    receive,
    dispose() {
      disposed = true;
      diffRequest++;
      entries.clear();
      native.dispose();
    },
  };
}
