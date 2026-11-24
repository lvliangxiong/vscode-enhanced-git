import { readStashes } from './stashes';
import { git } from './client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function topologyIdentity(root: string) {
  const [refs, paths, stashes] = await Promise.all([
    git(root, ['show-ref', '--head', '--dereference']).catch((error) => {
      if (error.code === 1 && !error.stderr?.trim()) return ''; // unborn repository
      throw error;
    }),
    git(root, [
      'rev-parse',
      '--git-path',
      'HEAD',
      '--git-path',
      'shallow',
      '--git-path',
      'info/grafts',
    ]),
    readStashes(root),
  ]);
  const [headPath, shallowPath, graftsPath] = paths.trimEnd().split('\n');
  const [head, shallow, grafts] = await Promise.all(
    [headPath, shallowPath, graftsPath].map((file) =>
      readFile(resolve(root, file), 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      }),
    ),
  );
  return JSON.stringify([refs, head, shallow, grafts, stashes.revisions]);
}

// Only reference moves can reuse immutable parent links.
export function topologyCompatibility(identity: string) {
  const [refs, , shallow, grafts] = JSON.parse(identity);
  const replacements = refs
    .split('\n')
    .filter((line: string) =>
      line.includes(' ' + (process.env.GIT_REPLACE_REF_BASE || 'refs/replace/')),
    );
  return JSON.stringify([replacements, shallow, grafts]);
}
