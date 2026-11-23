import { createStore } from 'zustand/vanilla';
import type { CommitDetail } from '../react/commit-details';
import type { FileListEntry } from '../react/file-tree';
import type { ParentChanges } from '../../shared/model';

export interface DetailState {
  selectionKey?: string;
  files: readonly FileListEntry[];
  parents: readonly ParentChanges[];
  showParentChanges: boolean;
  items: readonly CommitDetail[];
  directoryView: boolean;
  opened: ReadonlyMap<string, boolean>;
  selectedFile?: number;
  emptyMessage?: string;
  previewKey: string;
  previewText?: string;
  previewLoading: boolean;
}

/** Third-column data lives once; the file list, toolbar, message and preview subscribe. */
export function createDetailStore(saved: Record<string, unknown> = {}) {
  return createStore<DetailState>(() => ({
    files: [],
    parents: [],
    showParentChanges: saved.showParentChanges === true,
    items: [],
    directoryView: saved.directoryView !== false,
    opened: new Map(),
    emptyMessage: 'Select a commit to explore its changes',
    previewKey: '',
    previewLoading: false,
  }));
}

export const visibleDetailFiles = (state: DetailState): readonly FileListEntry[] =>
  state.showParentChanges
    ? [...state.files, ...state.parents.flatMap((parent) => parent.files)]
    : state.files;
