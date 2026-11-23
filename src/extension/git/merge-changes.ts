// Adapted from VcsStatusMerger.kt, Copyright 2000-2017 JetBrains s.r.o.
// Apache-2.0; see THIRD_PARTY_NOTICES.md and LICENSE-APACHE-2.0.txt.
export interface ChangedFile {
  status: string;
  path: string;
  oldPath: string;
  afterHash?: string;
  sources?: ChangedFile[];
}

/** Rebased's VcsStatusMerger: intersect result paths, then merge their statuses.
 * Keep each parent's real path/status separately for historical three-way diffs.
 */
export function mergeFileStatuses(changes: ChangedFile[][]): ChangedFile[] {
  if (changes.length === 1) return changes[0];
  const others = changes.slice(1).map((files) => new Map(files.map((file) => [file.path, file])));
  return changes[0].flatMap((first) => {
    const sources = [first, ...others.map((files) => files.get(first.path))];
    if (sources.some((file) => !file)) return [];
    const types = new Set(sources.map((file) => file.status));
    const sameRename =
      first.status !== 'R' || sources.every((file) => file.oldPath === first.oldPath);
    const status = types.size === 1 && sameRename ? first.status : types.has('D') ? 'D' : 'M';
    return [
      { status, path: first.path, oldPath: status === 'R' ? first.oldPath : first.path, sources },
    ];
  });
}
