import type { StoreApi } from 'zustand/vanilla';
import type { LogContext } from './context';
import { createDetailStore, visibleDetailFiles, type DetailState } from '../state/details';
import type { ParentChanges } from '../../shared/model';
import { fileFolderPaths, mergeFileGroupPath, type FileListEntry } from '../react/file-tree';
import type { CommitStats } from '../react/commit-details';

export interface DetailsMessage {
  type: 'details';
  key: string;
  files: FileListEntry[];
  items: { hash: string; message: string; stats?: CommitStats }[];
  parents?: ParentChanges[];
}
export interface DetailStatsMessage {
  type: 'detailStats';
  key: string;
  items: { hash: string; stats: CommitStats }[];
}
export interface PreviewMessage {
  type: 'preview';
  key: string;
  text: string;
}
export type DetailMessage = DetailsMessage | DetailStatsMessage | PreviewMessage;

export interface FilesController {
  store: StoreApi<DetailState>;
  start(): void;
  dispose(): void;
  receive(message: DetailMessage): void;
  resetDetails(): void;
  expandFileFolders(open: boolean): void;
  expansionState(): { enabled: boolean; expanded: boolean };
  toggleDirectory(): void;
  toggleParentChanges(): void;
  canShowInSidebar(): boolean;
  showInSidebar(): void;
  showParentDiff(hash: string): void;
  canShowHistory(): boolean;
  showHistory(): void;
  selectFile(file: FileListEntry): void;
  openFile(file: FileListEntry): void;
  openWorkingFile(file: FileListEntry): void;
  setFolder(path: string, open: boolean): void;
  setIcon(node: HTMLElement, path: string): void;
}

