import { flushSync } from 'react-dom';
import type { Branch, Commit, Author, RecentGroups } from '../../shared/model';
import type { BranchSnapshot } from '../state/branches';
import { emptyFilters } from '../state/log';
import { branchValueLabel } from '../../shared/filters';
import type { DetailMessage } from './files';
import type { LogContext } from './context';

export interface HistoryMessage extends BranchSnapshot {
  type: 'data';
  requestId?: number;
  root?: string;
  commits: Commit[];
  append?: boolean;
  target?: string;
  resetFilters?: boolean;
  ref?: string | string[];
  loadingMore?: boolean;
  hasMore?: boolean;
  pageSize?: number;
  historyLimit?: number;
  initialCount?: number;
  notPickedHashes?: string[];
  remotes?: string[];
  user?: string;
  userName?: string;
  headHashes?: string[];
  filtered?: boolean;
  cherryPickPending?: boolean;
  cherryPickBusy?: boolean;
  timings?: { serverMs?: number };
  repositoryVersion?: number;
}
export type LogMessage =
  | HistoryMessage
  | DetailMessage
  | ({ type: 'favorites'; root: string } & BranchSnapshot)
  | ({ type: 'branches' } & BranchSnapshot)
  | { type: 'vsCodeEnhancedGitVisibility' | 'hostVisibility'; visible: boolean }
  | { type: 'vsCodeEnhancedGitRefresh' }
  | { type: 'repositoryChanged'; root: string; version: number; [key: string]: unknown }
  | { type: 'repos'; roots: string[] }
  | { type: 'filterOptions'; recents?: RecentGroups; authors: Author[]; paths: string[] }
  | { type: 'filterRecents'; recents: RecentGroups }
  | { type: 'pathChildren'; request: number; error?: string; items?: unknown[] }
  | { type: 'branchToolsFinished' }
  | { type: 'operation'; action: string; message: string }
  | { type: 'historyReveal'; root: string; target: string }
  | { type: 'goTo'; requestId: number; target: string }
  | {
      type: 'branchLocated';
      root: string;
      requestId: number;
      target: string;
      repositoryVersion: number;
    }
  | { type: 'cherryPickFinished'; pending?: boolean; refresh?: boolean }
  | { type: 'commitActionDone' | 'commitRefError'; dialogId: string }
  | { type: 'error'; requestId?: number };

