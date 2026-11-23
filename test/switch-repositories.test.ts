import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import {
  repositoryBranches,
  runSwitchGroups,
  switchRepositoryBranch,
  switchRepositories,
} from '../src/extension/commands/switch-repositories';

test('multi-repository branch switching handles missing, occupied, remote and dirty branches', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-switch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  async function repo(name: string) {
    const root = path.join(dir, name);
    await fs.mkdir(root);
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Fixture']);
    await git(root, ['config', 'user.email', 'fixture@example.com']);
    await fs.writeFile(path.join(root, 'file'), 'base\n');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'base']);
    return root;
  }
  const a = await repo('a'),
    b = await repo('b');
  await git(a, ['branch', 'topic']);
  assert.deepEqual(
    (await repositoryBranches(a)).map((b) => b.name),
    ['main', 'topic'],
  );
  assert.match(await switchRepositoryBranch(a, 'topic'), /Switched/);
  assert.equal((await git(a, ['symbolic-ref', '--short', 'HEAD'])).trim(), 'topic');
  assert.match(await switchRepositoryBranch(a, 'topic'), /Already/);
  await assert.rejects(switchRepositoryBranch(b, 'topic'), /does not exist/);
  await git(a, ['switch', 'main']);
  const other = path.join(dir, 'other worktree');
  await git(a, ['worktree', 'add', other, 'topic']);
  const hash = (await git(a, ['rev-parse', 'topic'])).trim();
  assert.match(await switchRepositoryBranch(a, 'topic'), /detached/);
  await assert.rejects(git(a, ['symbolic-ref', 'HEAD']));
  assert.equal((await git(a, ['rev-parse', 'HEAD'])).trim(), hash);
  assert.equal((await git(other, ['symbolic-ref', '--short', 'HEAD'])).trim(), 'topic');
  await git(b, ['remote', 'add', 'origin', a]);
  await git(b, ['fetch', 'origin']);
  assert.match(await switchRepositoryBranch(b, 'topic'), /tracking origin\/topic/);
  assert.equal((await git(b, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim(), 'origin/topic');
  await fs.writeFile(path.join(other, 'file'), 'topic\n');
  await git(other, ['add', '.']);
  await git(other, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'topic']);
  await fs.writeFile(path.join(a, 'file'), 'dirty\n');
  await assert.rejects(switchRepositoryBranch(a, 'topic'), /overwritten/);
  assert.equal(await fs.readFile(path.join(a, 'file'), 'utf8'), 'dirty\n');
  await git(b, ['update-ref', 'refs/remotes/one/ambiguous', hash]);
  await git(b, ['update-ref', 'refs/remotes/two/ambiguous', hash]);
  await assert.rejects(switchRepositoryBranch(b, 'ambiguous'), /Multiple remote/);
});

test('command exposes branch union, reports every repository and releases write locks', async () => {
  const messages: string[] = [];
  let accept: () => void, hide: () => void, change: (value: string) => void;
  let disposed = 0;
  const listener = () => ({
    dispose() {
      disposed++;
    },
  });
  const picker: any = {
    items: [],
    selectedItems: [],
    value: '',
    onDidChangeValue(fn) {
      change = fn;
      return listener();
    },
    onDidAccept(fn) {
      accept = fn;
      return listener();
    },
    onDidHide(fn) {
      hide = fn;
      return listener();
    },
    show() {
      change('missing');
      assert.ok(this.items.some((item) => item.label === 'missing'));
      this.selectedItems = [{ label: 'missing' }];
      accept();
    },
    hide() {
      hide();
    },
    dispose() {
      disposed++;
    },
  };
  const vscode: any = {
    ProgressLocation: { Notification: 15 },
    window: {
      createQuickPick: () => picker,
      showInformationMessage: (s) => messages.push(s),
      showErrorMessage: (s) => messages.push(s),
      withProgress: (_, fn) => fn({ report() {} }),
    },
  };
  const locks = new Set(['/busy']);
  await switchRepositories(vscode, async () => ['/busy', '/not-a-repository'], locks);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /already running/);
  assert.match(messages[1], /not-a-repository/);
  assert.deepEqual([...locks], ['/busy']);
  assert.equal(disposed, 4);
});

test('checkout overlaps independent repositories but serializes related worktrees', async () => {
  const groups = new Map([
    ['A', ['a1', 'a2']],
    ['B', ['b']],
    ['C', ['c']],
    ['D', ['d']],
    ['E', ['e']],
  ]);
  const started: string[] = [];
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const jobs = runSwitchGroups(groups, async (root) => {
    started.push(root);
    await gate;
  });
  assert.deepEqual(started, ['a1', 'b', 'c', 'd']);
  release();
  await jobs;
  assert.deepEqual(started.slice(4).sort(), ['a2', 'e']);
});
