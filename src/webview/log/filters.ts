import * as Filters from '../filters';
import { isFilterKind, isFilterPath, type FilterApplyArgs, type FilterPath } from '../filter-types';
import type { LogContext } from './context';
import type { RecentKind } from '../../shared/model';

export interface FiltersController {
  start(): void;
  dispose(): void;
  positionFilter(): void;
  closeFilter(restore?: boolean): void;
  clearFilter(kind: string): void;
  openFilter(kind: string, anchor: HTMLElement): void;
  receivePath(data: { request: number; error?: string; items?: unknown[] }): void;
  surface: Filters.FilterController;
}
export function createFiltersController(ctx: LogContext): FiltersController {
  const { store } = ctx;
  const state = store.getState;
  const { $, document, window, layoutSheet, send, themedFileIcons } = ctx.env;
  let requestId = 0;
  let disposed = false;
  const pending = new Map<
    number,
    {
      resolve: (items: FilterPath[]) => void;
      reject: (error: Error) => void;
    }
  >();
  const surface = Filters.create({
    popup: $('filter-popup'),
    document,
    window,
    sheet: layoutSheet,
    themeFileIcon: themedFileIcons,
    model: () => ({
      root: state().root,
      branches: state().branches,
      favorites: state().favorites,
      refs: ctx.actions.history.refValues(),
      ...state().filterState,
      user: state().user,
      authorOptions: state().authorOptions,
      recents: state().filterRecents,
    }),
    beforeOpen() {
      ctx.ui.closeContextMenu();
      ctx.actions.toolbar.closeViewMenu();
    },
    favorite: (value) => ctx.actions.branchTools.toggleBranchFavorites([value]),
    removeRecent(kind: RecentKind, values: string[]) {
      store.setState({
        filterRecents: {
          ...state().filterRecents,
          [kind]: Filters.forget(state().filterRecents[kind] || [], values),
        },
      });
      send('filterRecent', { kind, values, remove: true });
    },
    clearRecent(kind: RecentKind) {
      store.setState({ filterRecents: { ...state().filterRecents, [kind]: [] } });
      send('filterRecent', { kind, values: [], clear: true });
    },
    pathChildren(path) {
      if (disposed) return Promise.reject(new Error('Log session disposed'));
      return new Promise<FilterPath[]>((resolve, reject) => {
        const request = ++requestId;
        pending.set(request, { resolve, reject });
        send('pathChildren', { path, request });
      });
    },
    apply(...args: FilterApplyArgs) {
      const [kind, values, remember] = args;
      if (kind === 'date') {
        store.setState({ filterState: { ...state().filterState, ...values } });
      } else {
        if (kind === 'branch')
          store.setState({
            ref: values.map(
              (value) => state().branches.find((branch) => branch.name === value)?.ref || value,
            ),
          });
        else if (kind === 'user')
          store.setState({ filterState: { ...state().filterState, authors: values } });
        else
          store.setState({
            filterState: {
              ...state().filterState,
              paths: values.map((value) =>
                value.startsWith(state().root + '/') ? value.slice(state().root.length + 1) : value,
              ),
            },
          });
        if (remember && values.length) {
          store.setState({
            filterRecents: {
              ...state().filterRecents,
              [kind]: Filters.remember(state().filterRecents[kind] || [], values),
            },
          });
          send('filterRecent', { kind, values });
        }
      }
      ctx.actions.history.applyFilters();
    },
  });
  function clearFilter(kind: string) {
    if (!isFilterKind(kind) || disposed) return;
    if (kind === 'branch') store.setState({ ref: '' });
    else if (kind === 'date')
      store.setState({
        filterState: { ...state().filterState, since: '', until: '', sinceHours: 0 },
      });
    else if (kind === 'user')
      store.setState({ filterState: { ...state().filterState, authors: [] } });
    else store.setState({ filterState: { ...state().filterState, paths: [] } });
    surface.close();
    ctx.actions.history.applyFilters();
  }
  let stop: (() => void) | undefined;
  return {
    surface,
    clearFilter,
    openFilter: (kind, anchor) => {
      if (isFilterKind(kind)) surface.open(kind, anchor);
    },
    positionFilter: surface.position,
    closeFilter: surface.close,
    start() {
      if (stop || disposed) return;
      stop = store.subscribe((next, previous) => {
        if (
          next.branches !== previous.branches ||
          next.favorites !== previous.favorites ||
          next.filterRecents !== previous.filterRecents ||
          next.authorOptions !== previous.authorOptions
        )
          surface.refresh();
      });
      ctx.lifetime.listen(window, 'resize', surface.position);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop?.();
      surface.dispose();
      for (const request of pending.values()) request.reject(new Error('Log session disposed'));
      pending.clear();
    },
    receivePath(data) {
      const request = pending.get(data.request);
      if (!request) return;
      pending.delete(data.request);
      if (data.error) request.reject(new Error(data.error));
      else if (data.items && !data.items.every(isFilterPath))
        request.reject(new Error('Invalid path response'));
      else request.resolve((data.items || []) as FilterPath[]);
    },
  };
}
