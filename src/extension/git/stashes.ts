import { git } from './client';
import type { Stash } from '../../shared/model';

/** Identify stash objects by their reflog, never by user-controlled commit subjects. */
export async function readStashes(root: string) {
  const raw = await git(root, ['stash', 'list', '--format=%H%x00%P%x00%gd%x00%gs']);
  const entries = new Map<string, { parents: string[]; name: string }>();
  const internal = new Set<string>();
  const list: Stash[] = [];
  for (const line of raw.trimEnd().split('\n').filter(Boolean)) {
    const [hash, parents, name, subject = ''] = line.split('\0');
    list.push({ hash, ref: name, subject });
    const ids = parents.split(' ').filter(Boolean);
    entries.set(hash, { parents: ids, name });
    ids.slice(1).forEach((id) => internal.add(id));
  }
  return {
    entries,
    list,
    internal,
    revisions: [...entries.keys()],
    visible<T extends { hash: string; parents: string[]; decorations?: string }>(
      commits: T[],
    ): T[] {
      return commits
        .filter((commit) => !internal.has(commit.hash))
        .map((commit) => {
          const stash = entries.get(commit.hash);
          return stash
            ? {
                ...commit,
                parents: stash.parents.slice(0, 1),
                decorations: [commit.decorations, stash.name].filter(Boolean).join(', '),
              }
            : commit;
        });
    },
  };
}
