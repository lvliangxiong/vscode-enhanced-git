import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/extension/git/client';
import { historyThrough } from '../src/extension/git/history';
import { resolveLogDestination } from '../src/extension/git/navigation';
import { pickLogDestination } from '../src/extension/commands/go-to';

async function fixture(run: (root: string, hashes: string[]) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-go-to-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    const hashes: string[] = [];
    for (let i = 0; i < 4; i++) {
      await git(root, [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        `commit ${i}`,
      ]);
      hashes.push((await git(root, ['rev-parse', 'HEAD'])).trim());
    }
    await git(root, ['branch', 'topic', hashes[0]]);
    await git(root, ['update-ref', 'refs/remotes/origin/topic', hashes[1]]);
    await git(root, ['-c', 'tag.gpgsign=false', 'tag', '-a', 'v1', hashes[2], '-m', 'version']);
    await run(root, hashes);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('Go to resolves references and unloaded hash prefixes without filtering or checkout', async () => {
  await fixture(async (root, hashes) => {
    for (const [input, expected] of [
      ['HEAD', hashes[3]],
      ['topic', hashes[0]],
      ['top', hashes[0]],
      ['refs/heads/topic', hashes[0]],
      ['origin/topic', hashes[1]],
      ['v1', hashes[2]],
      [hashes[0], hashes[0]],
      [hashes[0].slice(0, 8).toUpperCase(), hashes[0]],
      [` \"${hashes[0]}\" `, hashes[0]],
    ])
      assert.equal(await resolveLogDestination(root, input), expected, input);
    const loaded = await historyThrough(root, '', 1, {}, hashes[0], 1);
    assert.ok(loaded.history.some((commit) => commit.hash === hashes[0]));
    assert.equal(loaded.reset, false);
    await assert.rejects(resolveLogDestination(root, 'no-such-branch'), /Enter a commit hash/);
    await assert.rejects(resolveLogDestination(root, 'abcd'), /not found or hash is ambiguous/);
    await assert.rejects(resolveLogDestination(root, 'main~1'), /Enter a commit hash/);
    assert.equal((await git(root, ['symbolic-ref', 'HEAD'])).trim(), 'refs/heads/main');
    assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), hashes[3]);
  });
});

test('branch heads resolve exact live refs without scanning tracking histories', async () => {
  await fixture(async (root, hashes) => {
    const client = require('../out/extension/git/client');
    const { branchHead } = require('../out/extension/git/refs');
    const originalGit = client.git;
    const commands: string[][] = [];
    client.git = (root, args, options) => {
      commands.push(args);
      return originalGit(root, args, options);
    };
    try {
      assert.equal(await branchHead(root, 'refs/heads/topic'), hashes[0]);
      assert.deepEqual(commands, [['show-ref', '--verify', '--hash', 'refs/heads/topic']]);
      await git(root, ['update-ref', 'refs/heads/topic', hashes[3]]);
      assert.equal(await branchHead(root, 'refs/heads/topic'), hashes[3]);
      assert.equal(await branchHead(root, 'refs/remotes/origin/topic'), hashes[1]);
      assert.equal(await branchHead(root, 'refs/tags/v1'), hashes[2], 'peel annotated tags');
      assert.equal(await branchHead(root, 'HEAD'), hashes[3]);
      await assert.rejects(branchHead(root, 'refs/heads/topic~1'), /no longer exists/);
      await git(root, ['update-ref', '-d', 'refs/heads/topic']);
      await assert.rejects(branchHead(root, 'refs/heads/topic'), /no longer exists/);
      assert.ok(
        commands.every((args) => !args.includes('for-each-ref') && !args.includes('remote')),
      );
    } finally {
      client.git = originalGit;
    }
  });
});

test('Go to picker accepts free hashes, retains invalid input and cancels without navigation', async () => {
  await fixture(async (root, hashes) => {
    const handlers: Record<string, (...args: any[]) => any> = {};
    let shown: () => void;
    let ready = new Promise<void>((resolve) => {
      shown = resolve;
    });
    let disposed = false;
    const picker: any = {
      value: '',
      selectedItems: [],
      busy: false,
      show: () => shown(),
      dispose: () => {
        disposed = true;
      },
      onDidHide: (fn) => {
        handlers.hide = fn;
        return { dispose() {} };
      },
      onDidAccept: (fn) => {
        handlers.accept = fn;
        return { dispose() {} };
      },
      onDidChangeValue: (fn) => {
        handlers.change = fn;
        return { dispose() {} };
      },
    };
    const vscode = { window: { createQuickPick: () => picker } } as any;
    let result = pickLogDestination(vscode, root);
    await ready;
    assert.deepEqual(
      picker.items.map((item) => item.label),
      ['HEAD', 'main', 'topic', 'origin/topic', 'v1'],
    );
    picker.value = 'not-a-revision';
    handlers.change(picker.value);
    await handlers.accept();
    assert.equal(disposed, false);
    assert.equal(picker.enabled, true);
    assert.match(picker.title, /Enter a commit hash/);
    picker.value = hashes[0].slice(0, 8);
    handlers.change(picker.value);
    assert.equal(picker.items[0].value, picker.value);
    picker.selectedItems = [picker.items[0]];
    await handlers.accept();
    assert.equal(await result, hashes[0]);
    assert.equal(disposed, true);
    ready = new Promise<void>((resolve) => {
      shown = resolve;
    });
    result = pickLogDestination(vscode, root);
    await ready;
    handlers.hide();
    assert.equal(await result, undefined);
  });
});

test('toolbar navigation response preserves filters and ignores superseded requests', async () => {
  const { createLogStore } = await import('../src/webview/state/log');
  const { receiveLogMessage } = await import('../src/webview/log/messages');
  const store = createLogStore();
  store.setState({ historyRequest: 8, ref: 'refs/heads/main' });
  const navigated: string[] = [];
  const context = {
    store,
    actions: {
      commits: { navigateToRevision: (hash: string) => navigated.push(hash) },
      history: {
        applyFilters() {
          throw Error('Go to must not apply a branch filter');
        },
      },
    },
  } as unknown as import('../src/webview/log/context').LogContext;
  receiveLogMessage(context, { type: 'goTo', target: 'destination', requestId: 8 });
  assert.deepEqual(navigated, ['destination']);
  assert.equal(store.getState().ref, 'refs/heads/main');
  receiveLogMessage(context, { type: 'goTo', target: 'old-destination', requestId: 7 });
  assert.equal(navigated.length, 1);
});
