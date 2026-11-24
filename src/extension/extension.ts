import { readStashes } from './git/stashes';
import { openWorkingFile } from './views/open-working-file';
import { switchRepositories } from './commands/switch-repositories';
import { repositoryHostDocument, comparisonHostDocument } from './views/host-documents';
import { createRepositoryFavorites } from './repositories/favorites';
import { workspaceRepositories, repositoryLabels } from './repositories/discovery';
import { registerCommitFileDiffs } from './commands/commit-file-diffs';
import { registerComparisonPanelToggle } from './commands/panel-toggle';
import { openFileHistory } from './commands/file-history';
import { FileHistoryView } from './views/file-history';
import { registerHistoryDiffFiles } from './views/native-file-diff';
import { ChangesView } from './views/changes-view';
import { openMergeDiff, registerHistoricalMergeEditor } from './views/merge-diff';
import { createRepositoryRecents } from './repositories/recents';
import { createRepositoryEvents } from './repositories/events';
import { createIconThemeService } from './icons/service';
import { logDocument } from './views/log-document';
import { bundlePane } from './views/bundle-pane';
import * as vscode from 'vscode';
import { performance } from 'node:perf_hooks';
const crypto = require('node:crypto');
const path = require('node:path');
import { revisionNumbers, createRef, createPatch } from './git/commit-actions';
import { cherryPickPending } from './git/cherry-pick';
import { runCherryPick } from './commands/cherry-pick';
import { pickLogDestination } from './commands/go-to';
import { runBranchTool } from './commands/branch-tools';
import {
  historyLoading,
  historyRequestLimit,
  loadHistoryPage,
  firstBlockLimit,
} from './git/history-page';
import { createHistoryCache } from './git/history-cache';
import { createHistoryIndexStore } from './git/history-index-store';
import { createPathIndexStore } from './git/path-index-store';
import { createSelectionReader, readSelectionStats } from './git/selection-reader';
import {
  git,
  refs,
  details,
  patch,
  selectionDetails,
  selectionPatch,
  selectionChange,
  projectGraph,
  branchAction,
  branchHead,
  headLabel,
  validHash,
  readAuthors,
  pathChildren,
  branchComparison,
  branchFiles,
  commitComparison,
  commitFiles,
  commitLocalFiles,
  branchBatchAction,
  selectedBranches,
} from './git/index';
function activate(context: vscode.ExtensionContext) {
  const comparisonPanelToggle = registerComparisonPanelToggle(vscode, context);
  const notifyError = (error: Error) => {
    // Notifications resolve when dismissed; never keep controls busy while waiting.
    void vscode.window.showErrorMessage(`Enhanced Git: ${error.message}`);
  };
  const historyIndexes = createHistoryIndexStore(context.globalStorageUri?.fsPath, (message) =>
    timingOutput.appendLine(message),
  );
  const snapshots = new Map();
  registerHistoricalMergeEditor(vscode, context, snapshots);
  const gitWriteLocks = new Set<string>();
  const iconThemes = createIconThemeService(vscode, context);
  const timingOutput = vscode.window.createOutputChannel('Enhanced Git Performance');
  const pathIndexes = createPathIndexStore(context.globalStorageUri?.fsPath, (message) =>
    timingOutput.appendLine(message),
  );
  context.subscriptions.push(timingOutput);
  const repositoryEvents = createRepositoryEvents(vscode, (message) =>
    timingOutput.appendLine(message),
  );
  context.subscriptions.push(repositoryEvents);
  const now = () => performance.now();
  const recents = createRepositoryRecents(context.workspaceState);
  const repositoryFavorites = createRepositoryFavorites(context.workspaceState);

  const discoverRepositories = () => workspaceRepositories(vscode, repositoryEvents, git);
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-enhanced-git.switchRepositoriesBranch', () =>
      switchRepositories(vscode, discoverRepositories, gitWriteLocks).catch(notifyError),
    ),
  );
  const recentGroups = (root) => recents.get(root);
  const snapshotProvider = {
    provideTextDocumentContent: (uri: vscode.Uri) => snapshots.get(uri.toString()) || '',
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('vscode-enhanced-git', snapshotProvider),
    vscode.workspace.registerTextDocumentContentProvider(
      'vscode-enhanced-git-history',
      snapshotProvider,
    ),
  );

  let pendingBottomLocate: { root: string; target: string } | undefined;
  let bottomLogLocator: (() => Promise<void>) | undefined;
  async function locateInBottomLog(root: string, target: string) {
    pendingBottomLocate = { root, target };
    await vscode.commands.executeCommand('vscode-enhanced-git.log.focus');
    await bottomLogLocator?.();
  }
  const changesView = new ChangesView(vscode, context, snapshots, iconThemes);
  registerCommitFileDiffs(
    vscode,
    context,
    (root, load) => changesView.show(root, load),
    (message) => timingOutput.appendLine(message),
    locateInBottomLog,
  );
  // Keep the comparison DOM (folder expansion, selection and scroll) when the
  // sidebar or its section is hidden, just as we retain the bottom Git Log.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vscode-enhanced-git.changes', changesView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  const fileHistoryView = new FileHistoryView(
    vscode,
    context,
    registerHistoryDiffFiles(vscode, context),
  );
  context.subscriptions.push(
    fileHistoryView,
    vscode.window.registerWebviewViewProvider('vscode-enhanced-git.fileHistory', fileHistoryView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-enhanced-git.showFileHistory', (uri?: vscode.Uri) =>
      openFileHistory(
        vscode,
        (root, revision, file) => fileHistoryView.show(root, revision, file, { snapshots }),
        uri,
      ).catch(notifyError),
    ),
  );
  // A retained view lives alongside Terminal. Focusing it must never replace
  // its HTML or request history again; the webview owns the live UI state.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'vscode-enhanced-git.log',
      {
        resolveWebviewView(view) {
          view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
          };
          attachRepositoryHost(view);
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-enhanced-git.open', (newTab = false) =>
      newTab === true
        ? openRepositoryLog()
        : vscode.commands.executeCommand('vscode-enhanced-git.log.focus'),
    ),
  );
  async function openRepositoryLog() {
    const repositories = repositoryLabels(await discoverRepositories());
    if (!repositories.length) {
      await vscode.window.showInformationMessage(
        'Open a folder containing a Git repository first.',
      );
      return;
    }
    const choice = await vscode.window.showQuickPick(
      repositories.map((repo) => ({ label: repo.name, description: repo.root, root: repo.root })),
      { placeHolder: 'Select a repository for the new Git Log', matchOnDescription: true },
    );
    if (choice) createLogPanel(undefined, choice.root);
  }
  function watchLogVisibility(view) {
    const notify = () =>
      void view.webview.postMessage({ type: 'hostVisibility', visible: view.visible });
    const subscription =
      view.onDidChangeVisibility?.(notify) || view.onDidChangeViewState?.(notify);
    if (subscription) view.onDidDispose(() => subscription.dispose(), null, context.subscriptions);
  }
  function attachRepositoryHost(view) {
    watchLogVisibility(view);
    const nonce = crypto.randomBytes(16).toString('hex'),
      documents = new Map();
    let roots: string[] = [],
      ready = false,
      disposed = false,
      generation = 0;
    const publish = async () => {
      if (!ready || disposed) return;
      const request = ++generation;
      try {
        const result = await discoverRepositories();
        if (pendingBottomLocate && !result.includes(pendingBottomLocate.root))
          result.push(pendingBottomLocate.root);
        if (disposed || request !== generation) return;
        roots = result;
        await view.webview.postMessage({
          type: 'repositories',
          repositories: repositoryLabels(roots),
        });
        if (pendingBottomLocate) {
          const target = pendingBottomLocate;
          await view.webview.postMessage({ type: 'locateCommit', ...target });
          if (pendingBottomLocate === target) pendingBottomLocate = undefined;
        }
      } catch (error) {
        if (!disposed) {
          notifyError(error);
          await view.webview.postMessage({ type: 'repositoryHostError', message: error.message });
        }
      }
    };
    bottomLogLocator = publish;
    const subscriptions = [repositoryEvents.subscribeRoots(() => void publish())];
    if (vscode.workspace.onDidChangeWorkspaceFolders)
      subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void publish()));
    subscriptions.push(
      view.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'repositoryHostReady') {
          ready = true;
          await publish();
        }
        if (message.type === 'openRepository') {
          if (!roots.includes(message.root)) return;
          try {
            if (!documents.has(message.root))
              documents.set(
                message.root,
                attachLog(view, { nonce, root: message.root, pane: message.root, embedded: true }),
              );
            await view.webview.postMessage({
              type: 'repositoryDocument',
              root: message.root,
              name: path.basename(message.root),
              html: documents.get(message.root),
            });
          } catch (error) {
            notifyError(error);
            await view.webview.postMessage({
              type: 'repositoryHostError',
              root: message.root,
              message: error.message,
            });
          }
        }
      }),
    );
    view.onDidDispose(
      () => {
        disposed = true;
        if (bottomLogLocator === publish) bottomLogLocator = undefined;
        subscriptions.forEach((item) => item.dispose());
      },
      null,
      context.subscriptions,
    );
    view.webview.html = repositoryHostDocument(vscode, context, view, nonce);
  }
  function createLogPanel(comparison, repositoryRoot?) {
    const view = vscode.window.createWebviewPanel(
      'vscode-enhanced-git',
      'Git Log',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
      },
    );
    watchLogVisibility(view);
    const nonce = crypto.randomBytes(16).toString('hex');
    if (comparison) {
      comparisonPanelToggle.track(view);
      view.title = `Commit History Comparison: ${comparison.pair[0].name} ↔ ${comparison.pair[1].name}`;
      const panes = [
        { start: comparison.pair[1], end: comparison.pair[0] },
        { start: comparison.pair[0], end: comparison.pair[1] },
      ];
      const documents = panes.map((pair, pane) =>
        attachLog(view, { nonce, root: comparison.root, pane, comparison: pair }),
      );
      view.webview.html = comparisonHostDocument(vscode, context, view, nonce, documents);
    } else {
      view.title = `Git Log — ${path.basename(repositoryRoot)}`;
      view.webview.html = attachLog(view, { nonce, root: repositoryRoot });
    }
  }
  function attachLog(view, options) {
    let root = options.root;
    let commits: import('../shared/model').Commit[] = [];
    let displayedHistory: { root: string; query: string; version: number } | undefined;
    let sequence = 0;
    let busy = false;
    let selectionVersion = 0;
    const historyCache = createHistoryCache(historyIndexes.load, pathIndexes);
    let initializedHistoryRoot: string;
    const readSelection = createSelectionReader((root, hashes) =>
      selectionDetails(root, hashes, { includeStats: false }),
    );
    const readStats = createSelectionReader(async (root, hashes) =>
      readSelectionStats(root, (await readSelection(root, hashes)).items),
    );
    const nonce = options.nonce;
    const post = async (message) => {
      if (root && Array.isArray(message.branches))
        message = { ...message, headLabel: await headLabel(root, message.branches) };
      return view.webview.postMessage(
        options.pane === undefined ? message : { ...message, pane: options.pane },
      );
    };
    let branchRequest = 0;
    const repositoryListener = repositoryEvents.subscribe((event) => {
      if (!repositoryEvents.matches(root, event.root)) return;
      const currentRoot = root,
        request = ++branchRequest;
      void post({ type: 'repositoryChanged', ...event, root });
      // Badges must refresh even while history refresh is deferred (scrolled/hidden).
      void refs(currentRoot)
        .then((branches) => {
          if (
            request === branchRequest &&
            currentRoot === root &&
            repositoryEvents.version(currentRoot) === event.version
          )
            return post({
              type: 'branches',
              root: currentRoot,
              repositoryVersion: event.version,
              branches,
            });
        })
        .catch((error) => timingOutput.appendLine(`Branch refresh failed: ${error.message}`));
    });
    view.onDidDispose(
      () => {
        branchRequest++;
        historyCache.clear();
        repositoryListener.dispose();
      },
      null,
      context.subscriptions,
    );
    const iconListener = iconThemes.subscribe(() => void post({ type: 'fileIconsChanged' }));
    view.onDidDispose(() => iconListener.dispose(), null, context.subscriptions);
    const recentListener = recents.subscribe((changedRoot, groups) => {
      if (repositoryEvents.matches(root, changedRoot))
        void post({ type: 'filterRecents', recents: groups });
    });
    view.onDidDispose(() => recentListener.dispose(), null, context.subscriptions);
    const favoriteListener = repositoryFavorites.subscribe((changedRoot, snapshot) => {
      if (repositoryEvents.matches(root, changedRoot))
        void post({ type: 'favorites', root, ...snapshot });
    });
    view.onDidDispose(() => favoriteListener.dispose(), null, context.subscriptions);
    const html = logDocument(vscode, context, view, options, root);
    view.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.pane !== options.pane) return;
        const started = now(),
          timings: Record<string, number> = {};
        const measure = async (name, task) => {
          const start = now();
          try {
            return await task();
          } finally {
            timings[name] = Math.round(now() - start);
          }
        };
        try {
          if (await iconThemes.handle(msg, post, root)) return;
          if (msg.type === 'renderTiming') {
            const values = Object.fromEntries(
              Object.entries(msg.values || {}).filter(
                ([key, value]) =>
                  /^[a-zA-Z]+Ms$/.test(key) &&
                  Number.isFinite(value) &&
                  typeof value === 'number' &&
                  value >= 0,
              ),
            );
            timingOutput.appendLine(
              JSON.stringify({ phase: 'webview', requestId: msg.requestId, ...values }),
            );
            return;
          }
          if (msg.type === 'layoutState') {
            const layout = msg.layout;
            if (
              !options.comparison &&
              layout &&
              ['left', 'right'].every(
                (key) => Number.isFinite(layout[key]) && layout[key] >= 0 && layout[key] <= 1,
              ) &&
              typeof layout.branchesCollapsed === 'boolean' &&
              (layout.detailRatio === undefined ||
                (Number.isFinite(layout.detailRatio) &&
                  layout.detailRatio >= 0 &&
                  layout.detailRatio <= 1))
            )
              await context.workspaceState.update(`vscode-enhanced-git.layout:${root}`, {
                left: layout.left,
                right: layout.right,
                branchesCollapsed: layout.branchesCollapsed,
                detailsCollapsed: layout.detailsCollapsed === true,
                ...(layout.detailRatio === undefined ? {} : { detailRatio: layout.detailRatio }),
              });
            return;
          }
          if (msg.type === 'newTab') {
            await openRepositoryLog();
            return;
          }
          if (msg.type === 'goTo' && root) {
            const targetRoot = root;
            const target = await pickLogDestination(vscode, targetRoot);
            if (target && targetRoot === root)
              await post({ type: 'goTo', target, requestId: msg.requestId });
            return;
          }
          if (msg.type === 'init') {
            const roots = options.root ? [options.root] : await discoverRepositories();
            if (!roots.length) throw new Error('Open a folder containing a Git repository first.');
            root = roots[0];
            await post({ type: 'repos', roots });
            await post({ type: 'filterRecents', recents: recentGroups(root) });
          }
          if (msg.type === 'repo') {
            // Each repository log owns its root for its entire lifetime.
            if (options.root) return;
            const allowed = await discoverRepositories();
            if (!allowed.includes(msg.root)) throw new Error('Unknown repository');
            root = msg.root;
          }
          if (msg.type === 'openCommitLink' && typeof msg.url === 'string') {
            const uri = vscode.Uri.parse(msg.url);
            if (['https', 'http', 'mailto'].includes(uri.scheme))
              await vscode.env.openExternal(uri);
            return;
          }
          if (msg.type === 'copyReference' && typeof msg.text === 'string') {
            await vscode.env.clipboard.writeText(msg.text);
            return;
          }
          if (msg.type === 'pathChildren' && root) {
            try {
              await post({
                type: 'pathChildren',
                request: msg.request,
                items: await pathChildren(root, msg.path),
              });
            } catch (error) {
              await post({ type: 'pathChildren', request: msg.request, error: error.message });
            }
            return;
          }
          if (
            msg.type === 'filterRecent' &&
            root &&
            ['branch', 'user', 'paths'].includes(msg.kind)
          ) {
            if (
              !Array.isArray(msg.values) ||
              msg.values.some((v) => typeof v !== 'string' || v.includes('\0'))
            )
              throw Error('Invalid recent filter');
            const values =
              msg.kind === 'paths'
                ? msg.values.map((value) => path.resolve(root, value))
                : msg.values;
            await recents.update(
              root,
              msg.kind,
              values,
              msg.clear === true ? 'clear' : msg.remove === true ? 'forget' : 'remember',
            );
            return;
          }
          if (msg.type === 'branchCompareCurrent' && root) {
            const targetRoot = root;
            const selected = await selectedBranches(targetRoot, msg.refs);
            const targets = selected.filter((branch) => !branch.current);
            if (!targets.length) throw Error('Select a non-current branch');
            const pairs = await Promise.all(
              targets.map((branch) => branchComparison(targetRoot, ['HEAD', branch.ref])),
            );
            for (const pair of pairs) createLogPanel({ root: targetRoot, pair });
            return;
          }
          if (msg.type === 'branchTool' && root) {
            const targetRoot = root;
            if (busy || gitWriteLocks.has(targetRoot))
              throw Error('A Git operation is already running');
            busy = true;
            gitWriteLocks.add(targetRoot);
            try {
              const result = await runBranchTool(vscode, targetRoot, msg.action, msg.ref);
              if (result && root === targetRoot) await post({ type: 'operation', ...result });
            } finally {
              busy = false;
              gitWriteLocks.delete(targetRoot);
              repositoryEvents.invalidate(targetRoot);
            }
            return;
          }
          if (['branchCompare', 'commitCompare'].includes(msg.type) && root) {
            const pair = await (msg.type === 'commitCompare'
              ? commitComparison(root, msg.hashes)
              : branchComparison(root, msg.refs));
            createLogPanel({ root, pair });
            return;
          }
          if (msg.type === 'commitAction' && msg.action === 'cherry-pick' && root) {
            const targetRoot = root;
            let locked = false,
              refresh = false;
            try {
              if (busy || gitWriteLocks.has(targetRoot))
                throw Error('A Git operation is already running');
              busy = true;
              gitWriteLocks.add(targetRoot);
              locked = true;
              const pending = await cherryPickPending(targetRoot);
              if (
                !pending &&
                (!Array.isArray(msg.hashes) ||
                  !msg.hashes.length ||
                  msg.hashes.some((hash) => !commits.some((c) => c.hash === hash)))
              )
                throw Error('Select commits from the current log');
              const chosen = new Set(msg.hashes || []);
              const hashes = commits.filter((c) => chosen.has(c.hash)).map((c) => c.hash);
              // A failed sequence can still have applied earlier commits.
              refresh = true;
              await runCherryPick(vscode, targetRoot, hashes);
            } finally {
              if (locked) {
                busy = false;
                gitWriteLocks.delete(targetRoot);
                if (refresh) repositoryEvents.invalidate(targetRoot);
              }
              if (root === targetRoot)
                await post({
                  type: 'cherryPickFinished',
                  pending: await cherryPickPending(targetRoot),
                  refresh,
                });
            }
            return;
          }
          if (msg.type === 'commitAction' && root) {
            if (
              !Array.isArray(msg.hashes) ||
              !msg.hashes.length ||
              msg.hashes.some((hash) => !commits.some((c) => c.hash === hash))
            )
              throw Error('Select commits from the current log');
            const chosen = new Set(msg.hashes),
              hashes = commits.filter((c) => chosen.has(c.hash)).map((c) => c.hash),
              targetRoot = root;
            if (msg.action === 'copy') {
              await vscode.env.clipboard.writeText(revisionNumbers(hashes));
              return;
            }
            if (msg.action === 'patch') {
              const content = await createPatch(targetRoot, hashes);
              const destination = await vscode.window.showSaveDialog({
                title: 'Create Patch',
                defaultUri: vscode.Uri.file(path.join(targetRoot, 'changes.patch')),
                filters: { Patch: ['patch', 'diff'] },
              });
              if (destination) {
                await vscode.workspace.fs.writeFile(destination, content);
                await vscode.window.showInformationMessage('Patch created');
              }
              return;
            }
            if (!['branch', 'tag'].includes(msg.action) || hashes.length !== 1)
              throw Error('Select one commit');
            if (vscode.workspace.isTrusted === false)
              throw Error('Trust this workspace before creating references');
            if (busy || gitWriteLocks.has(targetRoot))
              throw Error('A Git operation is already running');
            busy = true;
            gitWriteLocks.add(targetRoot);
            try {
              await createRef(targetRoot, hashes[0], msg.action, {
                name: msg.name,
                checkout: msg.checkout === true,
              });
            } finally {
              busy = false;
              gitWriteLocks.delete(targetRoot);
              repositoryEvents.invalidate(targetRoot);
            }
            if (root === targetRoot)
              await post({ type: 'commitActionDone', dialogId: msg.dialogId });
            return;
          }
          if (msg.type === 'commitLocal' && root) {
            if (!commits.some((commit) => commit.hash === msg.hash))
              throw Error('Select a commit from the current log');
            const currentRoot = root;
            await changesView.show(currentRoot, () => commitLocalFiles(currentRoot, msg.hash));
            return;
          }
          if (msg.type === 'commitChanges' && root) {
            if (!commits.some((commit) => commit.hash === msg.hash))
              throw Error('Select a commit from the current log');
            const currentRoot = root,
              hash = msg.hash;
            await changesView.show(currentRoot, async () => {
              // Reuse the details reader so root/merge/rename semantics match
              // the third pane, rather than substituting a first-parent diff.
              const { items, files } = await readSelection(currentRoot, [hash]);
              const parent = items[0].parents[0];
              return {
                pair: [
                  {
                    hash: parent,
                    name: parent ? parent.slice(0, 8) : 'Empty Tree',
                    kind: 'commit',
                  },
                  { hash, name: hash.slice(0, 8), kind: 'commit' },
                ],
                files,
              };
            });
            return;
          }
          if (msg.type === 'selectionChanges' && root) {
            const available = new Set(commits.map((commit) => commit.hash));
            if (
              !Array.isArray(msg.hashes) ||
              !msg.hashes.length ||
              msg.hashes.some((hash) => !available.has(hash))
            )
              throw Error('Select commits from the current log');
            const currentRoot = root,
              selected = new Set(msg.hashes),
              chosen = commits
                .filter((commit) => selected.has(commit.hash))
                .map(({ hash, subject }) => ({ hash, subject })),
              hashes = chosen.map((commit) => commit.hash);
            // Preserve the third pane's ordered selection and per-file revisions.
            // Comparing only the first/last commit would include unselected files.
            await changesView.show(currentRoot, async () => ({
              kind: 'selection',
              commits: chosen,
              files: (await readSelection(currentRoot, hashes)).files,
            }));
            return;
          }
          if (['branchFiles', 'commitFiles'].includes(msg.type) && root) {
            const currentRoot = root;
            await changesView.show(currentRoot, () =>
              msg.type === 'commitFiles'
                ? commitFiles(currentRoot, msg.hashes)
                : branchFiles(currentRoot, msg.refs),
            );
            return;
          }
          if (msg.type === 'branchBatchAction' && root) {
            if (busy) throw Error('A Git operation is already running');
            if (!['update', 'delete'].includes(msg.action)) throw Error('Unsupported batch action');
            const targetRoot = root,
              chosen = await selectedBranches(root, msg.refs);
            if (gitWriteLocks.has(targetRoot)) throw Error('A Git operation is already running');
            const label = msg.action === 'delete' ? 'Delete Branches' : 'Update Selected';
            const explanation =
              msg.action === 'delete'
                ? 'Local branches must be merged into HEAD. Remote branches will be deleted from their server.'
                : 'Fetch upstream and fast-forward each selected tracking branch. Divergent branches will be rejected.';
            busy = true;
            gitWriteLocks.add(targetRoot);
            try {
              const accepted = await vscode.window.showWarningMessage(
                `${label}\n${chosen.map((b) => b.name).join('\n')}\n\n${explanation}`,
                { modal: true },
                msg.action === 'delete' ? 'Delete' : 'Update',
              );
              if (!accepted) return;
              try {
                await vscode.window.withProgress(
                  {
                    location: vscode.ProgressLocation.Notification,
                    title: `Enhanced Git: ${label}`,
                  },
                  () => branchBatchAction(targetRoot, msg.refs, msg.action),
                );
              } finally {
                // A later branch can fail after earlier branches or a fetch succeeded.
                repositoryEvents.invalidate(targetRoot);
              }
            } finally {
              busy = false;
              gitWriteLocks.delete(targetRoot);
            }
            if (targetRoot !== root) return;
            await post({
              type: 'operation',
              action: msg.action,
              message: `${label}: ${chosen.map((b) => b.name).join(', ')}`,
            });
            return;
          }
          if (
            [
              'init',
              'repo',
              'load',
              'graphJump',
              'branchJump',
              'revisionJump',
              'branchAction',
            ].includes(msg.type)
          ) {
            if (msg.type === 'branchAction') {
              if (busy || gitWriteLocks.has(root))
                throw new Error('A Git operation is already running');
              const targetRoot = root;
              const branch = (await refs(targetRoot)).find((b) => b.ref === msg.ref);
              if (!branch) throw new Error('Branch no longer exists');
              const options: import('../shared/model').BranchActionOptions = {};
              if (
                msg.action === 'rename' ||
                (msg.action === 'checkout' && branch.group === 'Remote')
              ) {
                options.name = await vscode.window.showInputBox({
                  title: msg.action === 'rename' ? 'Rename branch' : 'Create tracking branch',
                  value:
                    msg.action === 'rename' ? branch.name : branch.name.replace(/^[^/]+\//, ''),
                  validateInput: async (name) => {
                    try {
                      await git(targetRoot, ['check-ref-format', '--branch', name]);
                      return undefined;
                    } catch {
                      return 'Enter a valid Git branch name';
                    }
                  },
                });
                if (!options.name) return;
              }
              if (msg.action === 'push' && !branch.upstream) {
                options.remote = await vscode.window.showQuickPick(
                  (await git(targetRoot, ['remote'])).trim().split('\n').filter(Boolean),
                  { title: 'Push branch to remote' },
                );
                if (!options.remote) return;
              }
              if (['delete', 'push', 'update'].includes(msg.action)) {
                const explanation =
                  msg.action === 'update'
                    ? 'Fetch upstream and fast-forward only; divergent branches will be rejected.'
                    : msg.action === 'delete'
                      ? branch.group === 'Remote'
                        ? 'Delete the branch from the remote server.'
                        : branch.group === 'Tags'
                          ? 'Delete this local tag.'
                          : 'Delete this local branch only if it is merged into HEAD.'
                      : 'Publish commits to the configured remote; no force push.';
                const accepted = await vscode.window.showWarningMessage(
                  `${msg.action}: ${branch.name}\n${explanation}`,
                  { modal: true },
                  'Continue',
                );
                if (accepted !== 'Continue') return;
              }
              if (gitWriteLocks.has(targetRoot)) throw Error('A Git operation is already running');
              busy = true;
              gitWriteLocks.add(targetRoot);
              try {
                await vscode.window.withProgress(
                  {
                    location: vscode.ProgressLocation.Notification,
                    title: `Enhanced Git: ${msg.action} ${branch.name}`,
                  },
                  () => branchAction(targetRoot, msg.ref, msg.action, options),
                );
              } finally {
                busy = false;
                gitWriteLocks.delete(targetRoot);
                repositoryEvents.invalidate(targetRoot);
              }
              if (targetRoot !== root) return;
              await post({
                type: 'operation',
                action: msg.action,
                message: `${msg.action}: ${branch.name}`,
              });
              return;
            }
            if (options.comparison)
              msg.ref = `${options.comparison.start.ref}..${options.comparison.end.ref}`;
            const request = ++sequence;
            const currentRoot = root;
            const repositoryVersion = repositoryEvents.version(currentRoot);
            const target =
              msg.type === 'branchJump'
                ? await branchHead(currentRoot, msg.branchRef)
                : ['graphJump', 'revisionJump'].includes(msg.type)
                  ? validHash(msg.target)
                  : undefined;
            if (request !== sequence || currentRoot !== root) return;
            if (
              msg.type === 'branchJump' &&
              displayedHistory &&
              displayedHistory.root === currentRoot &&
              displayedHistory.query === JSON.stringify([msg.ref || '', msg.filters || {}]) &&
              commits.some((commit) => commit.hash === target)
            ) {
              // The webview already owns this graph. Send only the destination,
              // preserving rows, selection details and cached Canvas geometry.
              await post({
                type: 'branchLocated',
                root: currentRoot,
                requestId: msg.requestId,
                target,
                // Locating a row does not apply pending repository changes.
                repositoryVersion: displayedHistory.version,
              });
              return;
            }
            if (!msg.append) selectionVersion++;
            if (
              msg.type === 'graphJump' &&
              target &&
              !commits.some((c) =>
                [
                  ...c.parents,
                  ...(c.graphParents || []),
                  ...(c.graphUnloadedParents || []),
                ].includes(target),
              )
            )
              throw Error('Unknown graph destination');
            const configuration = vscode.workspace.getConfiguration(
              'vscode-enhanced-git',
              vscode.Uri.file(currentRoot),
            );
            const settings = historyLoading(
              configuration.get('history.initialCount', 500),
              configuration.get('history.pageSize', 500),
            );
            const { initialCount, pageSize } = settings;
            const requestedLimit = historyRequestLimit(settings, msg, commits.length);
            const progressive =
              initializedHistoryRoot !== currentRoot && !target && !options.comparison;
            for (const firstBlock of progressive ? [true, false] : [false]) {
              if (request !== sequence) return;
              timings.beforeHistoryMs = Math.round(now() - started);
              // Preserve the small first frame; only full requests validate/reuse snapshots.
              const snapshot = firstBlock
                ? undefined
                : await measure('snapshotMs', () =>
                    historyCache.snapshot(currentRoot, repositoryVersion, Boolean(msg.refresh)),
                  );
              if (request !== sequence) return;
              let historyCacheHit = true;
              const readHistory = async () => {
                historyCacheHit = false;
                const loaded = await measure('historyMs', () =>
                  loadHistoryPage(
                    currentRoot,
                    msg.ref,
                    firstBlock ? firstBlockLimit(requestedLimit) : requestedLimit,
                    msg.filters || {},
                    target,
                    pageSize,
                    snapshot?.context,
                  ),
                );
                const activeFilter = Boolean(
                  (Array.isArray(loaded.ref) ? loaded.ref.length : loaded.ref) ||
                  Object.entries(loaded.filters).some(
                    ([key, v]) =>
                      !['sort', 'showSignature', 'highlightNotPicked'].includes(key) &&
                      (Array.isArray(v) ? v.length : v),
                  ),
                );
                const history = await measure('topologyMs', () =>
                  projectGraph(currentRoot, loaded.history, {
                    ...loaded.filters,
                    project: activeFilter,
                    hasMore: loaded.hasMore,
                    firstBlock,
                  }),
                );
                return { ...loaded, history };
              };
              // Relative dates and signature verification depend on time/keyring state,
              // not just refs. Always query them afresh; still reuse repository metadata.
              const cacheable =
                snapshot && !target && !msg.filters?.sinceHours && !msg.filters?.showSignature;
              const key = JSON.stringify([msg.ref || '', requestedLimit, msg.filters || {}]);
              const [
                branches,
                loaded,
                [userEmail, userName],
                headHistory,
                picking,
                remoteNames,
                stashes,
              ] = await Promise.all([
                measure(
                  'refsMs',
                  () => snapshot?.branches() ?? refs(currentRoot, { tracking: false }),
                ),
                cacheable ? snapshot.history(key, readHistory) : readHistory(),
                measure(
                  'userMs',
                  () =>
                    snapshot?.user() ??
                    Promise.all([
                      git(currentRoot, ['config', '--get', 'user.email']).catch(() => ''),
                      git(currentRoot, ['config', '--get', 'user.name']).catch(() => ''),
                    ]),
                ),
                measure('headMs', () => snapshot?.head() ?? Promise.resolve('')),
                cherryPickPending(currentRoot),
                snapshot?.remotes() ?? git(currentRoot, ['remote']),
                snapshot?.stashes() ?? readStashes(currentRoot).then((value) => value.list),
              ]);
              timings.historyCacheHit = historyCacheHit ? 1 : 0;
              const { history: displayCommits, historyLimit, hasMore } = loaded;
              if (target) {
                msg.ref = loaded.ref;
                msg.filters = loaded.filters;
              }
              if (request !== sequence) return;
              const user = userEmail.trim();
              let notPickedHashes: string[] | null = null;
              const selectedRefs = Array.isArray(msg.ref) ? msg.ref : msg.ref ? [msg.ref] : [];
              if (
                !firstBlock &&
                msg.filters?.highlightNotPicked &&
                selectedRefs.length === 1 &&
                selectedRefs[0] !== 'HEAD' &&
                branches.some((b) => b.ref === selectedRefs[0] && !b.current && b.group !== 'Tags')
              ) {
                const cherry = await git(currentRoot, ['cherry', 'HEAD', selectedRefs[0]]);
                notPickedHashes = cherry
                  .trim()
                  .split('\n')
                  .filter((line) => line.startsWith('+ '))
                  .map((line) => line.slice(2));
              }
              const visibleHashes = new Set(displayCommits.map((c) => c.hash));
              const headHashes = headHistory
                .trim()
                .split('\n')
                .filter((hash) => visibleHashes.has(hash));
              if (request !== sequence) return;
              commits = displayCommits;
              displayedHistory = {
                root: currentRoot,
                query: JSON.stringify([msg.ref || '', msg.filters || {}]),
                version: repositoryVersion,
              };
              timings.serverMs = Math.round(now() - started);
              timingOutput.appendLine(
                JSON.stringify({
                  phase: firstBlock ? 'historyFirstBlock' : 'history',
                  requestId: msg.requestId,
                  commits: commits.length,
                  ...timings,
                }),
              );
              await post({
                type: 'data',
                root: currentRoot,
                repositoryVersion,
                timings,
                requestId: msg.requestId,
                append: msg.append || (progressive && !firstBlock),
                loadingMore: firstBlock,
                hasMore,
                target,
                historyLimit,
                pageSize,
                initialCount,
                resetFilters: loaded.reset,
                ref: msg.ref,
                // Only omit a large branch list when the requesting view confirms
                // it has this exact snapshot (not merely when a prior post sent it).
                branchSnapshotKey: snapshot?.key,
                branches: snapshot && msg.branchSnapshotKey === snapshot.key ? undefined : branches,
                stashes,
                commits,
                user,
                userName: userName.trim(),
                remotes: remoteNames.trim().split('\n').filter(Boolean),
                notPickedHashes,
                ...repositoryFavorites.get(currentRoot),
                headHashes,
                cherryPickPending: picking,
                cherryPickBusy: gitWriteLocks.has(currentRoot),
                filtered: Boolean(
                  (Array.isArray(msg.ref) ? msg.ref.length : msg.ref) ||
                  Object.entries(msg.filters || {}).some(
                    ([key, v]) =>
                      !['sort', 'showSignature', 'highlightNotPicked'].includes(key) &&
                      (Array.isArray(v) ? v.length : v),
                  ),
                ),
              });
              // Prepare search/path indexes only after data is visible. Git remains
              // usable while this runs, and each view keeps its validated snapshot.
              if (snapshot) {
                initializedHistoryRoot = currentRoot;
                void snapshot.prepareIndex();
              }
            }
            // Filter suggestions scan all authors and paths; never gate first history on them.
            if (['init', 'repo'].includes(msg.type)) {
              const metadataStart = now();
              void Promise.all([readAuthors(currentRoot), git(currentRoot, ['ls-files', '-z'])])
                .then(async ([authors, pathsRaw]) => {
                  if (root === currentRoot)
                    await post({
                      type: 'filterOptions',
                      authors,
                      paths: pathsRaw.split('\0').filter(Boolean),
                      recents: recentGroups(currentRoot),
                    });
                  timingOutput.appendLine(
                    JSON.stringify({
                      phase: 'filterOptions',
                      durationMs: Math.round(now() - metadataStart),
                    }),
                  );
                })
                .catch((error) =>
                  timingOutput.appendLine('Filter options failed: ' + error.message),
                );
            }
          }
          if (msg.type === 'favorites' && root) {
            const targetRoot = root;
            try {
              await repositoryFavorites.update(targetRoot, msg.changes);
            } finally {
              await post({
                type: 'favorites',
                root: targetRoot,
                ...repositoryFavorites.get(targetRoot),
                favoriteAck: msg.favoriteRequest,
              });
            }
          }
          if (msg.type === 'select') {
            const hashes = Array.isArray(msg.hashes) ? [...new Set<string>(msg.hashes)] : [];
            if (hashes.some((hash) => !commits.some((c) => c.hash === hash))) return;
            const version = ++selectionVersion,
              currentRoot = root;
            const started = now();
            const result = await readSelection(currentRoot, hashes);
            timingOutput.appendLine(
              JSON.stringify({
                phase: 'selectionDetails',
                commits: hashes.length,
                files: result.files.length,
                durationMs: Math.round(now() - started),
              }),
            );
            if (version === selectionVersion) {
              await post({
                type: 'details',
                key: msg.key,
                files: result.files,
                parents: result.parents,
                items: result.items.map(({ hash, message, stats }) => ({ hash, message, stats })),
              });
              const statsStarted = now();
              const items = await readStats(currentRoot, hashes);
              if (version === selectionVersion)
                await post({ type: 'detailStats', key: msg.key, items });
              timingOutput.appendLine(
                JSON.stringify({
                  phase: 'selectionStats',
                  commits: hashes.length,
                  durationMs: Math.round(now() - statsStarted),
                }),
              );
            }
          }
          if (msg.type === 'selectionFileHistory') {
            const hashes = Array.isArray(msg.hashes) ? msg.hashes : [];
            if (!hashes.length || hashes.some((hash) => !commits.some((c) => c.hash === hash)))
              return;
            const currentRoot = root;
            const result = await readSelection(currentRoot, hashes);
            const change = selectionChange(result, msg.index);
            if (!change) throw new Error('Unknown selected change');
            if (root !== currentRoot) return;
            // Deleted files use the selected deleting commit when it is known.
            // Aggregated selections fall back to the immutable before revision.
            const target =
              change.after ||
              (change.before && {
                ...change.before,
                hash: hashes.length === 1 ? hashes[0] : change.before.hash,
              });
            if (target)
              await fileHistoryView.show(currentRoot, target.hash, target.path, {
                snapshots,
                showAffected: async (chosen) =>
                  changesView.show(currentRoot, async () => ({
                    kind: 'selection',
                    commits: chosen.map(({ hash, subject }) => ({ hash, subject })),
                    files: (
                      await selectionDetails(
                        currentRoot,
                        chosen.map((entry) => entry.hash),
                        { includeStats: false },
                      )
                    ).files,
                  })),
                selectInLog: async (entry) => {
                  if (root !== currentRoot)
                    throw Error(
                      'The source log is showing another repository. Reopen this repository’s log to locate the commit.',
                    );
                  if (view.show) view.show(false);
                  else view.reveal(view.viewColumn, false);
                  await post({ type: 'historyReveal', root: currentRoot, target: entry.hash });
                },
              });
          }
          if (msg.type === 'selectionFile') {
            const hashes = Array.isArray(msg.hashes) ? msg.hashes : [];
            if (!hashes.length || hashes.some((hash) => !commits.some((c) => c.hash === hash)))
              return;
            const currentRoot = root;
            const started = now();
            const result = await readSelection(currentRoot, hashes),
              change = selectionChange(result, msg.index);
            const selectionMs = now() - started;
            if (!change) throw new Error('Unknown selected change');
            if (msg.workingFile === true) {
              await openWorkingFile(vscode, currentRoot, change, snapshots);
            } else if (!msg.open)
              await post({
                type: 'preview',
                key: msg.key,
                text: await selectionPatch(currentRoot, change),
              });
            else if (change.mergeParents?.length === 2) {
              await openMergeDiff(vscode, context, snapshots, currentRoot, change);
            } else {
              const contents = await Promise.all([
                change.before
                  ? git(currentRoot, ['show', `${change.before.hash}:${change.before.path}`])
                  : '',
                change.after
                  ? git(currentRoot, ['show', `${change.after.hash}:${change.after.path}`])
                  : '',
              ]);
              const contentsMs = now() - started - selectionMs;
              const make = (text, revision) => {
                const uri = vscode.Uri.from({
                  scheme: 'vscode-enhanced-git',
                  path: '/' + (revision?.path || change.path),
                  query: new URLSearchParams({
                    revision: revision?.hash || 'empty',
                    snapshot: crypto.randomUUID(),
                  }).toString(),
                });
                snapshots.set(uri.toString(), text);
                return uri;
              };
              const revisionLabel = (revision) => (revision ? revision.hash.slice(0, 8) : 'Empty');
              const fileLabel =
                change.before && change.after && change.before.path !== change.after.path
                  ? `${change.before.path} → ${change.after.path}`
                  : change.path;
              await vscode.commands.executeCommand(
                'vscode.diff',
                make(contents[0], change.before),
                make(contents[1], change.after),
                `${fileLabel} · ${revisionLabel(change.before)} → ${revisionLabel(change.after)}`,
              );
              timingOutput.appendLine(
                JSON.stringify({
                  phase: 'nativeDiff',
                  commits: hashes.length,
                  selectionMs: Math.round(selectionMs),
                  contentsMs: Math.round(contentsMs),
                  commandMs: Math.round(now() - started - selectionMs - contentsMs),
                  durationMs: Math.round(now() - started),
                }),
              );
            }
          }
          if (msg.type === 'preview') {
            if (!commits.some((c) => c.hash === msg.hash)) return;
            await post({
              type: 'preview',
              key: msg.key,
              text: await patch(root, msg.hash, msg.path),
            });
          }
          if (msg.type === 'diff') {
            validHash(msg.hash);
            if (!commits.some((c) => c.hash === msg.hash)) return;
            const info = await details(root, msg.hash);
            const file = info.files.find((f) => f.path === msg.path);
            if (!file) throw new Error('Unknown changed file');
            const parents = (await git(root, ['show', '-s', '--format=%P', msg.hash, '--']))
              .trim()
              .split(' ')
              .filter(Boolean);
            const content = async (rev, absent) =>
              absent ? '' : git(root, ['show', `${rev}:${msg.path}`]);
            const [before, after] = await Promise.all([
              content(parents[0], !parents.length || file.status === 'A'),
              content(msg.hash, file.status === 'D'),
            ]);
            const make = (rev, text) => {
              const uri = vscode.Uri.from({
                scheme: 'vscode-enhanced-git',
                path: '/' + msg.path,
                query: crypto.randomUUID() + '-' + rev,
              });
              snapshots.set(uri.toString(), text);
              return uri;
            };
            await vscode.commands.executeCommand(
              'vscode.diff',
              make('parent', before),
              make(msg.hash, after),
              `${msg.path} · ${msg.hash.slice(0, 8)}`,
            );
          }
        } catch (error) {
          notifyError(error);
          await post(
            msg.type === 'commitAction' && msg.dialogId
              ? { type: 'commitRefError', dialogId: msg.dialogId, message: error.message }
              : { type: 'error', requestId: msg.requestId, message: error.message },
          );
        } finally {
          if (msg.toolbar === true && ['branchTool', 'branchBatchAction'].includes(msg.type))
            await post({ type: 'branchToolsFinished' });
        }
      },
      null,
      context.subscriptions,
    );
    if (!options.comparison && !options.embedded) return html;
    // Bundle a self-contained pane; the host mounts it in Shadow DOM, not an iframe.
    return bundlePane(html, path.join(context.extensionUri.fsPath, 'out/webview'), nonce);
  }
}
export { activate };
