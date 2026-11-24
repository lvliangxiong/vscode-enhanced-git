import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git } from '../src/extension/git/client';
import {
  historyLoading,
  historyRequestLimit,
  loadHistoryPage,
  firstBlockLimit,
} from '../src/extension/git/history-page';

test('initial count is independent of page size, resets with filters/settings, and only config enables all', () => {
  assert.equal(firstBlockLimit(0), 200);
  assert.equal(firstBlockLimit(5000), 200);
  assert.equal(firstBlockLimit(50), 50);
  const settings = historyLoading(4000, 200);
  assert.equal(historyRequestLimit(settings, { type: 'init', limit: 500 }, 0), 4000);
  assert.equal(historyRequestLimit(settings, { type: 'repo', limit: 9000 }, 9000), 4000);
  assert.equal(historyRequestLimit(settings, { limit: 4200 }, 4000), 4200);
  assert.equal(historyRequestLimit(settings, { limit: 4200 }, 4200), 4200);
  assert.equal(historyRequestLimit(settings, { limit: 4200, resetLimit: true }, 4200), 4000);
  assert.equal(historyRequestLimit(historyLoading(10, 500), { type: 'init' }, 0), 10);
  assert.equal(historyRequestLimit(historyLoading(10, 500), { limit: 510 }, 10), 510);
  assert.equal(historyRequestLimit(settings, { initialCount: 0, limit: 0 }, 20000), 4000);
  assert.equal(historyRequestLimit(settings, { initialCount: 500, limit: 8000 }, 8000), 4000);
  assert.equal(historyRequestLimit(historyLoading(0, 200), { limit: 6000 }, 4000), 0);
  assert.equal(historyRequestLimit(settings, { limit: 0 }, 0), 4000);
  assert.equal(historyRequestLimit(settings, { limit: 999999 }, 4000), 4200);
  for (const value of [-1, NaN, Infinity, 'all', null, 1.5])
    assert.equal(historyLoading(value).initialCount, 500);
});

test('finite and unlimited history retain filtering, hash search, signatures, ranges and navigation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-git-history-settings-'));
  try {
    await git(root, ['init', '-b', 'main']);
    const empty = await loadHistoryPage(root, '', 0);
    assert.deepEqual(empty.history, []);
    assert.equal(empty.hasMore, false);
    let stream = '';
    for (let i = 0; i < 3505; i++) {
      const message = `entry ${i}`;
      stream += `commit refs/heads/main\nmark :${i + 1}\ncommitter Test <test@example.com> ${1600000000 + i} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n${i ? 'from :' + i + '\n' : ''}\n`;
    }
    const imported = spawnSync('git', ['-C', root, 'fast-import', '--quiet'], { input: stream });
    assert.equal(imported.status, 0, imported.stderr.toString());
    const first = await loadHistoryPage(root, '', 3200);
    assert.equal(
      first.history.length,
      3200,
      'configured initial count may exceed the old 3000 cap',
    );
    assert.equal(first.hasMore, true);
    const next = await loadHistoryPage(root, '', 3400);
    assert.equal(next.history.length, 3400);
    assert.equal(next.history[0].hash, first.history[0].hash);
    const last = await loadHistoryPage(root, '', 3505);
    assert.equal(last.hasMore, false, 'an exact final page has no continuation');
    const all = await loadHistoryPage(root, '', 0);
    assert.equal(all.history.length, 3505);
    assert.equal(all.historyLimit, 0);
    assert.equal(all.hasMore, false);
    const filtered = await loadHistoryPage(root, 'refs/heads/main', 0, { text: 'entry 34' });
    assert.deepEqual(
      filtered.history,
      all.history.filter((c) => c.subject.includes('entry 34')),
    );
    assert.equal(filtered.hasMore, false);
    const signed = await loadHistoryPage(root, '', 0, { showSignature: true, text: 'entry 3504' });
    assert.equal(signed.history.length, 1);
    assert.equal(signed.history[0].signature, 'N');
    const target = all.history[3100].hash;
    const hash = await loadHistoryPage(root, '', 0, { text: target.slice(0, 12) });
    assert.deepEqual(
      hash.history.map((c) => c.hash),
      [target],
    );
    const range = `${all.history[300].hash}..${all.history[0].hash}`;
    const ranged = await loadHistoryPage(root, range, 0);
    assert.equal(ranged.history.length, 300);
    assert.equal(ranged.hasMore, false);
    assert.equal((await loadHistoryPage(root, range, 17)).history.length, 17);
    const jump = await loadHistoryPage(root, 'refs/heads/main', 0, { text: 'entry 3504' }, target);
    assert.equal(jump.reset, true);
    assert.equal(jump.history.length, 3505);
    assert.equal(jump.historyLimit, 0);
    assert.equal(jump.hasMore, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
