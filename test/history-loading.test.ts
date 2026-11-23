import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogControllerHarness } from './helpers/log-controller';
import { createRows } from '../src/shared/graph';

const fixture = (hash: string, parents: string[] = []) => ({
  hash,
  parents,
  subject: hash,
  decorations: '',
  date: '2020-01-01',
});

test('append preserves commit rows, focus owner and scroll; only changed graph tiles are replaced', async () => {
  const h = createLogControllerHarness();
  h.set({
    commits: [fixture('a', ['b']), fixture('b', ['c'])],
    selected: new Set(['b']),
    viewSettings: { 'highlight-me': false },
  });
  h.start();
  try {
    const [a, b] = h.list.querySelectorAll<HTMLElement>('.commit');
    const firstGraph = a.querySelector('.graph-cell'),
      secondGraph = b.querySelector('.graph-cell');
    h.set({ commits: [...h.store.getState().commits, fixture('c')] });
    assert.equal(h.list.querySelectorAll('.commit').length, 3);
    assert.equal(h.list.querySelectorAll('.commit')[0], a);
    assert.equal(h.list.querySelectorAll('.commit')[1], b);
    assert.equal(a.querySelector('.graph-cell'), firstGraph);
    assert.notEqual(b.querySelector('.graph-cell'), secondGraph);
    assert.equal(b.getAttribute('aria-selected'), 'true');
    assert.equal(h.list.scrollTop, 0);
    h.set({
      user: 'alice@new.example',
      userName: 'Alice',
      viewSettings: { ...h.store.getState().viewSettings, author: true },
      commits: [
        { ...h.store.getState().commits[0], author: 'Alice', email: 'alice@old.example' },
        { ...h.store.getState().commits[1], author: 'Alias', email: 'ALICE@NEW.EXAMPLE' },
        { ...h.store.getState().commits[2], author: 'Bob', email: 'bob@example.com' },
      ],
    });
    const authorClasses = () =>
      [...h.list.querySelectorAll('.commit')].map((row) => row.querySelector('.author').className);
    assert.match(authorClasses()[0], /my-author/);
    assert.match(authorClasses()[1], /my-author/);
    assert.doesNotMatch(authorClasses()[2], /my-author/);
    assert.equal(
      h.store.getState().viewSettings['highlight-me'],
      false,
      'Author emphasis is independent of row highlighting',
    );
    h.set({ user: '', userName: '' });
    assert.ok(
      authorClasses().every((cls) => !cls.includes('my-author')),
      'identity change invalidates reused rows',
    );
    h.set({
      commits: Array.from({ length: 5000 }, (_, i) =>
        fixture('n' + i, i < 4999 ? ['n' + (i + 1)] : []),
      ),
    });
    assert.equal(h.list.querySelectorAll('.commit').length, 14);
    h.list.scrollTop = 24000;
    h.ctx.actions.commits.renderCommitWindow();
    assert.equal(h.list.querySelector<HTMLElement>('.commit').dataset.hash, 'n988');
    assert.equal(h.list.querySelectorAll('.commit').length, 26);
    const rules = [...h.ctx.env.layoutSheet.cssRules] as CSSStyleRule[];
    assert.equal(
      rules.find((rule) => rule.selectorText === '.commit-spacer-top').style.height,
      '23712px',
    );
    h.ctx.actions.commits.revealCommit('n4999', 'center');
    assert.equal([...h.list.querySelectorAll<HTMLElement>('.commit')].at(-1).dataset.hash, 'n4999');
    assert.ok(h.list.querySelectorAll('.commit').length <= 26);
    h.list.scrollTop = 0;
    const wide = Array.from({ length: 100 }, (_, i) =>
      fixture('w' + i, i < 30 ? ['w' + (i + 60)] : i < 99 ? ['w' + (i + 1)] : []),
    );
    h.set({ commits: wide, viewSettings: { ...h.store.getState().viewSettings, longEdges: true } });
    const rowWidths = () =>
      [...h.list.querySelectorAll('.commit')].map((row) =>
        parseFloat(
          (row.querySelector('.subject') as HTMLElement).style.getPropertyValue('--graph-width'),
        ),
      );
    const initialWidths = rowWidths();
    assert.ok(new Set(initialWidths).size > 1, 'message insets follow each row, not global extent');
    assert.ok(
      initialWidths.some((width) => width > 240),
      'wide rows are not compressed or capped',
    );
    const graph = createRows(wide, true);
    assert.deepEqual(
      initialWidths,
      Array.from({ length: 14 }, (_, i) => Math.ceil(((graph.get(i).width * 16 + 2) * 24) / 22)),
      'every row uses fixed lane spacing',
    );
    h.ctx.actions.commits.renderCommits();
    assert.deepEqual(rowWidths(), initialWidths, 'cached rows preserve their natural text insets');
    for (let i = 0; i < 5000; i += 150) {
      h.list.scrollTop = i * 24;
      h.ctx.actions.commits.renderCommitWindow();
    }
    const cache = h.ctx.actions.commits.getCacheStats();
    assert.ok(cache.rows <= 512 && cache.positions <= 512);
    h.set({ commits: [] });
    assert.equal(h.list.querySelectorAll('.commit').length, 0);
    assert.equal(h.list.scrollTop, 0);
  } finally {
    await h.dispose();
  }
});

test('near-bottom loading coalesces scrolls and stops while loading, exhausted, or failed', async () => {
  const h = createLogControllerHarness();
  h.set({
    commits: Array.from({ length: 500 }, (_, i) => fixture('a' + i)),
    snapshotKey: 'applied-snapshot',
  });
  h.start();
  try {
    Object.defineProperty(h.list, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(h.list, 'scrollHeight', { configurable: true, value: 2000 });
    h.list.scrollTop = 500;
    h.list.dispatchEvent(new h.window.Event('scroll'));
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.equal(h.messages.length, 0);
    h.list.scrollTop = 1200;
    h.list.dispatchEvent(new h.window.Event('scroll'));
    h.list.dispatchEvent(new h.window.Event('scroll'));
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].limit, 1000);
    assert.equal(h.messages[0].append, true);
    assert.equal(h.messages[0].branchSnapshotKey, 'applied-snapshot');
    h.list.dispatchEvent(new h.window.Event('scroll'));
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.equal(h.messages.length, 1);
    h.set({ historyLoading: false, hasMoreHistory: false });
    h.ctx.actions.history.maybeLoadMore();
    assert.equal(h.messages.length, 1);
    h.set({ hasMoreHistory: true, autoLoadBlocked: true });
    h.ctx.actions.history.maybeLoadMore();
    assert.equal(h.messages.length, 1);
  } finally {
    await h.dispose();
  }
});
