import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { git } = require('../out/extension/git/client');
const {
  prepareCherryPick,
  executeCherryPick,
  cherryPickPending,
  recoverCherryPick,
} = require('../out/extension/git/cherry-pick');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-cherry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  const write = (file, text) => fs.writeFile(path.join(root, file), text);
  const commit = async (message) => {
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', message]);
    return (await git(root, ['rev-parse', 'HEAD'])).trim();
  };
  await write('base', 'base\n');
  const base = await commit('base');
  await git(root, ['switch', '-c', 'topic']);
  await write('one', 'first\n');
  const first = await commit('first');
  await write('unselected', 'omit me\n');
  const middle = await commit('middle');
  await write('one', 'first\nsecond\n');
  const second = await commit('second');
  await git(root, ['switch', 'main']);
  return { root, write, commit, base, first, middle, second };
}
test('both single and non-adjacent multiple picks preserve selection order and current branch', async (t) => {
  const { root, first, second, base } = await fixture(t);
  const plan = await prepareCherryPick(root, [second, first, first]);
  assert.deepEqual(plan.hashes, [first, second]);
  await executeCherryPick(root, plan);
  assert.equal((await git(root, ['symbolic-ref', '--short', 'HEAD'])).trim(), 'main');
  assert.deepEqual(
    (await git(root, ['log', '--format=%s', '--reverse', `${base}..HEAD`])).trim().split('\n'),
    ['first', 'second'],
  );
  assert.equal(await fs.readFile(path.join(root, 'one'), 'utf8'), 'first\nsecond\n');
  await assert.rejects(fs.stat(path.join(root, 'unselected')));
  assert.equal(await cherryPickPending(root), false);
  await git(root, ['switch', '-c', 'single', base]);
  await executeCherryPick(root, await prepareCherryPick(root, [first]));
  assert.equal(await fs.readFile(path.join(root, 'one'), 'utf8'), 'first\n');
});
test('conflict in a later pick retains the sequence and Abort restores its starting HEAD', async (t) => {
  const { root, write, commit, first, second } = await fixture(t);
  await write('one', 'different\n');
  const start = await commit('conflicting target');
  // Pick the unrelated middle commit successfully, then stop on the conflict.
  const middle = (await git(root, ['rev-parse', 'topic^'])).trim();
  await assert.rejects(
    executeCherryPick(root, await prepareCherryPick(root, [second, first, middle])),
  );
  assert.equal(await cherryPickPending(root), true);
  assert.equal((await git(root, ['log', '-1', '--format=%s'])).trim(), 'middle');
  await assert.rejects(prepareCherryPick(root, [first]), /already in progress/);
  await recoverCherryPick(root, 'abort');
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), start);
  assert.equal(await fs.readFile(path.join(root, 'one'), 'utf8'), 'different\n');
  assert.equal((await git(root, ['status', '--porcelain'])).trim(), '');
  assert.equal(await cherryPickPending(root), false);
});
test('Continue resumes the remaining selected commits after conflict resolution', async (t) => {
  const { root, write, commit, first, middle } = await fixture(t);
  await write('one', 'different\n');
  await commit('conflict');
  await assert.rejects(executeCherryPick(root, await prepareCherryPick(root, [middle, first])));
  await assert.rejects(recoverCherryPick(root, 'continue'));
  await write('one', 'resolved\n');
  await git(root, ['add', 'one']);
  await recoverCherryPick(root, 'continue');
  assert.equal(await fs.readFile(path.join(root, 'unselected'), 'utf8'), 'omit me\n');
  assert.equal(await cherryPickPending(root), false);
  assert.deepEqual((await git(root, ['log', '-2', '--format=%s'])).trim().split('\n'), [
    'middle',
    'first',
  ]);
});
test('Skip handles an empty pick and then applies the rest of the selection', async (t) => {
  const { root, first, middle } = await fixture(t);
  await executeCherryPick(root, await prepareCherryPick(root, [first]));
  await assert.rejects(executeCherryPick(root, await prepareCherryPick(root, [middle, first])));
  assert.equal(await cherryPickPending(root), true);
  await recoverCherryPick(root, 'skip');
  assert.equal(await cherryPickPending(root), false);
  assert.equal(await fs.readFile(path.join(root, 'unselected'), 'utf8'), 'omit me\n');
});
test('preflight rejects tracked edits, merge commits and a changed target without changing HEAD', async (t) => {
  const { root, write, commit, first, second, base } = await fixture(t);
  await write('base', 'dirty\n');
  await assert.rejects(prepareCherryPick(root, [first]), /Commit or stash/);
  assert.equal(await fs.readFile(path.join(root, 'base'), 'utf8'), 'dirty\n');
  await write('base', 'base\n');
  const plan = await prepareCherryPick(root, [first]);
  await git(root, ['switch', '-c', 'changed']);
  await assert.rejects(executeCherryPick(root, plan), /target branch or HEAD changed/);
  await git(root, ['switch', 'main']);
  await write('main-only', 'main\n');
  await commit('main');
  await git(root, ['merge', '--no-ff', 'topic', '-m', 'merge']);
  const merge = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['switch', '-c', 'clean', base]);
  await assert.rejects(prepareCherryPick(root, [merge, first]), /mainline parent/);
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), base);
  await assert.rejects(prepareCherryPick(root, ['--all']));
  await assert.rejects(prepareCherryPick(root, ['f'.repeat(40)]));
  await assert.rejects(prepareCherryPick(root, []));
  await git(root, ['switch', '--detach', second]);
  await assert.rejects(prepareCherryPick(root, [first]), /detached/);
  await assert.rejects(recoverCherryPick(root, 'abort'), /No recoverable/);
});

test('shared command confirms the target, respects cancellation and routes Abort to the existing sequence', async (t) => {
  const { runCherryPick } = require('../out/extension/commands/cherry-pick');
  const { root, write, commit, first, base } = await fixture(t);
  let accept = false,
    recovery = 'abort';
  const dialogs = [];
  const vscode = {
    workspace: { isTrusted: true },
    ProgressLocation: { Notification: 1 },
    commands: { executeCommand: async () => {} },
    window: {
      showWarningMessage: async (message, options, action) => {
        dialogs.push({ message, options });
        return accept ? action : undefined;
      },
      showQuickPick: async (choices) => choices.find((choice) => choice.action === recovery),
      withProgress: async (_options, task) => task(),
    },
  };
  assert.equal(await runCherryPick(vscode, root, [first]), false);
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), base);
  assert.match(dialogs[0].message, /onto main/);
  assert.match(dialogs[0].options.detail, /first/);
  vscode.workspace.isTrusted = false;
  await assert.rejects(runCherryPick(vscode, root, [first]), /Trust/);
  vscode.workspace.isTrusted = true;
  await write('one', 'different\n');
  const target = await commit('conflict');
  accept = true;
  await assert.rejects(runCherryPick(vscode, root, [first]), /remains in progress/);
  assert.equal(await cherryPickPending(root), true);
  accept = false;
  assert.equal(await runCherryPick(vscode, root, []), false, 'Abort is confirmed separately');
  assert.equal(await cherryPickPending(root), true);
  accept = true;
  assert.equal(await runCherryPick(vscode, root, []), true);
  assert.equal(await cherryPickPending(root), false);
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), target);
});
