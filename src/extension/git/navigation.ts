import { git } from './client';
import { refs, branchHead } from './refs';
import type { Branch } from '../../shared/model';

export function navigationRefs(branches: Branch[]): Branch[] {
  const rank = (branch: Branch) =>
    branch.current ? 0 : branch.group === 'Local' ? 1 : branch.group === 'Remote' ? 2 : 3;
  return [...branches].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// Rebased's jumpToRefOrHash prefers a matching reference before interpreting a hash.
export async function resolveLogDestination(root: string, input: string): Promise<string> {
  const value = input.trim();
  if (value === 'HEAD') return branchHead(root, value);
  const branches = navigationRefs(await refs(root));
  const branch =
    branches.find((branch) => branch.ref === value || branch.name === value) ||
    branches.find((branch) => branch.name.startsWith(value));
  if (value && branch) return branchHead(root, branch.ref);
  const hash = value.replace(/^[()'"`]+|[()'"`]+$/g, '');
  if (!/^[a-fA-F0-9]{4,64}$/.test(hash)) throw Error('Enter a commit hash, branch or tag name');
  try {
    return (await git(root, ['rev-parse', '--verify', `${hash.toLowerCase()}^{commit}`])).trim();
  } catch {
    throw Error('Commit not found or hash is ambiguous. Enter a longer hash and try again.');
  }
}
