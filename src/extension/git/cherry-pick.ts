import fs from 'node:fs/promises';
import path from 'node:path';
import { git, validHash } from './client';

export interface CherryPickPlan {
  hashes: string[];
  head: string;
  branch: string;
  subjects: string[];
}
async function operationState(root: string) {
  const directory = (await git(root, ['rev-parse', '--absolute-git-dir'])).replace(/\r?\n$/, '');
  const exists = async (name: string) => {
    try {
      await fs.stat(path.join(directory, name));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };
  const [cherry, merge, rebase, apply, revert, sequencer] = await Promise.all(
    [
      'CHERRY_PICK_HEAD',
      'MERGE_HEAD',
      'rebase-merge',
      'rebase-apply',
      'REVERT_HEAD',
      'sequencer',
    ].map(exists),
  );
  let picking = cherry;
  if (sequencer && !picking) {
    const todo = await fs
      .readFile(path.join(directory, 'sequencer/todo'), 'utf8')
      .catch((error) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
    picking = /^pick /m.test(todo);
  }
  return { picking, other: merge || rebase || apply || revert || (sequencer && !picking) };
}
export async function cherryPickPending(root: string): Promise<boolean> {
  return (await operationState(root)).picking;
}
async function checkout(root: string) {
  return {
    head: (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim(),
    branch: (await git(root, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')).trim(),
  };
}
async function requireReady(root: string) {
  const state = await operationState(root);
  if (state.picking)
    throw Error('A cherry-pick is already in progress. Continue, Skip or Abort it first.');
  if (state.other)
    throw Error('Finish the existing merge, rebase or revert before cherry-picking.');
  if ((await git(root, ['status', '--porcelain', '--untracked-files=no'])).trim())
    throw Error('Commit or stash tracked local changes before cherry-picking.');
}
export async function prepareCherryPick(root: string, hashes: string[]): Promise<CherryPickPlan> {
  if (!Array.isArray(hashes) || !hashes.length) throw Error('Select commits to cherry-pick');
  const ordered = [...new Set(hashes)].map(validHash).reverse();
  await requireReady(root);
  const current = await checkout(root);
  if (!current.branch) throw Error('Check out a branch before cherry-picking (HEAD is detached).');
  const raw = await git(root, [
    'log',
    '--no-walk=unsorted',
    '--format=%H%x00%P%x00%s',
    ...ordered,
    '--',
  ]);
  const records = new Map(
    raw
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, parents, subject] = line.split('\0');
        return [hash, { parents, subject }];
      }),
  );
  for (const hash of ordered) {
    const entry = records.get(hash);
    if (!entry) throw Error(`Commit not found: ${hash}`);
    if (entry.parents.trim().split(/\s+/).filter(Boolean).length > 1)
      throw Error(
        `Merge commit ${hash.slice(0, 8)} requires a mainline parent; it cannot be cherry-picked here yet.`,
      );
  }
  return {
    ...current,
    hashes: ordered,
    subjects: ordered.map((hash) => records.get(hash).subject),
  };
}
export async function executeCherryPick(root: string, plan: CherryPickPlan) {
  await requireReady(root);
  const current = await checkout(root);
  if (current.head !== plan.head || current.branch !== plan.branch)
    throw Error(
      'The target branch or HEAD changed. Select Cherry-pick again to confirm the new target.',
    );
  await git(root, ['-c', 'core.editor=true', 'cherry-pick', ...plan.hashes.map(validHash)]);
}
export async function recoverCherryPick(root: string, action: 'continue' | 'skip' | 'abort') {
  if (!['continue', 'skip', 'abort'].includes(action))
    throw Error('Unsupported cherry-pick action');
  const state = await operationState(root);
  if (!state.picking || state.other) throw Error('No recoverable cherry-pick is in progress.');
  await git(root, ['-c', 'core.editor=true', 'cherry-pick', `--${action}`]);
}
