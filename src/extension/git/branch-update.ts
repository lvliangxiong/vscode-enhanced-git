import type { Branch } from '../../shared/model';
import { git } from './client';

interface Worktree {
  path: string;
  branch?: string;
}

export async function listWorktrees(root: string): Promise<Worktree[]> {
  // NUL-delimited porcelain preserves spaces, newlines and non-ASCII paths.
  const output = await git(root, ['worktree', 'list', '--porcelain', '-z']);
  return output
    .split('\0\0')
    .filter(Boolean)
    .map((record) => {
      const fields = record.split('\0');
      const location = fields.find((field) => field.startsWith('worktree '));
      if (!location) throw Error('Missing path in Git worktree record');
      return {
        path: location.slice(9),
        branch: fields.find((field) => field.startsWith('branch '))?.slice(7),
      };
    });
}

export async function updateBranch(root: string, branch: Branch): Promise<string> {
  if (!branch.upstream) throw new Error('No upstream configured for this branch');
  const name = branch.ref.slice('refs/heads/'.length);
  const remote = (await git(root, ['config', '--get', `branch.${name}.remote`])).trim();
  const upstream = (await git(root, ['config', '--get', `branch.${name}.merge`])).trim();
  const worktrees = (await listWorktrees(root)).filter((tree) => tree.branch === branch.ref);

  if (!worktrees.length) {
    // Rebased updates unoccupied branches via a non-forced remote:local refspec.
    // Git checks fast-forward safety and refuses a concurrent checkout itself.
    return git(root, ['fetch', '--', remote, `${upstream}:${branch.ref}`]);
  }

  const results: string[] = [];
  for (const tree of worktrees) {
    try {
      const head = (await git(tree.path, ['symbolic-ref', '-q', 'HEAD'])).trim();
      if (head !== branch.ref) throw new Error('The checked-out branch changed; retry Update.');
      // Run beside the checked-out branch, never switch the invoking worktree.
      // Like Rebased's other-worktree path, failure is reported without abort/reset.
      await git(tree.path, ['fetch', '--', remote, upstream]);
      results.push(await git(tree.path, ['merge', 'FETCH_HEAD', '--ff-only']));
    } catch (error) {
      throw new Error(`Update failed for ${name} in worktree ${tree.path}.\n${error.message}`);
    }
  }
  return results.join('\n');
}
