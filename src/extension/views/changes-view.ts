import { openWorkingFile } from './open-working-file';
import type * as VSCode from 'vscode';
import type { ChangesContent, ComparisonSnapshot, Revision } from '../../shared/model';
import type { createIconThemeService } from '../icons/service';
const crypto = require('node:crypto');
import { git } from '../git/client';
import { openMergeDiff } from './merge-diff';

// Own comparison endpoints or a fixed commit selection independently of any log editor.
class ChangesView implements VSCode.WebviewViewProvider {
  private request = 0;
  private tree = true;
  private hasFolders = false;
  private expanded = false;
  private refreshing = false;
  private ready = false;
  private contexts = new Map<string, boolean>();
  private view?: VSCode.WebviewView;
  private comparison?: ComparisonSnapshot;
  private loadComparison?: () => Promise<ChangesContent>;
  constructor(
    private vscode: typeof VSCode,
    private context: VSCode.ExtensionContext,
    private snapshots: Map<string, string>,
    private iconThemes?: ReturnType<typeof createIconThemeService>,
  ) {
    const actions = {
      refresh: () => this.refresh(),
      reset: () => this.reset(),
      toggleLayout: async () => {
        this.tree = !this.tree;
        await Promise.all([
          this.updateContexts(),
          this.view?.webview.postMessage({
            type: 'comparisonAction',
            action: 'tree',
            tree: this.tree,
          }),
        ]);
      },
      toggleExpansion: async () => {
        if (!this.tree || !this.hasFolders) return;
        this.expanded = !this.expanded;
        await Promise.all([
          this.updateContexts(),
          this.view?.webview.postMessage({
            type: 'comparisonAction',
            action: 'expansion',
            expanded: this.expanded,
          }),
        ]);
      },
    };
    for (const [name, action] of Object.entries(actions))
      context.subscriptions.push(
        vscode.commands.registerCommand(`vscode-git.changes.${name}`, async () => {
          try {
            await action();
          } catch (error) {
            await vscode.window.showErrorMessage(`VS Code Git: ${error.message}`);
          }
        }),
      );
    this.updateContexts();
    if (iconThemes)
      context.subscriptions.push(
        iconThemes.subscribe(
          () => void this.view?.webview.postMessage({ type: 'fileIconsChanged' }),
        ),
      );
  }
  async updateContexts() {
    const values = {
      tree: this.tree,
      hasFolders: Boolean(this.hasFolders),
      expanded: Boolean(this.expanded),
      hasComparison: Boolean(this.comparison),
      refreshing: Boolean(this.refreshing),
    };
    await Promise.all(
      Object.entries(values)
        .filter(([key, value]) => this.contexts.get(key) !== value)
        .map(([key, value]) => {
          this.contexts.set(key, value);
          return this.vscode.commands.executeCommand(
            'setContext',
            `vscode-git.changes.${key}`,
            value,
          );
        }),
    );
  }
  async show(root: string, load: () => Promise<ChangesContent>) {
    const request = ++this.request;
    this.refreshing = false;
    await this.updateContexts();
    let result: ChangesContent;
    try {
      result = await load();
    } catch (error) {
      if (request === this.request) throw error;
      return;
    }
    if (request !== this.request) return;
    this.loadComparison = load;
    this.comparison = { ...result, root, id: crypto.randomUUID() };
    this.hasFolders = false;
    this.expanded = false;
    await this.updateContexts();
    await this.publish();
    await this.vscode.commands.executeCommand('vscode-git.changes.focus');
  }
  async refresh() {
    if (!this.comparison || !this.loadComparison || this.refreshing) return;
    const previous = this.comparison,
      load = this.loadComparison,
      request = ++this.request;
    this.refreshing = true;
    try {
      await this.updateContexts();
      const result = await load();
      if (request !== this.request) return;
      this.comparison = { ...result, root: previous.root, id: crypto.randomUUID() };
      await this.publish(previous.id);
    } catch (error) {
      if (request === this.request) throw error;
    } finally {
      if (request === this.request) {
        this.refreshing = false;
        await this.updateContexts();
      }
    }
  }
  async reset() {
    ++this.request;
    this.comparison = undefined;
    this.loadComparison = undefined;
    this.hasFolders = false;
    this.expanded = false;
    this.refreshing = false;
    await Promise.all([this.publish(), this.updateContexts()]);
  }
  async publish(previousId?: string) {
    if (!this.view) return;
    const comparison = this.comparison;
    this.view.description =
      comparison?.kind === 'selection'
        ? `${comparison.files.length} file${comparison.files.length === 1 ? '' : 's'}`
        : comparison?.pair.map((p) => p.name).join(' ↔ ');
    if (this.ready) {
      const { root, ...data } = this.comparison || ({} as Partial<ComparisonSnapshot>);
      await this.view.webview.postMessage({
        type: comparison?.kind === 'selection' ? 'selectionChanges' : 'branchChanges',
        ...data,
        repository: root,
        ...(previousId ? { previousId } : {}),
      });
    }
  }
  resolveWebviewView(view: VSCode.WebviewView) {
    this.view = view;
    this.ready = false;
    const { vscode, context } = this,
      media = vscode.Uri.joinPath(context.extensionUri, 'out', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(16).toString('hex');
    const resource = (file) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, file));
    view.webview.onDidReceiveMessage(
      async (message) => {
        if (this.view !== view) return;
        try {
          if (
            await this.iconThemes?.handle(
              message,
              (data) => view.webview.postMessage(data),
              this.comparison?.root,
            )
          )
            return;
          if (message.type === 'openGitLog')
            await this.vscode.commands.executeCommand('vscode-git.open');
          if (message.type === 'ready') {
            this.ready = true;
            await this.publish();
          }
          if (message.type === 'comparisonState') {
            if (message.id !== this.comparison?.id) return;
            if (typeof message.tree === 'boolean') this.tree = message.tree;
            if (message.id === this.comparison?.id) {
              this.hasFolders = Boolean(message.hasFolders);
              this.expanded = Boolean(message.expanded);
            }
            await this.updateContexts();
          }
          if (message.type === 'branchChangesFile') await this.openFile(message);
        } catch (error) {
          await vscode.window.showErrorMessage(`VS Code Git: ${error.message}`);
        }
      },
      null,
      context.subscriptions,
    );
    view.onDidDispose(
      () => {
        if (this.view === view) {
          this.view = undefined;
          this.ready = false;
        }
      },
      null,
      context.subscriptions,
    );
    view.webview.html = [
      `<!DOCTYPE html>`,
      `<html>`,
      `<head>`,
      `<meta charset="UTF-8">`,
      `<meta name="viewport" content="width=device-width,initial-scale=1">`,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; font-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">${['main.css', 'icons.css', 'compact.css', 'branch-changes.css'].map((file) => `<link rel="stylesheet" href="${resource(file)}">`).join('')}<style nonce="${nonce}" id="layout-style">`,
      `</style>`,
      `</head>`,
      `<body class="changes-sidebar">`,
      `<section id="changes" class="branch-changes" aria-label="File Diffs">`,
      `</section>`,
      `<script nonce="${nonce}" src="${resource('branch-changes.js')}">`,
      `</script>`,
      `</body>`,
      `</html>`,
    ].join('');
    this.publish();
  }
  async openFile(message: { id: string; index: number; workingFile?: boolean }) {
    // Ignore delayed clicks from a previous comparison, including identical indices.
    const data = this.comparison;
    if (!data || message.id !== data.id || !Number.isInteger(message.index)) return;
    const change = data.files.find((file) => file.index === message.index);
    if (!change) return;
    if (message.workingFile === true) {
      await openWorkingFile(this.vscode, data.root, change, this.snapshots);
      return;
    }
    if (change.mergeParents?.length === 2) {
      await openMergeDiff(this.vscode, this.context, this.snapshots, data.root, change);
      return;
    }
    const contents = await Promise.all(
      [change.before, change.after].map((side) =>
        side && !side.workingTree ? git(data.root, ['show', `${side.hash}:${side.path}`]) : '',
      ),
    );
    if (this.comparison !== data) return;
    const make = (text: string, label: 'before' | 'after', revision: Revision | null) => {
      const uri = this.vscode.Uri.from({
        scheme: 'vscode-git',
        path: '/' + (data.kind === 'selection' ? revision?.path || change.path : change.path),
        query: crypto.randomUUID() + label,
      });
      this.snapshots.set(uri.toString(), text);
      return uri;
    };
    const title =
      data.kind === 'selection'
        ? selectedFileTitle(change.path, change.before, change.after)
        : `${change.path} (${data.pair[0].name} ↔ ${data.pair[1].name})`;
    await this.vscode.commands.executeCommand(
      'vscode.diff',
      make(contents[0], 'before', change.before),
      change.after?.workingTree
        ? this.vscode.Uri.file(require('node:path').join(data.root, change.after.path))
        : make(contents[1], 'after', change.after),
      title,
    );
  }
}

function selectedFileTitle(path: string, before: Revision | null, after: Revision | null) {
  const name =
    before && after && before.path !== after.path ? `${before.path} → ${after.path}` : path;
  const revision = (side: Revision | null) =>
    !side ? 'Absent' : side.workingTree ? 'Working Tree' : side.hash?.slice(0, 8) || 'Empty';
  return `${name} (${revision(before)} ↔ ${revision(after)})`;
}
export { ChangesView };
