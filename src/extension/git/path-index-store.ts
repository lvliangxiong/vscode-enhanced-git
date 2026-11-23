import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { git } from './client';

const graphConfig = [
  '-c',
  'core.commitGraph=true',
  '-c',
  'commitGraph.readChangedPaths=true',
  '-c',
  'commitGraph.changedPathsVersion=1',
];
type Entry = { identity: string; ready?: NodeJS.ProcessEnv; pending: Promise<void> };

// Rebased stores exact per-parent changed paths in its Java index. Here Git's
// changed-path Bloom filters prune the native path walk, retaining its merge,
// rename and pathspec semantics. All writes go to a private object-directory
// overlay; the real repository is an alternate used only for reading objects.
export function createPathIndexStore(
  storagePath?: string,
  report: (message: string) => void = () => {},
) {
  const directory = storagePath && path.join(storagePath, 'history-path-index');
  const entries = new Map<string, Entry>();
  let writes = Promise.resolve();

  async function retain(current: string) {
    const directories = await Promise.all(
      (await fs.readdir(directory))
        .filter((name) => /^[a-f0-9]{64}$/.test(name))
        .map(async (name) => ({ name, time: (await fs.stat(path.join(directory, name))).mtimeMs })),
    );
    directories.sort((a, b) => b.time - a.time);
    for (const { name } of directories.slice(3))
      if (name !== current)
        await fs.rm(path.join(directory, name), { recursive: true, force: true });
  }

  return {
    prepare(root: string, identity: string, force = false): Promise<void> {
      if (!directory) return Promise.resolve();
      const previous = entries.get(root);
      if (!force && previous?.identity === identity) return previous.pending;
      const entry: Entry = { identity, ready: previous?.ready, pending: undefined };
      entries.delete(root);
      entries.set(root, entry);
      while (entries.size > 3) entries.delete(entries.keys().next().value);
      entry.pending = writes = writes
        .catch(() => {})
        .then(async () => {
          const start = performance.now();
          const key = createHash('sha256').update(root).digest('hex');
          const folder = path.join(directory, key);
          const objectDirectory = path.join(folder, 'objects');
          try {
            if (entries.get(root) !== entry) return;
            const original = path.resolve(
              root,
              (await git(root, ['rev-parse', '--git-path', 'objects'])).trim(),
            );
            await fs.mkdir(objectDirectory, { recursive: true, mode: 0o700 });
            const graphs = path.join(objectDirectory, 'info', 'commit-graphs');
            const hasOwnChain = await fs.access(path.join(graphs, 'commit-graph-chain')).then(
              () => true,
              () => false,
            );
            const env = {
              GIT_OBJECT_DIRECTORY: objectDirectory,
              GIT_ALTERNATE_OBJECT_DIRECTORIES: [
                JSON.stringify(original),
                process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES,
              ]
                .filter(Boolean)
                .join(path.delimiter),
              GIT_NO_LAZY_FETCH: '1',
            };
            await git(
              root,
              [
                ...graphConfig,
                'commit-graph',
                'write',
                '--reachable',
                '--changed-paths',
                force || !hasOwnChain ? '--split=replace' : '--split',
                '--expire-time=now',
              ],
              { env },
            );
            const chain = (await fs.readFile(path.join(graphs, 'commit-graph-chain'), 'utf8'))
              .trim()
              .split('\n');
            let bytes = 0;
            for (const hash of chain) {
              if (!/^[a-f0-9]{40,64}$/.test(hash)) throw Error('Invalid commit-graph chain');
              bytes += (await fs.stat(path.join(graphs, `graph-${hash}.graph`))).size;
            }
            if (bytes > 128 * 1024 * 1024) throw Error('Path index exceeds 128 MiB');
            await git(root, [...graphConfig, 'commit-graph', 'verify'], { env });
            if (entries.get(root) === entry) entry.ready = env;
            const now = new Date();
            await fs.utimes(folder, now, now);
            await retain(key);
            report(
              `Path index ready: ${Math.round(performance.now() - start)} ms, ${bytes} bytes, ${chain.length} layers`,
            );
          } catch (error) {
            entry.ready = undefined;
            // An interrupted or incompatible index is disposable. Ordinary Git
            // queries remain available; the next changed snapshot can retry.
            await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
            report(`Path index unavailable; using Git without the private index: ${error.message}`);
          }
        });
      return entry.pending;
    },
    async read(root: string, args: string[], maxBuffer = Infinity) {
      const entry = entries.get(root);
      if (entry?.ready) {
        try {
          return await git(root, [...graphConfig, ...args], { env: entry.ready, maxBuffer });
        } catch {
          entry.ready = undefined;
        }
      }
      return git(root, args, { maxBuffer });
    },
  };
}