/** Message/actions boundary for details. Rendering is entirely subscription-driven. */
export function createFilesController(ctx: LogContext): FilesController {
  const store = createDetailStore(ctx.env.api.getState());
  let disposed = false;
  let previewRequest = 0;
  let previewSelection = '';
  let folderFiles: readonly FileListEntry[] | undefined;
  let folderParents: readonly ParentChanges[] | undefined;
  let folderShowsParents: boolean;
  let folderDirectoryView: boolean;
  let folders = new Set<string>();
  let roots: string[] = [];
  const folderPaths = () => {
    const current = store.getState();
    if (
      current.files !== folderFiles ||
      current.parents !== folderParents ||
      current.showParentChanges !== folderShowsParents ||
      current.directoryView !== folderDirectoryView
    ) {
      folderFiles = current.files;
      folderParents = current.parents;
      folderShowsParents = current.showParentChanges;
      folderDirectoryView = current.directoryView;
      folders = new Set(current.directoryView ? fileFolderPaths(visibleDetailFiles(current)) : []);
      roots = [];
      if (current.files.length) roots.push(mergeFileGroupPath());
      if (current.parents.length && current.showParentChanges) {
        for (const parent of current.parents)
          if (parent.files.length) roots.push(mergeFileGroupPath(parent.hash));
      }
      for (const root of roots) folders.add(root);
    }
    return folders;
  };
  const selectionKey = () => [...ctx.store.getState().selected].join(',');
  const canShowInSidebar = () =>
    !disposed &&
    ctx.store.getState().selected.size > 0 &&
    store.getState().selectionKey === selectionKey();
  const requestSelectionFile = (file: FileListEntry, open: boolean, workingFile = false) => {
    if (disposed || !visibleDetailFiles(store.getState()).includes(file)) return;
    const state = ctx.store.getState();
    const key = `${selectionKey()}:${file.index}:${++previewRequest}`;
    if (!open) {
      previewSelection = selectionKey();
      store.setState({ previewKey: key, previewLoading: true, previewText: undefined });
    }
    ctx.env.send('selectionFile', {
      hashes: state.commits
        .filter((commit) => state.selected.has(commit.hash))
        .map((commit) => commit.hash),
      index: file.index,
      key,
      open,
      ...(workingFile ? { workingFile: true } : {}),
    });
  };
  return {
    store,
    start() {},
    expansionState() {
      folderPaths();
      const current = store.getState();
      return {
        enabled: !disposed && roots.length > 0,
        expanded: roots.some((path) => current.opened.get(path) ?? true),
      };
    },
    canShowInSidebar,
    canShowHistory: () =>
      canShowInSidebar() &&
      visibleDetailFiles(store.getState()).some(
        (file) => file.index === store.getState().selectedFile,
      ),
    showHistory() {
      const current = store.getState();
      const file = visibleDetailFiles(current).find((file) => file.index === current.selectedFile);
      if (!canShowInSidebar() || !file) return;
      const state = ctx.store.getState();
      ctx.env.send('selectionFileHistory', {
        hashes: state.commits
          .filter((commit) => state.selected.has(commit.hash))
          .map((commit) => commit.hash),
        index: file.index,
      });
    },
    showParentDiff(hash) {
      const detail = store.getState();
      const selected = ctx.store.getState().selected;
      if (
        !canShowInSidebar() ||
        selected.size !== 1 ||
        !detail.showParentChanges ||
        !detail.parents.some((parent) => parent.hash === hash)
      )
        return;
      ctx.env.send('commitFiles', { hashes: [hash, [...selected][0]] });
    },
    showInSidebar() {
      if (!canShowInSidebar()) return;
      const state = ctx.store.getState();
      ctx.env.send('selectionChanges', {
        hashes: state.commits
          .filter((commit) => state.selected.has(commit.hash))
          .map((commit) => commit.hash),
      });
    },
    dispose() {
      disposed = true;
    },
    receive(message) {
      if (disposed) return;
      if (message.type === 'preview') {
        if (message.key !== store.getState().previewKey || previewSelection !== selectionKey())
          return;
        store.setState({ previewLoading: false, previewText: message.text });
        ctx.env.setStatus('Double-click a file or press Enter to open native Diff');
        return;
      }
      if (message.key !== selectionKey()) return;
      if (message.type === 'detailStats') {
        ctx.actions.details.updateCommitDetailStats(message.items);
        return;
      }
      const commits = new Map(ctx.store.getState().commits.map((commit) => [commit.hash, commit]));
      store.setState({
        selectionKey: message.key,
        files: message.files,
        parents: message.parents || [],
        selectedFile: undefined,
        emptyMessage: undefined,
        items: message.items.flatMap((item) => {
          const commit = commits.get(item.hash);
          return commit ? [{ commit, message: item.message, stats: item.stats }] : [];
        }),
      });
    },
    resetDetails() {
      if (disposed) return;
      previewSelection = '';
      store.setState({
        selectionKey: undefined,
        files: [],
        parents: [],
        selectedFile: undefined,
        previewKey: '',
        previewText: undefined,
        previewLoading: false,
        emptyMessage: ctx.store.getState().selected.size
          ? 'Loading changes…'
          : 'Select commits to explore changes',
        items: [],
      });
    },
    expandFileFolders(open) {
      if (disposed) return;
      const state = store.getState();
      const opened = new Map(state.opened);
      for (const path of folderPaths()) opened.set(path, open);
      store.setState({ opened });
    },
    toggleDirectory() {
      if (disposed) return;
      const directoryView = !store.getState().directoryView;
      store.setState({ directoryView, selectedFile: undefined });
      ctx.env.api.setState({ ...ctx.env.api.getState(), directoryView });
    },
    toggleParentChanges() {
      if (disposed) return;
      previewSelection = '';
      const showParentChanges = !store.getState().showParentChanges;
      store.setState({
        showParentChanges,
        selectedFile: undefined,
        previewText: undefined,
        previewLoading: false,
      });
      ctx.env.api.setState({ ...ctx.env.api.getState(), showParentChanges });
    },
    selectFile(file) {
      if (disposed || !visibleDetailFiles(store.getState()).includes(file)) return;
      store.setState({ selectedFile: file.index });
      if (ctx.store.getState().showPreview) requestSelectionFile(file, false);
    },
    openFile: (file) => requestSelectionFile(file, true),
    openWorkingFile: (file) => requestSelectionFile(file, true, true),
    setFolder(path, open) {
      if (disposed) return;
      const state = store.getState();
      if ((state.opened.get(path) ?? true) === open) return;
      if (!folderPaths().has(path)) return;
      const opened = new Map(state.opened);
      opened.set(path, open);
      store.setState({ opened });
    },
    setIcon: (node, path) => {
      ctx.env.themedFileIcons.set(node, path);
    },
  };
}