/** The only host-message router for a log. Effects live in domain controllers. */
export function receiveLogMessage(ctx: LogContext, data: LogMessage) {
  const { store, actions, env } = ctx;
  const state = store.getState;
  switch (data.type) {
    case 'vsCodeEnhancedGitVisibility':
    case 'hostVisibility':
      env.scope.vsCodeEnhancedGitVisible = data.visible;
      store.setState({ visible: data.visible });
      if (data.visible) actions.history.refreshCoordinator.check();
      else actions.hover.closeTransientUi();
      return;
    case 'vsCodeEnhancedGitRefresh':
      actions.history.load();
      return;
    case 'repositoryChanged':
      actions.history.refreshCoordinator.changed(data);
      return;
    case 'favorites':
      if (data.root === state().root) ctx.branchState.applyFavorites(data);
      return;
    case 'branches':
      ctx.branchState.applySnapshot(data);
      return;
    case 'repos':
      ctx.branchState.invalidateSnapshot();
      actions.history.refreshCoordinator.reset(data.roots[0]);
      store.setState({ roots: data.roots, root: data.roots[0] || '' });
      return;
    case 'filterOptions':
      store.setState({
        filterRecents: data.recents || {},
        authorOptions: data.authors,
        pathOptions: [
          ...new Set(
            data.paths.flatMap((path) => {
              const parts = path.split('/');
              return [path, ...parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/') + '/')];
            }),
          ),
        ].sort(),
      });
      return;
    case 'filterRecents':
      store.setState({ filterRecents: data.recents });
      return;
    case 'pathChildren':
      actions.filters.receivePath(data);
      return;
    case 'branchToolsFinished':
      store.setState({ branchToolsBusy: false });
      return;
    case 'operation':
      if (!['update', 'push', 'fetch', 'create'].includes(data.action)) store.setState({ ref: '' });
      actions.history.load();
      env.setStatus(data.message);
      return;
    case 'data':
      applyHistory(ctx, data);
      return;
    case 'details':
    case 'detailStats':
    case 'preview':
      actions.files.receive(data);
      return;
    case 'historyReveal':
      if (data.root === state().root) actions.commits.navigateToRevision(data.target);
      return;
    case 'goTo':
      if (data.requestId === state().historyRequest)
        actions.commits.navigateToRevision(data.target);
      return;
    case 'branchLocated':
      if (data.requestId !== state().historyRequest || data.root !== state().root) return;
      store.setState({ historyLoading: false });
      env.setStatus(
        actions.history.refValues().map((value) => branchValueLabel(value, state().branches)),
      );
      // Rows are already mounted/virtualized; move before releasing the refresh
      // coordinator so pending changes cannot start a reload at the old scroll position.
      actions.commits.navigateToRevision(data.target);
      actions.history.refreshCoordinator.finish(data);
      return;
    case 'cherryPickFinished':
      store.setState({ cherryPickBusy: false, cherryPickInProgress: Boolean(data.pending) });
      if (data.refresh) actions.history.load();
      return;
    case 'commitActionDone':
      ctx.ui.finishRefDialog(data.dialogId);
      actions.history.load();
      return;
    case 'commitRefError':
      ctx.ui.finishRefDialog(data.dialogId, true);
      return;
    case 'error':
      if (data.requestId !== undefined && data.requestId !== state().historyRequest) return;
      if (data.requestId !== undefined) {
        store.setState({ historyLoading: false, autoLoadBlocked: true });
        actions.history.refreshCoordinator.error();
      }
      env.setStatus('Operation failed');
      return;
  }
}
function applyHistory(ctx: LogContext, data: HistoryMessage) {
  const before = ctx.store.getState();
  if (data.requestId !== undefined && data.requestId !== before.historyRequest) return;
  const { env, actions, store } = ctx;
  const receivedAt = performance.now();
  const incremental = Boolean(
    (data.append || data.target) &&
    !data.resetFilters &&
    before.commits.length &&
    before.commits.every((c, i) => data.commits[i]?.hash === c.hash),
  );
  const loaded = new Set(data.commits.map((c) => c.hash));
  const selected = new Set([...before.selected].filter((hash) => loaded.has(hash)));
  if (!env.comparison && !selected.size && data.commits.length) selected.add(data.commits[0].hash);
  // One atomic host snapshot lets React reconcile each dependent region once.
  flushSync(() => {
    ctx.branchState.applySnapshot(data);
    store.setState({
      commits: data.commits,
      selected,
      historyLoading: Boolean(data.loadingMore),
      hasMoreHistory: data.hasMore ?? data.commits.length >= data.historyLimit,
      pageSize: data.pageSize || before.pageSize,
      limit: data.historyLimit ?? before.limit,
      initialCount: data.initialCount ?? before.initialCount,
      cherryPickInProgress: Boolean(data.cherryPickPending),
      cherryPickBusy: data.cherryPickBusy ?? before.cherryPickBusy,
      notPickedHashes: data.notPickedHashes || null,
      repositoryRemotes: data.remotes || [],
      user: data.user || '',
      userName: data.userName || '',
      headHashes: new Set(data.headHashes || []),
      filtered: Boolean(data.filtered),
      ...(data.resetFilters
        ? {
            ref: data.ref || '',
            search: '',
            filterState: emptyFilters(),
            hideMerges: false,
            graphSettings: { ...before.graphSettings, firstParent: false },
          }
        : {}),
    });
  });
  if (data.resetFilters) actions.history.saveGraphSettings();
  const renderedAt = performance.now();
  env.window.requestAnimationFrame(() =>
    env.window.requestAnimationFrame(() => {
      if (ctx.lifetime.disposed) return;
      env.send('renderTiming', {
        requestId: data.requestId,
        values: {
          navigationToScriptMs: env.scriptStarted,
          scriptToRequestMs: before.historySentAt - env.scriptStarted,
          requestToDataMs: receivedAt - before.historySentAt,
          outsideServerMs: Math.max(
            0,
            receivedAt - before.historySentAt - (data.timings?.serverMs || 0),
          ),
          dataSetupMs: renderedAt - receivedAt,
          branchesMs: 0,
          commitsMs: renderedAt - receivedAt,
          renderToFrameMs: performance.now() - renderedAt,
          requestToFrameMs: performance.now() - before.historySentAt,
        },
      });
    }),
  );
  if (!incremental || [...before.selected].join(',') !== [...selected].join(','))
    actions.branches.requestDetails();
  env.setStatus(
    env.comparison
      ? `${env.comparison.start.name}..${env.comparison.end.name} · Cmd/Ctrl-click: multi-select · Shift-click: range`
      : actions.history
          .refValues()
          .map((value) => branchValueLabel(value, store.getState().branches)),
  );
  if (data.target) actions.commits.finishGraphJump({ ...data, target: data.target });
  else if (data.append)
    env.window.requestAnimationFrame(() => {
      if (!ctx.lifetime.disposed) actions.history.maybeLoadMore();
    });
  if (!data.loadingMore) actions.history.refreshCoordinator.finish(data);
}
