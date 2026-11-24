import type { Branch } from '../../shared/model';
import { git } from './client';
async function refs(root: string, { tracking = true } = {}): Promise<Branch[]> {
  const [raw, remoteText] = await Promise.all([
    git(root, [
      'for-each-ref',
      `--format=%(refname)%00%(HEAD)%00%(upstream)%00${tracking ? '%(upstream:track)' : ''}%00%(symref)`,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]),
    git(root, ['remote']),
  ]);
  const remotes = remoteText
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, head, upstream, track, symbolic] = line.split('\0');
      const group: Branch['group'] = ref.startsWith('refs/heads/')
        ? 'Local'
        : ref.startsWith('refs/remotes/')
          ? 'Remote'
          : 'Tags';
      const name = ref.replace(/^refs\/(heads|remotes|tags)\//, '');
      const remote =
        group === 'Remote' ? remotes.find((remote) => name.startsWith(remote + '/')) : undefined;
      return {
        ref,
        name,
        upstream,
        current: head === '*',
        group,
        remote,
        symbolic,
        ahead: Number(track.match(/ahead (\d+)/)?.[1] || 0),
        behind: Number(track.match(/behind (\d+)/)?.[1] || 0),
      };
    })
    .filter((branch) => !branch.symbolic);
}

/** Prefer an exact tag at a detached HEAD, otherwise display the immutable short commit id. */
async function headLabel(root: string, branches: Branch[]): Promise<string> {
  const current = branches.find((branch) => branch.current);
  if (current) return current.name;
  try {
    return (await git(root, ['describe', '--tags', '--exact-match', 'HEAD'])).trim();
  } catch {
    try {
      return (await git(root, ['rev-parse', '--verify', '--short=8', 'HEAD^{commit}'])).trim();
    } catch {
      return '';
    }
  }
}

function validRef(ref) {
  if (
    typeof ref !== 'string' ||
    !/^refs\/(heads|remotes|tags)\//.test(ref) ||
    /\s/.test(ref) ||
    ref.includes('\0')
  )
    throw new Error('Invalid branch reference');
  return ref;
}

async function branchHead(root: string, ref: string): Promise<string> {
  // Resolve the exact live ref without enumerating branches or counting tracking
  // divergence. Those counts can walk a large history just to locate one row.
  if (ref === 'HEAD') return (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  validRef(ref);
  let hash: string;
  try {
    hash = (await git(root, ['show-ref', '--verify', '--hash', ref])).trim();
  } catch {
    throw new Error('Branch no longer exists');
  }
  return ref.startsWith('refs/tags/')
    ? (await git(root, ['rev-parse', '--verify', `${hash}^{commit}`])).trim()
    : hash;
}

async function readAuthors(root: string) {
  const raw = await git(root, ['log', '--all', '--format=%an%x00%ae']);
  return [...new Set(raw.trimEnd().split('\n').filter(Boolean))].map((line) => {
    const [name, email] = line.split('\0');
    return { name, email };
  });
}

function relativePath(root: string, value: string) {
  const path = require('node:path');
  if (typeof value !== 'string' || value.includes('\0') || value.split(/[\\/]/).includes('..'))
    throw Error('Paths must stay inside the repository');
  const relative = path.isAbsolute(value) ? path.relative(root, value) : value;
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))
    throw Error('Paths must stay inside the repository');
  return relative || '.';
}

async function pathChildren(root: string, directory = '') {
  const fs = require('node:fs/promises'),
    path = require('node:path'),
    relative = relativePath(root, directory);
  const target = path.resolve(root, relative),
    [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  const inside = path.relative(realRoot, realTarget);
  if (inside === '..' || inside.startsWith('../') || path.isAbsolute(inside))
    throw Error('Directory is outside the repository');
  return (await fs.readdir(target, { withFileTypes: true }))
    .filter((e) => e.name !== '.git')
    .map((e) => ({
      name: e.name,
      directory: e.isDirectory(),
      path:
        path.posix.join(relative === '.' ? '' : relative, e.name) + (e.isDirectory() ? '/' : ''),
    }))
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
}

export { headLabel, refs, validRef, branchHead, readAuthors, relativePath, pathChildren };
