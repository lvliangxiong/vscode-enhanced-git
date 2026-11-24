import type { BranchActionOptions } from '../../shared/model';
import { git } from './client';
import { refs, validRef } from './refs';
import { selectedBranches } from './comparison';
import { listWorktrees, updateBranch } from './branch-update';
async function branchBatchAction(root, values, action) {
  if (!['delete', 'update'].includes(action)) throw Error('Unsupported batch action');
  const chosen = await selectedBranches(root, values);
  const worktrees = await listWorktrees(root);
  // Preflight the whole selection so a known invalid target cannot leave a partially applied batch.
  for (const branch of chosen) {
    if (branch.group === 'Tags' && action !== 'delete') throw Error('Select branches, not tags');
    if (
      action === 'delete' &&
      (branch.current || worktrees.some((tree) => tree.branch === branch.ref))
    )
      throw Error('Cannot delete a checked-out branch: ' + branch.name);
    if (action === 'delete' && branch.group === 'Local')
      await git(root, ['merge-base', '--is-ancestor', branch.ref, 'HEAD']).catch(() => {
        throw Error('Branch is not merged into HEAD: ' + branch.name);
      });
    if (action === 'update' && (branch.group !== 'Local' || !branch.upstream))
      throw Error('Tracking is not configured for ' + branch.name);
  }
  const completed: string[] = [];
  for (const branch of chosen) {
    try {
      await branchAction(root, branch.ref, action);
      completed.push(branch.name);
    } catch (error) {
      throw Error(
        `${action} failed for ${branch.name}. ${completed.length ? 'Completed: ' + completed.join(', ') + '. ' : ''}${error.message}`,
      );
    }
  }
  return completed;
}

async function branchAction(root, ref, action, options: BranchActionOptions = {}) {
  const branch = (await refs(root)).find((b) => b.ref === validRef(ref));
  if (!branch) throw new Error('Branch no longer exists');
  const name = branch.ref.replace(/^refs\/heads\//, '');
  if (action === 'checkout') {
    if (branch.group === 'Local') return git(root, ['switch', '--', name]);
    if (branch.group === 'Remote') {
      if (!options.name) throw Error('Enter a branch name');
      await git(root, ['check-ref-format', '--branch', options.name]);
      return git(root, ['switch', '-c', options.name, '--track', branch.ref]);
    }
    return git(root, ['switch', '--detach', branch.ref]);
  }
  if (branch.group === 'Tags') {
    const tag = branch.ref.slice('refs/tags/'.length);
    if (action === 'delete') return git(root, ['tag', '-d', '--', tag]);
    if (action === 'push' && options.remote)
      return git(root, ['push', '--', options.remote, branch.ref]);
    throw new Error('Unsupported tag action');
  }
  if (branch.group === 'Remote') {
    if (action !== 'delete') throw new Error('Unsupported remote branch action');
    if (await git(root, ['symbolic-ref', '-q', branch.ref]).catch(() => ''))
      throw new Error('Cannot delete remote HEAD');
    const names = (await git(root, ['remote']))
      .trim()
      .split('\n')
      .sort((a, b) => b.length - a.length);
    const remote = names.find((name) => branch.ref.startsWith(`refs/remotes/${name}/`));
    if (!remote) throw new Error('Remote configuration is missing');
    const target = branch.ref.slice(`refs/remotes/${remote}/`.length);
    await git(root, ['push', '--delete', '--', remote, target]);
    await git(root, ['fetch', '--prune', '--', remote]);
    return;
  }
  if (branch.group !== 'Local') throw new Error('This action requires a local branch');
  if (action === 'rename') {
    if (!options.name) throw Error('Enter a branch name');
    await git(root, ['check-ref-format', '--branch', options.name]);
    return git(root, ['branch', '-m', name, options.name]);
  }
  if (action === 'delete') {
    if (branch.current) throw new Error('Cannot delete the current branch');
    await git(root, ['merge-base', '--is-ancestor', branch.ref, 'HEAD']);
    return git(root, ['branch', '-d', '--', name]);
  }
  if (action === 'update') return updateBranch(root, branch);
  if (action === 'push') {
    let remote = options.remote,
      target = name;
    if (branch.upstream) {
      remote = (await git(root, ['config', '--get', `branch.${name}.remote`])).trim();
      target = (await git(root, ['config', '--get', `branch.${name}.merge`]))
        .trim()
        .replace(/^refs\/heads\//, '');
    }
    if (!remote || remote === '.') throw new Error('Select a remote repository to push');
    return git(root, [
      'push',
      ...(branch.upstream ? [] : ['--set-upstream']),
      '--',
      remote,
      `${branch.ref}:refs/heads/${target}`,
    ]);
  }
  throw new Error('Unsupported branch action');
}

export { branchBatchAction, branchAction };
