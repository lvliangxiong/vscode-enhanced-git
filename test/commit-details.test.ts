import { mountComponent } from './helpers/react-view';
import { createReactDom } from './helpers/react-dom';
import { CommitDetails, commitRelativeTime } from '../src/webview/react/commit-details';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { git, details } = require('../out/extension/git/index');
test('detail statistics handle roots, renames, binary files and merged changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-stats-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\n');
    await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'initial']);
    const read = async () =>
      details(root, (await git(root, ['rev-parse', 'HEAD'])).trim(), { mergeChanges: true });
    assert.deepEqual((await read()).stats, { files: 2, insertions: 2, deletions: 0, binary: 1 });
    await git(root, ['mv', 'a.txt', 'renamed\tfile.txt']);
    await git(root, ['commit', '-m', 'rename']);
    assert.deepEqual((await read()).stats, { files: 1, insertions: 0, deletions: 0, binary: 0 });
    await git(root, ['checkout', '-b', 'topic']);
    await fs.writeFile(path.join(root, 'topic'), 'topic\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'topic']);
    await git(root, ['checkout', 'main']);
    await fs.writeFile(path.join(root, 'main'), 'main\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'main']);
    await git(root, ['merge', '--no-ff', 'topic', '-m', 'merge']);
    assert.deepEqual((await read()).stats, { files: 0, insertions: 0, deletions: 0, binary: 0 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('rich commit text stays literal and only web/email tokens become links', async () => {
  const dom = createReactDom(),
    root = dom.document.getElementById('root');
  const view = mountComponent(root, CommitDetails),
    links: string[] = [];
  try {
    view.render({
      items: [
        {
          commit: { hash: 'a'.repeat(40), parents: [], author: 'Me', email: 'me@example.com' },
          message: '<script>alert(1)</script> javascript:bad https://example.com, test@example.com',
        },
      ],
      onOpenLink: (url) => links.push(url),
      onShowChanges() {},
      onCopy() {},
    });
    const title = root.querySelector('.commit-title');
    assert.deepEqual(
      [...title.querySelectorAll('a')].map((link) => link.href),
      ['https://example.com/', 'mailto:test@example.com'],
    );
    assert.ok(title.textContent.includes('<script>'));
    assert.equal(title.querySelector('script'), null);
    const web = title.querySelector('a');
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    assert.equal(web.dispatchEvent(click), false);
    assert.deepEqual(links, ['https://example.com']);
    assert.equal(root.querySelector('.commit-time').textContent, '');
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('commit footer opens that commit in File Diffs while copy remains independent', async () => {
  const dom = createReactDom(),
    root = dom.document.getElementById('root');
  const view = mountComponent(root, CommitDetails),
    messages = [];
  const hash = 'a'.repeat(40);
  try {
    view.render({
      items: [
        {
          commit: {
            hash,
            parents: [],
            author: 'Me',
            email: 'me@example.com',
            date: '2026-10-17T00:00:00Z',
          },
          message: 'A commit',
        },
      ],
      onOpenLink: (url) => messages.push({ type: 'openCommitLink', url }),
      onShowChanges: (hash) => messages.push({ type: 'commitChanges', hash }),
      onCopy: (text) => messages.push({ type: 'copyReference', text }),
    });
    const revision = root.querySelector<HTMLAnchorElement>('.commit-revision');
    const copy = root.querySelector<HTMLButtonElement>('.commit-copy');
    assert.equal(revision.tagName, 'A');
    assert.equal(revision.getAttribute('href'), '#');
    assert.match(revision.title, /Show File Diffs/);
    assert.equal(revision.querySelector('code').textContent, hash.slice(0, 8));
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    assert.equal(revision.dispatchEvent(event), false);
    assert.deepEqual(messages, [{ type: 'commitChanges', hash }]);
    copy.click();
    assert.deepEqual(messages.at(-1), { type: 'copyReference', text: hash });
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('commit details preserve coauthors, literal multiline text and incremental statistics', async () => {
  const dom = createReactDom(),
    root = dom.document.getElementById('root');
  const view = mountComponent(root, CommitDetails);
  const item = {
    commit: {
      hash: 'b'.repeat(40),
      parents: [],
      author: 'Author',
      email: 'author@example.com',
      date: '2026-10-17T00:00:00Z',
      authorDate: '2026-10-16T00:00:00Z',
    },
    message:
      'Subject\n\n**literal body**\nCo-authored-by: Other <other@example.com>\nCo-authored-by: Other <OTHER@example.com>',
  };
  const actions = { onOpenLink() {}, onShowChanges() {}, onCopy() {} };
  try {
    view.render({ items: [item], ...actions });
    const article = root.querySelector('.commit-details');
    const copy = root.querySelector<HTMLButtonElement>('.commit-copy');
    copy.focus();
    assert.equal(root.querySelectorAll('.commit-person').length, 2);
    assert.equal(root.querySelector('em').textContent, '(Co-author)');
    assert.match(root.querySelector('.commit-body').textContent, /^\*\*literal body\*\*\n/);
    assert.equal(root.querySelector('.commit-stats'), null);
    view.render({
      items: [{ ...item, stats: { files: 3, insertions: 12, deletions: 5, binary: 1 } }],
      ...actions,
    });
    assert.equal(root.querySelector('.commit-details'), article);
    assert.equal(dom.document.activeElement, copy);
    assert.equal(
      root.querySelector('.commit-stats').textContent,
      '3 files changed, 12 insertions(+), 5 deletions(-), 1 binary files',
    );
    assert.equal(root.querySelector('.commit-stats').nextElementSibling.className, 'commit-footer');
    view.render({ items: [], ...actions });
    assert.equal(root.childElementCount, 0);
    assert.equal(
      commitRelativeTime('2026-10-17T00:00:00Z', Date.parse('2026-10-19T00:00:00Z')),
      '2 days ago',
    );
  } finally {
    view.dispose();
    await dom.dispose();
  }
});
