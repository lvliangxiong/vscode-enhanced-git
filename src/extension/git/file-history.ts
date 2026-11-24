import { git, validHash } from './client';
import type { FileHistoryEntry, FileHistoryPage, FileHistoryDiff } from '../../shared/file-history';
import { readSelectionItems } from './selection-reader';
import { selectionDetails } from './changes';

const marker = 'vscode-enhanced-git-file-history';
const format = `%x00${marker}%x00%H%x00%P%x00%an%x00%ae%x00%cI%x00%s%x00%B%x00`;
interface RecordEntry {
  entry: FileHistoryEntry;
  added: boolean;
}
function records(raw: string, path: string): RecordEntry[] {
  const tokens = raw.split('\0'),
    result: RecordEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i++] !== marker) continue;
    const [hash, parents, author, email, date, subject, message] = tokens.slice(i, i + 7);
    i += 7;
    validHash(hash);
    let added = false;
    while (i < tokens.length) {
      const status = tokens[i].replace(/^\n+/, '');
      if (!status) {
        i++;
        continue;
      }
      if (status === marker) break;
      if (!/^[AMDTUXBRC][0-9]*$/.test(status)) throw Error('Invalid file history status');
      i++;
      const oldPath = tokens[i++];
      const nextPath = /^[RC]/.test(status) ? tokens[i++] : oldPath;
      added ||= status === 'A' && nextPath === path;
    }
    result.push({
      entry: {
        hash,
        parents: parents.split(' ').filter(Boolean),
        author,
        email,
        date,
        subject,
        message: message.trimEnd(),
        path,
      },
      added,
    });
  }
  return result;
}
function literalPath(path: string) {
  if (!path || path.includes('\0') || path.startsWith('/') || path.split('/').includes('..'))
    throw Error('Invalid history path');
  return `:(literal)${path}`;
}

/** Like Rebased, walk one path at a time and cross rename boundaries explicitly.
 * A plain --follow log loses merge commits. Cursors stay in this fixed-revision
 * session; no client-supplied Git options, mutable HEAD, or working-tree reads.
 */
export function createFileHistory(root: string, revision: string, path: string) {
  validHash(revision);
  literalPath(path);
  let starts = [{ revision, path, skip: 0 }];
  let visited = new Set<string>();
  let busy = false;
  return {
    async next(limit = 100): Promise<FileHistoryPage> {
      if (busy) throw Error('File history is already loading');
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw Error('Invalid history page size');
      busy = true;
      const savedStarts = starts.map((start) => ({ ...start }));
      const savedVisited = new Set(visited);
      const entries: FileHistoryEntry[] = [];
      try {
        while (starts.length && entries.length < limit) {
          const start = starts[0],
            size = limit - entries.length;
          const raw = await git(root, [
            'log',
            '--date-order',
            '--no-renames',
            '--no-show-signature',
            '--name-status',
            '-z',
            `--format=${format}`,
            `--max-count=${size + 1}`,
            `--skip=${start.skip}`,
            start.revision,
            '--',
            literalPath(start.path),
          ]);
          const page = records(raw, start.path);
          let boundary = false;
          for (const record of page.slice(0, size)) {
            start.skip++;
            if (!visited.has(record.entry.hash)) {
              visited.add(record.entry.hash);
              entries.push(record.entry);
            }
            if (!record.added) continue;
            // Diff each real parent at the boundary, retaining its own old
            // path. This avoids walking an unrelated parent with the wrong name.
            const [info] = await readSelectionItems(root, [record.entry.hash], false);
            starts.shift();
            (info.changesToParents ?? [info.files]).forEach((files, parent) => {
              for (const file of files) {
                if (file.status !== 'R' || file.path !== start.path) continue;
                const revision = info.parents[parent];
                if (!starts.some((s) => s.revision === revision && s.path === file.oldPath))
                  starts.push({ revision, path: file.oldPath, skip: 0 });
              }
            });
            boundary = true;
            break;
          }
          if (!boundary && page.length <= size) starts.shift();
        }
        return { entries, hasMore: starts.length > 0 };
      } catch (error) {
        starts = savedStarts;
        visited = savedVisited;
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}

export async function fileHistoryDiff(
  root: string,
  entry: FileHistoryEntry,
): Promise<FileHistoryDiff> {
  const result = await selectionDetails(root, [entry.hash], { includeStats: false });
  const candidates = result.parents?.[0]?.files ?? result.files;
  const change = candidates.find(
    (file) => file.path === entry.path || file.before?.path === entry.path,
  );
  // A merge may be identical to parent 1, while changing the file against parent 2.
  const after = change ? change.after : { hash: entry.hash, path: entry.path };
  const before = change
    ? change.before
    : entry.parents[0]
      ? { hash: entry.parents[0], path: entry.path }
      : null;
  const contents = await Promise.all(
    [before, after].map((revision) =>
      revision
        ? git(root, ['show', `${validHash(revision.hash)}:${revision.path}`])
        : Promise.resolve(''),
    ),
  );
  return {
    hash: entry.hash,
    path: after?.path || before?.path || entry.path,
    beforeLabel: before ? `${before.path} (${before.hash.slice(0, 8)})` : 'Empty',
    afterLabel: after ? `${after.path} (${after.hash.slice(0, 8)})` : 'Deleted',
    contents: contents as [string, string],
  };
}

/** Compare the actual file versions at two history entries, including renames
 * and deletions. This is endpoint comparison, not aggregation of commit deltas. */
export async function compareHistoryEntries(
  root: string,
  before: FileHistoryEntry,
  after: FileHistoryEntry,
): Promise<FileHistoryDiff> {
  const versions = await Promise.all([before, after].map((entry) => fileHistoryDiff(root, entry)));
  return {
    hash: after.hash,
    path: after.path,
    beforeLabel: versions[0].afterLabel,
    afterLabel: versions[1].afterLabel,
    contents: [versions[0].contents[1], versions[1].contents[1]],
  };
}
