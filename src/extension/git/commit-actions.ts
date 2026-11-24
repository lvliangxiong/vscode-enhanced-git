import { execFile } from 'node:child_process';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
import { git, validHash } from './client';
import { selectionDetails } from './changes';

// CopyRevisionNumberAction uses ascending log order and a space separator.
function revisionNumbers(hashes) {
  return [...hashes].reverse().map(validHash).join(' ');
}

async function createRef(root, hash, kind, options) {
  validHash(hash);
  if (!['branch', 'tag'].includes(kind)) throw Error('Unsupported reference type');
  const name = options.name;
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.includes('\0'))
    throw Error('Enter a valid name');
  await git(root, ['check-ref-format', `refs/${kind === 'branch' ? 'heads' : 'tags'}/${name}`]);
  if (kind === 'branch') {
    await git(root, ['check-ref-format', '--branch', name]);
    return git(
      root,
      options.checkout ? ['checkout', '-b', name, hash, '--'] : ['branch', '--', name, hash],
    );
  }
  // GitCreateTagAction in the log asks only for a name and creates a light tag.
  return git(root, ['-c', 'tag.gpgSign=false', 'tag', '--', name, hash]);
}

function run(root: string, args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', root, ...args],
      { env, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          error.message = stderr.toString() || error.message;
          reject(error);
        } else resolve(stdout);
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

// Rebased builds a patch from collectChanges/zipChanges, including non-adjacent
// selections. Build those exact before/after snapshots in a disposable index;
// never use or alter the business repository's index, worktree or object store.
async function createPatch(root, hashes) {
  const { files } = await selectionDetails(root, hashes);
  if (!files.length) throw Error('The selected commits have no changes to export');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-patch-'));
  try {
    const objects = (
      await git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
    ).trim();
    const format = (await git(root, ['rev-parse', '--show-object-format'])).trim();
    await git(directory, ['init', '--bare', `--object-format=${format}`]);
    const env = {
      ...process.env,
      GIT_INDEX_FILE: path.join(directory, 'patch-index'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(objects),
    };
    async function tree(changes, side) {
      await run(directory, ['read-tree', '--empty'], env);
      const entries: string[] = [];
      for (const change of changes) {
        const revision = change[side];
        if (!revision) continue;
        const raw = await git(root, [
          'ls-tree',
          '-z',
          revision.hash,
          '--',
          `:(literal)${revision.path}`,
        ]);
        const match = raw.match(/^(\d+) (blob|commit) ([a-f0-9]+)\t/);
        if (!match) throw Error(`File unavailable at selected revision: ${revision.path}`);
        entries.push(`${match[1]} ${match[3]}\t${revision.path}\0`);
      }
      await run(directory, ['update-index', '-z', '--index-info'], env, entries.join(''));
      return (await run(directory, ['write-tree'], env)).toString().trim();
    }
    // Independent histories can legitimately have duplicate paths in Rebased.
    // Export those changes separately rather than silently dropping an entry.
    const duplicate = ['before', 'after'].some((side) => {
      const paths = files.flatMap((file) => (file[side] ? [file[side].path] : []));
      return new Set(paths).size !== paths.length;
    });
    const patches: Buffer[] = [];
    for (const group of duplicate ? files.map((file) => [file]) : [files]) {
      const before = await tree(group, 'before'),
        after = await tree(group, 'after');
      patches.push(
        await run(
          directory,
          [
            'diff',
            '--binary',
            '--full-index',
            '--no-ext-diff',
            '--no-textconv',
            '-M',
            before,
            after,
            '--',
          ],
          env,
        ),
      );
    }
    return Buffer.concat(patches);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export { revisionNumbers, createRef, createPatch };
