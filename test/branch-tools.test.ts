import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { flushSync } from 'react-dom';
import { createBranchControllerFixture } from './helpers/branch-controller';
import { git } from '../src/extension/git/client';
import { branchBatchAction } from '../src/extension/git/actions';
import { runBranchTool } from '../src/extension/commands/branch-tools';

test('branch rail follows selection, toggles each favorite and expands nested groups', async () => {
  const fixture = createBranchControllerFixture({
    branches: [
      {
        name: 'main',
        ref: 'main',
        current: true,
        group: 'Local',
        upstream: 'origin/main',
        behind: 0,
      },
      { name: 'topic/one', ref: 'topic', group: 'Local', upstream: 'origin/topic', behind: 0 },
      { name: 'plain', ref: 'plain', group: 'Local' },
      { name: 'origin/remote', ref: 'remote', group: 'Remote' },
      { name: 'tag', ref: 'tag', group: 'Tags' },
    ],
    favorites: new Set(['topic']),
    treeOpen: new Map([['Favorite', true]]),
  });
  const { document, store, set, messages } = fixture;
  const button = (action: string) =>
    document.getElementById('branch-' + action) as HTMLButtonElement;
  const click = (action: string) => flushSync(() => button(action).click());
  const select = (...refs: string[]) =>
    set({ selectedBranchRefs: new Set(refs), branchToolsBusy: false });
  try {
    assert.equal(button('new').disabled, true);
    assert.equal(button('fetch').disabled, true);
    set({ repositoryRemotes: ['origin'] });
    select('HEAD');
    assert.equal(button('new').disabled, false);
    assert.equal(button('delete').disabled, true);
    assert.equal(button('favorite').disabled, true);
    assert.equal(button('update').disabled, false);
    click('update');
    assert.deepEqual(messages.at(-1).refs, ['main']);
    select('HEAD', 'main', 'topic');
    click('update');
    assert.deepEqual(messages.at(-1).refs, ['main', 'topic']);
    set({ branches: store.getState().branches.map((branch) => ({ ...branch, current: false })) });
    select('HEAD');
    assert.equal(button('update').disabled, true, 'detached HEAD cannot be updated');
    set({
      branches: store
        .getState()
        .branches.map((branch) => ({ ...branch, current: branch.ref === 'main' })),
    });
    select('main');
    assert.equal(button('compare').disabled, true);
    for (const counts of [{ behind: 0, ahead: 0 }, { behind: 0, ahead: 3 }, {}]) {
      set({
        branches: store
          .getState()
          .branches.map((branch) =>
            branch.ref === 'plain'
              ? { name: 'plain', ref: 'plain', group: 'Local', ...counts }
              : branch,
          ),
      });
      select('plain');
      assert.equal(
        button('update').disabled,
        false,
        'cached tracking and counts do not gate Update',
      );
      click('update');
      assert.deepEqual(messages.at(-1), {
        type: 'branchBatchAction',
        action: 'update',
        refs: ['plain'],
        toolbar: true,
      });
      assert.equal(
        button('update').disabled,
        true,
        'in-flight operations still disable the button',
      );
    }
    for (const action of ['new', 'update', 'delete', 'compare']) {
      select('topic');
      click(action);
      assert.equal(
        messages.at(-1).type,
        action === 'compare'
          ? 'branchCompareCurrent'
          : action === 'new'
            ? 'branchTool'
            : 'branchBatchAction',
      );
      if (action === 'new') {
        assert.equal(messages.at(-1).ref, 'topic');
        const count = messages.length;
        click('new');
        assert.equal(messages.length, count);
      }
    }
    select('tag');
    assert.equal(button('update').disabled, true);
    assert.equal(button('compare').disabled, false);
    click('compare');
    assert.equal(messages.at(-1).type, 'branchCompareCurrent');
    assert.deepEqual(messages.at(-1).refs, ['tag']);
    select('topic', 'plain');
    assert.equal(button('new').disabled, true);
    assert.equal(button('update').disabled, false);
    select('topic', 'remote');
    assert.equal(button('update').disabled, true);
    select('topic', 'plain');
    click('favorite');
    assert.deepEqual(
      [...store.getState().favorites],
      ['plain'],
      'mixed selection inverts each favorite like Rebased',
    );
    assert.equal(button('expansion').title, 'Collapse All');
    click('expansion');
    const groups = () => [...document.querySelectorAll<HTMLDetailsElement>('#branches details')];
    assert.ok(groups().every((group) => !group.open));
    assert.equal(store.getState().treeOpen.get('Local/topic'), false);
    assert.equal(button('expansion').title, 'Expand All');
    assert.equal(button('expansion').firstElementChild.className, 'rebased-icon rebased-expand');
    click('expansion');
    assert.ok(groups().every((group) => group.open));
    assert.equal(store.getState().treeOpen.get('Local/topic'), true);
    assert.equal(button('expansion').title, 'Collapse All');
    assert.equal(button('expansion').disabled, false);
    set({ branches: [] });
    assert.equal(button('expansion').disabled, true);
    select();
    click('fetch');
    assert.equal(messages.at(-1).action, 'fetch', 'fetch is independent of branch selection');
  } finally {
    await fixture.dispose();
  }
});

