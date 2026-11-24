import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const client = require('../out/extension/git/client');
const { createPathIndexStore } = require('../out/extension/git/path-index-store');
const { historyIdentity } = require('../out/extension/git/history-identity');
const { createHistoryCache } = require('../out/extension/git/history-cache');
const { log } = require('../out/extension/git/history');

test('private incremental path index matches Git across rename, merge, literal paths and ref changes', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-git-path-index-'));
  const root = path.join(base, 'repo with space');
  const storage = path.join(base, 'cache');
  const git = client.git;
  const reports: string[] = [];
  let indexedReads = 0;
  try {
    await fs.mkdir(root);
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    const commit = async (message: string) => {
      await git(root, ['add', '-A']);
      await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', message]);
      return (await git(root, ['rev-parse', 'HEAD'])).trim();
    };
    await fs.mkdir(path.join(root, 'dir'));
    await fs.writeFile(path.join(root, 'dir', 'original.txt'), 'original');
    await fs.writeFile(path.join(root, 'literal*.txt'), 'literal');
    const first = await commit('first');
    await git(root, ['checkout', '-b', 'topic']);
    await fs.rename(path.join(root, 'dir/original.txt'), path.join(root, 'dir/renamed.txt'));
    await commit('rename');
    await git(root, ['checkout', 'main']);
    await fs.writeFile(path.join(root, 'other.txt'), 'other');
    await commit('unrelated');
    await git(root, ['-c', 'commit.gpgsign=false', 'merge', '--no-ff', 'topic', '-m', 'merge']);
    // Existing alternate graphs must not leave our chain referring to missing files.
    await git(root, ['commit-graph', 'write', '--reachable', '--changed-paths', '--split']);
    const sourceGraphs = path.join(root, '.git/objects/info/commit-graphs');
    const sourceBefore = await Promise.all(
      (await fs.readdir(sourceGraphs))
        .sort()
        .map(async (name) => [name, await fs.readFile(path.join(sourceGraphs, name))]),
    );
    const store = createPathIndexStore(storage, (message) => reports.push(message));
    client.git = (...args) => {
      if (args[1].includes('log') && args[2]?.env?.GIT_OBJECT_DIRECTORY) indexedReads++;
      return git(...args);
    };
    const identity = await historyIdentity(root);
    const pending = store.prepare(root, identity);
    assert.strictEqual(store.prepare(root, identity), pending);
    await pending;
    assert(reports.at(-1)?.startsWith('Path index ready:'), reports.join('\n'));
    assert.deepEqual(
      await Promise.all(
        (await fs.readdir(sourceGraphs))
          .sort()
          .map(async (name) => [name, await fs.readFile(path.join(sourceGraphs, name))]),
      ),
      sourceBefore,
      'source repository graphs are never modified',
    );
    const snapshot = await createHistoryCache(undefined, store).snapshot(root);
    const check = async () => {
      for (const paths of [
        ['dir'],
        ['dir/original.txt'],
        ['dir/renamed.txt'],
        ['literal*.txt'],
        ['missing'],
        ['dir', 'other.txt'],
      ]) {
        for (const extra of [
          {},
          { firstParent: true },
          { hideMerges: true },
          { text: 'rename' },
          { sort: 'topological' },
        ]) {
          const filters = { paths, ...extra };
          assert.deepEqual(
            await log(root, '', 0, filters, undefined, 500, snapshot.context),
            await log(root, '', 0, filters),
            JSON.stringify(filters),
          );
        }
      }
    };
    await check();
    assert(indexedReads > 0, 'queries must actually use the private graph');
    await fs.unlink(path.join(root, 'dir/renamed.txt'));
    await commit('delete');
    await check(); // Old graph remains safe before the new layer is ready.
    await store.prepare(root, await historyIdentity(root));
    assert(reports.at(-1).startsWith('Path index ready:'));
    await check();
    await git(root, ['branch', '-D', 'topic']);
    await git(root, ['reset', '--hard', first]);
    await store.prepare(root, await historyIdentity(root));
    await check();
    const reopened = createPathIndexStore(storage, (message) => reports.push(message));
    await reopened.prepare(root, await historyIdentity(root));
    assert(
      reports.at(-1).startsWith('Path index ready:'),
      'persisted chain remains usable after restart',
    );
    // An unsupported writer or inaccessible storage cannot break path filtering.
    const blocked = path.join(base, 'file');
    await fs.writeFile(blocked, 'not a directory');
    const unavailable = createPathIndexStore(blocked);
    await unavailable.prepare(root, await historyIdentity(root));
    const args = ['log', '--format=%H', '--all', '--', 'dir'];
    assert.equal(await unavailable.read(root, args), await git(root, args));
  } finally {
    client.git = git;
    await fs.rm(base, { recursive: true, force: true });
  }
});
