/** Repository-domain data shared by the extension and webviews. */
export interface Commit {
  hash: string;
  parents: string[];
  author?: string;
  email?: string;
  date?: string;
  authorDate?: string;
  subject?: string;
  decorations?: string;
  signature?: string;
  graphParents?: string[];
  graphUnloadedParents?: string[];
  graphLayout?: number;
  graphColor?: number;
}
export interface Stash {
  ref: string;
  hash: string;
  subject: string;
}

export interface Branch {
  ref: string;
  name: string;
  current?: boolean;
  group: 'Local' | 'Remote' | 'Tags';
  remote?: string;
  upstream?: string;
  symbolic?: string;
  ahead?: number;
  behind?: number;
}
export interface HistoryFilters {
  sort?: string;
  showSignature?: boolean;
  matchCase?: boolean;
  authors?: string[];
  authorQueries?: string[];
  author?: string;
  sinceHours?: number;
  since?: string;
  until?: string;
  hideMerges?: boolean;
  firstParent?: boolean;
  text?: string;
  regex?: boolean;
  paths?: string[];
  highlightNotPicked?: boolean;
}
export interface Revision {
  hash?: string;
  path: string;
  workingTree?: boolean;
}
export interface FileChange {
  index: number;
  status: string;
  path: string;
  before: Revision | null;
  after: Revision | null;
  /** Before revisions in parent order, only for a single selected merge commit. */
  mergeParents?: (Revision | null)[];
}
export interface ParentChanges {
  hash: string;
  files: FileChange[];
}
export interface ComparisonEndpoint {
  name: string;
  ref?: string;
  hash?: string;
  kind?: 'commit' | 'workingTree';
}
export interface Comparison {
  kind?: 'comparison';
  pair: ComparisonEndpoint[];
  files: FileChange[];
}
/** A fixed selection, which may contain unrelated or nonconsecutive commits. */
export interface SelectedCommitChanges {
  kind: 'selection';
  commits: Pick<Commit, 'hash' | 'subject'>[];
  files: FileChange[];
}
export type ChangesContent = Comparison | SelectedCommitChanges;
export type ComparisonSnapshot = ChangesContent & {
  root: string;
  id: string;
};
export type RecentKind = 'branch' | 'user' | 'paths';
export type RecentGroups = Partial<Record<RecentKind, string[][]>>;
export interface BranchActionOptions {
  name?: string;
  remote?: string;
}

export interface GraphEdge {
  start: number;
  end: number;
  unloaded: boolean;
  source: string;
  hash: string;
  dashed: boolean;
  colorId: number;
  collapsed?: boolean;
  node?: undefined;
}
export interface GraphNode {
  node: number;
  hash: string;
  start?: undefined;
  end?: undefined;
}
export interface GraphRow {
  hash: string;
  index: number;
  elements: (GraphNode | GraphEdge)[];
  segments: GraphSegment[];
  arrows: GraphArrow[];
  colorId: number;
  lane?: number;
  width?: number;
}
export interface GraphSegment {
  edge: GraphEdge;
  from: number;
  to: number;
  startY: number;
  endY: number;
}
export interface GraphArrow {
  edge: GraphEdge;
  lane: number;
  down: boolean;
  y: number;
}

export interface Author {
  name: string;
  email: string;
}
