import { createStore } from 'zustand/vanilla';
import type { Commit, RecentGroups } from '../../shared/model';
import type { BranchState } from './branches';

export interface FilterState {
  authors: string[];
  paths: string[];
  since: string;
  until: string;
  sinceHours: number;
  regex: boolean;
  matchCase: boolean;
}
export interface LogState extends BranchState {
  commits: Commit[];
  selected: ReadonlySet<string>;
  anchor?: string;
  ref: string | string[];
  root: string;
  roots: string[];
  limit: number;
  initialCount: number;
  pageSize: number;
  user: string;
  userName: string;
  headHashes: ReadonlySet<string>;
  filtered: boolean;
  notPickedHashes: string[] | null;
  cherryPickInProgress: boolean;
  cherryPickBusy: boolean;
  historyRequest: number;
  historySentAt: number;
  historyLoading: boolean;
  hasMoreHistory: boolean;
  autoLoadBlocked: boolean;
  pendingGraphJump?: {
    hash: string;
    edge?: { source: string; parent: string };
    requestId?: number;
  };
  filterState: FilterState;
  filterRecents: RecentGroups;
  authorOptions: { name: string; email: string }[];
  pathOptions: string[];
  graphSettings: { sort: 'date' | 'topological'; firstParent: boolean };
  viewSettings: Record<string, boolean>;
  columnWidths: Record<string, number>;
  columnOrder: string[];
  search: string;
  hideMerges: boolean;
  branchSearch: string;
  selectedBranchRefs: ReadonlySet<string>;
  branchAnchor?: string;
  branchAnchorLocation?: string;
  treeOpen: ReadonlyMap<string, boolean>;
  branchToolsBusy: boolean;
  repositoryRemotes: string[];
  branchesCollapsed: boolean;
  detailsCollapsed: boolean;
  widths: { left: number; right: number };
  detailRatio: number;
  previewLocation: 'right' | 'bottom';
  showDetails: boolean;
  showPreview: boolean;
  status: string | string[];
  updatesAvailable: boolean;
  visible: boolean;
}

export function emptyFilters(): FilterState {
  return {
    authors: [],
    paths: [],
    since: '',
    until: '',
    sinceHours: 0,
    regex: false,
    matchCase: false,
  };
}

/** A fresh store for every repository pane. No module-level mutable session state. */
export function createLogStore(
  saved: Record<string, any> = {},
  layout = saved.layout,
  comparison = false,
) {
  const widths =
    Number.isFinite(layout?.left) && Number.isFinite(layout?.right)
      ? { left: layout.left, right: layout.right }
      : { left: 0.23, right: 0.27 };
  return createStore<LogState>(() => ({
    branches: [],
    stashes: [],
    favorites: new Set(),
    repositoryVersion: -1,
    commits: [],
    selected: new Set(),
    ref: '',
    root: '',
    roots: [],
    limit: 500,
    initialCount: 500,
    pageSize: 500,
    user: '',
    userName: '',
    headHashes: new Set(),
    filtered: false,
    notPickedHashes: null,
    cherryPickInProgress: false,
    cherryPickBusy: false,
    historyRequest: 0,
    historySentAt: performance.now(),
    historyLoading: false,
    hasMoreHistory: true,
    autoLoadBlocked: false,
    filterState: emptyFilters(),
    filterRecents: {},
    authorOptions: [],
    pathOptions: [],
    graphSettings: {
      sort: saved.graphSettings?.sort === 'topological' ? 'topological' : 'date',
      firstParent: Boolean(saved.graphSettings?.firstParent),
    },
    viewSettings: {
      compactRefs: true,
      longEdges: false,
      commitTimestamp: false,
      refsLeft: false,
      author: true,
      hash: false,
      date: true,
      signature: false,
      'show-tags': true,
      'highlight-me': false,
      'highlight-merges': false,
      'highlight-head': false,
      ...saved.viewSettings,
    },
    columnWidths: { author: 120, hash: 85, date: 170, signature: 105, ...saved.columnWidths },
    columnOrder: saved.columnOrder || ['subject', 'author', 'hash', 'date', 'signature'],
    search: '',
    hideMerges: Boolean(saved.graphSettings?.hideMerges),
    branchSearch: '',
    selectedBranchRefs: new Set(),
    treeOpen: new Map(),
    branchToolsBusy: false,
    repositoryRemotes: [],
    detailsCollapsed: layout?.detailsCollapsed === true,
    branchesCollapsed: !comparison && layout?.branchesCollapsed === true,
    widths,
    detailRatio: Number.isFinite(layout?.detailRatio)
      ? Math.max(0, Math.min(1, layout.detailRatio))
      : 0.68,
    previewLocation: saved.previewLocation === 'right' ? 'right' : 'bottom',
    showDetails: saved.showDetails ?? true,
    showPreview: saved.showPreview ?? false,
    status: 'Loading repository…',
    updatesAvailable: false,
    visible: true,
  }));
}
