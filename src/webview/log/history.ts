import { create as createHistoryRefresh } from '../history-refresh';
import { emptyFilters } from '../state/log';
import type { HistoryFilters } from '../../shared/model';
import type { LogContext } from './context';

export interface HistoryController {
  start(): void;
  dispose(): void;
  readonly refreshCoordinator: ReturnType<typeof createHistoryRefresh>;
  requestHistory(type: string, payload: Record<string, unknown>): void;
  load(options?: { append?: boolean; resetLimit?: boolean; refresh?: boolean }): void;
  loadMore(): void;
  maybeLoadMore(): void;
  applyFilters(): void;
  filters(): HistoryFilters;
  refValues(): string[];
  saveGraphSettings(): void;
  cancelFilterTimer(): void;
  setSearch(value: string): void;
  clearSearch(): void;
  setHideMerges(value: boolean): void;
  toggleSearchMode(key: 'regex' | 'matchCase'): void;
  updateViewSetting(key: string, value: boolean): void;
  changeRepository(root: string): void;
}

/** Requests/paging are effects. Controls and badges derive directly from the session store. */
export function createHistoryController(ctx: LogContext): HistoryController {
  const { $, document, window, api, send, setStatus } = ctx.env;
  const state = ctx.store.getState;
  let filterTimer: ReturnType<typeof setTimeout>;
  let scrollFrame = 0;
  const historyRefresh = createHistoryRefresh({
    canRefresh: () =>
      state().visible &&
      !document.hidden &&
      $('commits').scrollTop <= 1 &&
      !state().pendingGraphJump &&
      !document.body.classList.contains('reordering-columns'),
    refresh: () => load(),
    indicate: (pending: boolean) => {
      if (state().updatesAvailable !== pending) ctx.store.setState({ updatesAvailable: pending });
    },
  });
  function refValues() {
    const ref = state().ref;
    return Array.isArray(ref) ? ref : ref ? [ref] : [];
  }
  function filters(): HistoryFilters {
    const current = state();
    return {
      text: current.search,
      ...current.filterState,
      authors: [],
      authorQueries: current.filterState.authors,
      ...current.graphSettings,
      showSignature: current.viewSettings.signature,
      highlightNotPicked: Boolean(current.viewSettings.notPicked),
      hideMerges: current.hideMerges,
    };
  }
  function saveGraphSettings() {
    const current = state();
    api.setState({
      ...api.getState(),
      graphSettings: {
        ...current.graphSettings,
        showSignature: current.viewSettings.signature,
        highlightNotPicked: Boolean(current.viewSettings.notPicked),
        hideMerges: current.hideMerges,
      },
    });
  }
  function requestHistory(type: string, payload: Record<string, unknown>) {
    historyRefresh.begin();
    const current = state();
    const requestId = current.historyRequest + 1;
    ctx.store.setState({
      historySentAt: performance.now(),
      pendingGraphJump: undefined,
      historyLoading: true,
      autoLoadBlocked: false,
      historyRequest: requestId,
    });
    send(type, {
      ...payload,
      initialCount: current.initialCount,
      branchSnapshotKey: current.snapshotKey,
      requestId,
    });
  }
  function load({ append = false, resetLimit = false, refresh = false } = {}) {
    setStatus(append ? 'Loading more commits…' : 'Loading history…');
    requestHistory('load', {
      ref: state().ref,
      limit: state().limit,
      filters: filters(),
      append,
      resetLimit,
      refresh,
    });
  }
  function loadMore() {
    if (state().historyLoading || !state().hasMoreHistory) return;
    ctx.store.setState({ limit: state().commits.length + state().pageSize });
    load({ append: true });
  }
  function maybeLoadMore() {
    const list = $('commits');
    if (
      !state().autoLoadBlocked &&
      list.clientHeight > 0 &&
      list.scrollHeight - list.scrollTop - list.clientHeight <=
        Math.min(600, Math.max(240, list.clientHeight / 2))
    )
      loadMore();
  }
  function onScroll() {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      ctx.actions.commits.renderCommitWindow();
      ctx.actions.graph.repaintGraphCanvases();
      historyRefresh.check();
      maybeLoadMore();
    });
  }
  const cancelFilterTimer = () => clearTimeout(filterTimer);
  function applyFilters() {
    cancelFilterTimer();
    ctx.store.setState({ limit: state().initialCount });
    load({ resetLimit: true });
  }
  function debounceFilters() {
    cancelFilterTimer();
    filterTimer = setTimeout(applyFilters, 120);
  }
  function setSearch(value: string) {
    ctx.store.setState({ search: value });
    debounceFilters();
  }
  function clearSearch() {
    ctx.store.setState({ search: '' });
    applyFilters();
    $('search').focus();
  }
  function setHideMerges(value: boolean) {
    ctx.store.setState({ hideMerges: value });
    debounceFilters();
  }
  function toggleSearchMode(key: 'regex' | 'matchCase') {
    ctx.store.setState({
      filterState: { ...state().filterState, [key]: !state().filterState[key] },
    });
    applyFilters();
  }
  function updateViewSetting(key: string, value: boolean) {
    ctx.store.setState({ viewSettings: { ...state().viewSettings, [key]: value } });
    ctx.actions.columns.saveView();
  }
  function changeRepository(root: string) {
    historyRefresh.reset(root);
    ctx.actions.filters.closeFilter();
    ctx.branchState.reset();
    ctx.store.setState({
      root,
      ref: '',
      selectedBranchRefs: new Set(),
      branchAnchor: undefined,
      filterState: emptyFilters(),
      filterRecents: {},
      authorOptions: [],
      pathOptions: [],
      limit: state().initialCount,
      selected: new Set(),
    });
    requestHistory('repo', { root, filters: filters() });
  }
  const check = () => historyRefresh.check();
  const afterPointer = () => queueMicrotask(check);
  return {
    start() {
      $('commits').addEventListener('scroll', onScroll, { passive: true });
      document.addEventListener('visibilitychange', check);
      window.addEventListener('pointerup', afterPointer);
    },
    dispose() {
      historyRefresh.dispose();
      cancelFilterTimer();
      window.cancelAnimationFrame(scrollFrame);
      $('commits').removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pointerup', afterPointer);
    },
    refreshCoordinator: historyRefresh,
    requestHistory,
    load,
    loadMore,
    maybeLoadMore,
    applyFilters,
    filters,
    refValues,
    saveGraphSettings,
    cancelFilterTimer,
    setSearch,
    clearSearch,
    setHideMerges,
    toggleSearchMode,
    updateViewSetting,
    changeRepository,
  };
}
