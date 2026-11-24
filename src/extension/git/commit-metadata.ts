import type { MergeCommit, MergeCommitStats } from '../../shared/merge-diff';
import { git, validHash } from './client';

/** Read only the requested commits, including full messages, in one Git process. */
export async function readCommitMetadata(
  root: string,
  hashes: readonly string[],
): Promise<MergeCommit[]> {
  if (!hashes.length) return [];
  const output = await git(root, [
    'log',
    '--no-walk=unsorted',
    '--no-show-signature',
    '-z',
    '--format=%H%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B',
    ...hashes.map(validHash),
    '--',
  ]);
  const fields = output.split('\0');
  const commits = new Map<string, MergeCommit>();
  for (let i = 0; i + 7 < fields.length; i += 8) {
    const [hash, author, email, authorDate, committer, committerEmail, date, message] =
      fields.slice(i, i + 8);
    commits.set(hash, {
      hash,
      author,
      email,
      authorDate,
      committer,
      committerEmail,
      date,
      message: message.trimEnd(),
    });
  }
  return hashes.map((hash) => {
    const commit = commits.get(hash);
    if (!commit) throw Error(`Unable to read commit ${hash}`);
    return commit;
  });
}

/** Match Graph's first-parent statistics, fetched only when a commit hover opens. */
export async function readCommitHoverStats(root: string, hash: string): Promise<MergeCommitStats> {
  const output = await git(
    root,
    [
      'show',
      '--format=',
      '--shortstat',
      '--diff-merges=first-parent',
      '--no-ext-diff',
      '--no-textconv',
      validHash(hash),
      '--',
    ],
    { env: { LC_ALL: 'C' } },
  );
  return {
    files: Number(output.match(/(\d+) files? changed/)?.[1] || 0),
    insertions: Number(output.match(/(\d+) insertions?\(\+\)/)?.[1] || 0),
    deletions: Number(output.match(/(\d+) deletions?\(-\)/)?.[1] || 0),
  };
}