test('rail New Branch, Fetch and tag deletion use disposable repositories and preserve checkout when requested', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-rail-'));
  const root = path.join(temp, 'repo'),
    remote = path.join(temp, 'remote.git');
  await fs.mkdir(root);
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'base']);
    const base = (await git(root, ['rev-parse', 'HEAD'])).trim();
    await git(root, ['branch', 'topic']);
    await git(root, ['clone', '--bare', root, remote]);
    await git(root, ['remote', 'add', 'origin', remote]);
    await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'main only']);
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    let name: string | undefined = 'created',
      checkout = false;
    let validate: (value: string) => Promise<string | undefined>;
    const vscode: any = {
      workspace: { isTrusted: true },
      ProgressLocation: { Notification: 15 },
      window: {
        showInputBox: async (options) => {
          validate = options.validateInput;
          return name;
        },
        showQuickPick: async () => ({ checkout }),
        withProgress: async (_, run) => run(),
      },
    };
    await runBranchTool(vscode, root, 'new', 'refs/heads/topic');
    assert.equal((await git(root, ['rev-parse', 'created'])).trim(), base);
    assert.equal((await git(root, ['symbolic-ref', 'HEAD'])).trim(), 'refs/heads/main');
    assert.equal(await validate('main'), 'Branch already exists');
    assert.equal(await validate('-bad'), 'Enter a valid branch name');
    name = undefined;
    assert.equal(await runBranchTool(vscode, root, 'new', 'HEAD'), undefined);
    name = 'checked-out';
    checkout = true;
    await runBranchTool(vscode, root, 'new', 'refs/heads/topic');
    assert.equal((await git(root, ['symbolic-ref', 'HEAD'])).trim(), 'refs/heads/checked-out');
    await fs.writeFile(path.join(root, 'untracked.txt'), 'preserve');
    await runBranchTool(vscode, root, 'fetch');
    assert.equal((await git(root, ['rev-parse', 'origin/main'])).trim(), base);
    await git(root, ['push', 'origin', 'refs/heads/main:refs/heads/main']);
    await runBranchTool(vscode, root, 'fetch');
    assert.equal((await git(root, ['rev-parse', 'origin/main'])).trim(), head);
    assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), base);
    assert.equal(await fs.readFile(path.join(root, 'untracked.txt'), 'utf8'), 'preserve');
    await git(root, ['-c', 'tag.gpgSign=false', 'tag', 'v1']);
    await branchBatchAction(root, ['refs/tags/v1'], 'delete');
    assert.equal((await git(root, ['tag', '--list', 'v1'])).trim(), '');
    await assert.rejects(
      branchBatchAction(root, ['refs/heads/checked-out'], 'delete'),
      /checked-out/,
    );
    vscode.workspace.isTrusted = false;
    await assert.rejects(runBranchTool(vscode, root, 'fetch'), /Trust this workspace/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
