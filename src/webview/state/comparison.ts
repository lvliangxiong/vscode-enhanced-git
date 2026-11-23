import { createStore } from 'zustand/vanilla';
import type { ChangesContent } from '../../shared/model';
import { fileFolderPaths } from '../react/file-tree';

export type ComparisonData = ChangesContent & {
  id: string;
  repository?: string;
};
export interface SavedComparisonState {
  tree?: boolean;
  opened?: [string, boolean][];
  id?: string;
  chosen?: number;
  scroll?: number;
}
export interface ComparisonState {
  data?: ComparisonData;
  chosen?: number;
  tree: boolean;
  opened: ReadonlyMap<string, boolean>;
  folders: readonly string[];
  restoreScroll?: number;
  revision: number;
}

export function createComparisonStore(saved: SavedComparisonState = {}) {
  const store = createStore<ComparisonState>(() => ({
    tree: saved.tree !== false,
    opened: new Map(saved.opened || []),
    folders: [],
    revision: 0,
  }));
  return {
    store,
    receive(
      message: Partial<ComparisonData> & { previousId?: string },
      previous: SavedComparisonState,
    ) {
      const state = store.getState();
      const refreshing = message.previousId !== undefined && message.previousId === previous.id;
      const chosenPath = state.data?.files.find((file) => file.index === state.chosen)?.path;
      const data =
        message.kind === 'selection'
          ? message.commits && message.files
            ? (message as ComparisonData)
            : undefined
          : message.pair
            ? (message as ComparisonData)
            : undefined;
      store.setState({
        data,
        chosen: refreshing
          ? data?.files.find((file) => file.path === chosenPath)?.index
          : previous.id === data?.id
            ? previous.chosen
            : undefined,
        opened: data ? state.opened : new Map(),
        folders: data ? fileFolderPaths(data.files) : [],
        restoreScroll: !data
          ? 0
          : refreshing || previous.id === data.id
            ? previous.scroll || 0
            : undefined,
        revision: state.revision + 1,
      });
    },
    select(chosen: number) {
      if (chosen !== store.getState().chosen) store.setState({ chosen });
    },
    setTree(tree: boolean) {
      store.setState({ tree });
    },
    setFolder(path: string, open: boolean) {
      const state = store.getState();
      if ((state.opened.get(path) ?? true) === open || !state.folders.includes(path)) return;
      const opened = new Map(state.opened);
      opened.set(path, open);
      store.setState({ opened });
    },
    expand(expanded: boolean) {
      const state = store.getState();
      const opened = new Map(state.opened);
      for (const path of state.folders) opened.set(path, expanded);
      store.setState({ opened });
    },
  };
}
export type ComparisonController = ReturnType<typeof createComparisonStore>;
