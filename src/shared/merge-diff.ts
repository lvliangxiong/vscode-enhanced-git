export interface MergeCommit {
  hash: string;
  author: string;
  email: string;
  authorDate: string;
  committer: string;
  committerEmail: string;
  date: string;
  message: string;
}
export interface MergeCommitStats {
  files: number;
  insertions: number;
  deletions: number;
}
export interface MergeDiffData {
  style?: MergeDiffStyle;
  path: string;
  labels: [string, string, string];
  contents: [string, string, string];
  commits?: [MergeCommit, MergeCommit, MergeCommit];
  /** Zero-context Git diffs from each parent to the merge result. */
  patches: [string, string];
}

export type MergeDiffStyle = 'native' | 'jetbrains';
export function mergeDiffStyle(value: unknown): MergeDiffStyle {
  return value === 'jetbrains' ? value : 'native';
}
