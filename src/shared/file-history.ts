import type { Commit } from './model';
export interface FileHistoryEntry extends Commit {
  path: string;
  message: string;
}
export type FileHistoryGraphEntry = Pick<
  Commit,
  'hash' | 'graphParents' | 'graphUnloadedParents' | 'graphLayout' | 'graphColor'
>;
export interface FileHistoryPage {
  entries: FileHistoryEntry[];
  hasMore: boolean;
}
export interface FileHistoryDiff {
  hash: string;
  path: string;
  beforeLabel: string;
  afterLabel: string;
  contents: [string, string];
}

export interface FileHistoryViewOptions {
  author: boolean;
  date: boolean;
  hash: boolean;
  details: boolean;
}
export interface FileHistoryToolbarState {
  loading: boolean;
  selected: number;
  affected: boolean;
  locate: boolean;
  view: FileHistoryViewOptions;
}
