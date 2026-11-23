import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createReactDom } from './helpers/react-dom';
import { visibleFilterCount } from '../src/webview/log/toolbar';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
async function setup() {
  const dom = createReactDom('<style id="layout-style"></style><div id="root"></div>');
  const { mountSessionUi } = await import('../src/webview/react/session-ui');
  const ui = mountSessionUi({
    container: dom.document.getElementById('root'),
    document: dom.document,
    window: dom.window as unknown as Window,
    sheet: (dom.document.getElementById('layout-style') as HTMLStyleElement).sheet,
  });
  return {
    ...dom,
    ui,
    async dispose() {
      ui.dispose();
      await dom.dispose();
    },
  };
}
test('one React shell keeps input and view node identity while independent regions update', async () => {
  const app = await setup(),
    { document, ui } = app;
  try {
    const search = document.getElementById('search') as HTMLInputElement;
    const commitPane = document.getElementById('commits');
    search.value = 'draft query';
    search.focus();
    ui.setSlots({
      branches: createElement('span', null, 'Branch'),
      commits: createElement('p', null, 'Commit A'),
    });
    ui.patchChrome({ buttons: { refresh: { label: 'Refresh updated history' } } });
    await settle();
    assert.equal(document.getElementById('search'), search);
    assert.equal(document.getElementById('commits'), commitPane);
    assert.equal(search.value, 'draft query');
    assert.equal(document.activeElement, search);
    assert.equal(commitPane.textContent, 'Commit A');
    ui.setSlots({ files: createElement('p', null, 'Changed file') });
    await settle();
    assert.equal(commitPane.textContent, 'Commit A');
    assert.equal(document.querySelectorAll('#filter-strip').length, 1);
    assert.equal(document.querySelectorAll('#split-junction').length, 1);
  } finally {
    await app.dispose();
  }
});
test('context menu skips disabled actions, preserves literal labels and routes selected action once', async () => {
  const app = await setup(),
    { document, window, ui } = app;
  const calls: string[] = [];
  try {
    ui.openContextMenu({
      point: { x: 20, y: 30 },
      items: [
        { label: 'Unavailable', disabled: true, action: () => calls.push('disabled') },
        {
          label: '<script>literal</script>',
          icon: 'copy',
          shortcut: '⌘C',
          action: () => calls.push('copy'),
        },
        { separator: true },
        { label: 'Last', action: () => calls.push('last') },
      ],
    });
    await settle();
    const menu = document.getElementById('branch-menu');
    assert.equal(menu.hidden, false);
    assert.equal(menu.querySelector('script'), null);
    assert.equal(document.activeElement.textContent, '<script>literal</script>⌘C');
    document.activeElement.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    assert.equal(document.activeElement.textContent, 'Last');
    (document.activeElement as HTMLElement).click();
    await settle();
    assert.deepEqual(calls, ['last']);
    assert.equal(menu.hidden, true);
  } finally {
    await app.dispose();
  }
});
test('React hover copies a full branch name and leaves untrusted text literal', async () => {
  const app = await setup(),
    { document, ui } = app;
  const calls: string[] = [];
  try {
    let measured = false;
    ui.showHover('branch-hover', {
      kind: 'refs',
      names: ['feature/<b>literal</b>'],
      copy: (name) => calls.push(name),
      onMount: (element) => {
        measured = element.textContent.includes('literal');
      },
    });
    await settle();
    const popup = document.getElementById('branch-hover');
    assert.equal(popup.hidden, false);
    assert.equal(popup.querySelector('b'), null);
    assert.equal(measured, true);
    popup.querySelector<HTMLButtonElement>('button').click();
    assert.deepEqual(calls, ['feature/<b>literal</b>']);
    ui.hideHover('branch-hover');
    await settle();
    assert.equal(popup.hidden, true);
  } finally {
    await app.dispose();
  }
});
test('ref dialog retains entered values after a failed request and closes only matching request', async () => {
  const app = await setup(),
    { document, window, ui } = app;
  const submitted: any[] = [];
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  try {
    const id = ui.openRefDialog({
      kind: 'branch',
      hash: 'a'.repeat(40),
      onSubmit: (value) => submitted.push(value),
    });
    await settle();
    const input = document.getElementById('commit-ref-name') as HTMLInputElement;
    input.value = 'new-topic';
    document
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.deepEqual(submitted, [{ name: 'new-topic', checkout: true, dialogId: id }]);
    assert.equal(document.querySelector<HTMLButtonElement>('button[type="submit"]').disabled, true);
    ui.finishRefDialog(id, true);
    await settle();
    assert.equal(input.value, 'new-topic');
    assert.equal(
      document.querySelector<HTMLButtonElement>('button[type="submit"]').disabled,
      false,
    );
    ui.finishRefDialog('stale');
    await settle();
    assert.ok(document.getElementById('commit-ref-dialog'));
    ui.finishRefDialog(id);
    await settle();
    assert.equal(document.getElementById('commit-ref-dialog'), null);
  } finally {
    await app.dispose();
  }
});
test('filter packing never splits a visible control', () => {
  assert.deepEqual(visibleFilterCount([70, 60, 50], 133), { count: 1, width: 72 });
  assert.deepEqual(visibleFilterCount([70, 60, 50], 134), { count: 2, width: 134 });
});

test('nested checkbox menu preserves focus and check state; Escape closes one level at a time', async () => {
  const app = await setup();
  const { ui, document, window } = app;
  let author = false;
  const anchor = document.getElementById('view-options');
  const open = () =>
    ui.openMenu('view-menu', {
      label: 'View Options',
      anchor,
      items: [
        {
          label: 'Columns',
          children: [
            {
              label: 'Author',
              role: 'menuitemcheckbox',
              checked: author,
              keepOpen: true,
              action: () => {
                author = !author;
                open();
              },
            },
            { label: 'Hash', role: 'menuitemcheckbox', checked: true, keepOpen: true },
          ],
        },
        { label: 'Last option' },
      ],
    });
  const key = (name: string) =>
    document.activeElement.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: name, bubbles: true }),
    );
  try {
    open();
    await settle();
    assert.equal(anchor.getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement.textContent, 'Columns');
    key('ArrowRight');
    await settle();
    const authorButton = document.activeElement as HTMLButtonElement;
    assert.equal(authorButton.textContent, 'Author');
    authorButton.click();
    await settle();
    assert.equal(document.activeElement, authorButton);
    assert.equal(authorButton.getAttribute('aria-checked'), 'true');
    key('ArrowDown');
    assert.equal(document.activeElement.textContent, '✓Hash');
    key('Escape');
    await settle();
    assert.equal(document.activeElement.textContent, 'Columns');
    assert.equal(document.getElementById('view-menu').hidden, false);
    key('ArrowDown');
    assert.equal(document.activeElement.textContent, 'Last option');
    key('Escape');
    await settle();
    assert.equal(document.getElementById('view-menu').hidden, true);
    assert.equal(document.activeElement, anchor);
    assert.equal(anchor.getAttribute('aria-expanded'), 'false');
  } finally {
    await app.dispose();
  }
});
