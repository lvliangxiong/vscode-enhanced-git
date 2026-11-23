import { ReferenceLabels } from '../src/webview/react/reference-labels';
import { referenceGroups } from '../src/shared/reference-labels';
import { createElement } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHoverDom } from './helpers/hover-dom';
import { installCommitHover } from '../src/webview/log/hover';

async function setup(branchList: boolean | 'recent' = false) {
  const app = await createHoverDom();
  const list = app.document.getElementById(
    branchList === 'recent' ? 'filter-popup' : branchList ? 'branches' : 'commits',
  );
  list.hidden = false;
  installCommitHover(app.ctx, list, branchList);
  const id =
    branchList === 'recent' ? 'recent-hover' : branchList ? 'branch-hover' : 'commit-hover';
  return {
    ...app,
    list,
    popup: app.document.getElementById(id),
    style: app.style(id).style,
    async content(node) {
      app.ui.setSlots({
        [branchList === 'recent' ? 'filter' : branchList ? 'branches' : 'commits']: node,
      });
      await app.tick();
    },
    async show(target: Element) {
      app.event(target, 'pointerover');
      await app.tick(170);
    },
    async hide() {
      app.document.dispatchEvent(
        new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await app.tick();
    },
  };
}
test('hover expands only clipped titles, keeps the same target timer, and forwards multi-selection', async () => {
  const t = await setup();
  try {
    let selected = false;
    await t.content(
      createElement(
        'span',
        {
          className: 'subject-text',
          onClick: (event) => {
            selected = event.shiftKey;
          },
        },
        'full commit title',
      ),
    );
    const subject = t.list.querySelector<HTMLElement>('.subject-text');
    t.event(subject, 'pointerover');
    t.event(subject, 'pointerover');
    await t.tick(170);
    assert.equal(t.popup.hidden, false);
    assert.equal(t.popup.textContent, 'full commit title');
    t.event(subject, 'pointerout', { relatedTarget: t.popup });
    assert.equal(t.popup.hidden, false);
    t.event(t.popup, 'click', { shiftKey: true, clientX: 150, clientY: 62 });
    await t.tick();
    assert.equal(selected, true);
    assert.equal(t.popup.hidden, true);
    subject.dataset.scrollWidth = '40';
    await t.show(subject);
    assert.equal(t.popup.hidden, true);
  } finally {
    await t.dispose();
  }
});
test('reference hover shows complete labels and cancels stale hovers on leave, scroll, and removed rows', async () => {
  const t = await setup();
  try {
    await t.content(
      createElement('small', {
        className: 'refs',
        'data-references': JSON.stringify(['origin/very-long-branch', 'tag: release']),
      }),
    );
    let ref = t.list.querySelector('.refs');
    t.event(ref, 'pointerover');
    t.event(ref, 'pointerout');
    await t.tick(170);
    assert.equal(t.popup.hidden, true);
    await t.show(ref);
    assert.deepEqual(
      [...t.popup.querySelectorAll('small')].map((n) => n.textContent),
      ['origin/very-long-branch', 'tag: release'],
    );
    t.event(t.list, 'scroll');
    await t.tick();
    assert.equal(t.popup.hidden, true);
    t.event(ref, 'pointerover');
    await t.content(null);
    await t.tick(170);
    assert.equal(t.popup.hidden, true);
  } finally {
    await t.dispose();
  }
});
test('branch list expands clipped names on hover and keyboard focus only', async () => {
  const t = await setup(true);
  try {
    await t.content(
      createElement(
        'button',
        { className: 'branch', 'data-full-name': 'origin/team/very-long-feature-name' },
        createElement('span', { className: 'branch-label' }, 'feature-name'),
      ),
    );
    const button = t.list.querySelector('button'),
      label = t.list.querySelector<HTMLElement>('.branch-label');
    await t.show(button);
    assert.equal(t.popup.textContent, 'origin/team/very-long-feature-name');
    assert.equal(t.popup.className, 'commit-hover refs-hover');
    await t.hide();
    assert.equal(t.popup.hidden, true);
    t.event(button, 'focusin');
    await t.tick(170);
    assert.equal(t.popup.hidden, false);
    t.event(button, 'focusout');
    await t.tick();
    assert.equal(t.popup.hidden, true);
    for (const width of [40, 80]) {
      label.dataset.scrollWidth = String(width);
      t.event(button, 'focusin');
      await t.tick(170);
      assert.equal(t.popup.hidden, true);
      await t.show(button);
      assert.equal(t.popup.hidden, true);
    }
    label.dataset.scrollWidth = '200';
    await t.show(button);
    assert.equal(t.popup.hidden, false);
  } finally {
    await t.dispose();
  }
});
test('Recent expands complete groups without clipping and hides with the menu', async () => {
  const t = await setup('recent');
  try {
    await t.content(
      createElement(
        'div',
        { className: 'filter-menu-item' },
        createElement(
          'span',
          {
            className: 'recent-label',
            'data-scroll-width': '40',
            'data-references': JSON.stringify(['origin/long-first-branch', 'feature/second']),
          },
          'origin/long…',
        ),
      ),
    );
    const row = t.list.querySelector('.filter-menu-item');
    await t.show(row);
    assert.equal(t.popup.hidden, false);
    assert.equal(t.popup.className, 'commit-hover refs-hover');
    assert.deepEqual(
      [...t.popup.querySelectorAll('small')].map((n) => n.textContent),
      ['origin/long-first-branch', 'feature/second'],
    );
    t.list.hidden = true;
    await t.tick();
    assert.equal(t.popup.hidden, true);
    t.list.hidden = false;
    t.event(row, 'focusin');
    await t.tick(170);
    assert.equal(t.popup.hidden, false);
  } finally {
    await t.dispose();
  }
});
test('reference popups prefer right, then left, with vertical fallback at narrow widths', async () => {
  const t = await setup();
  try {
    await t.content(createElement('small', { className: 'refs', 'data-references': '["branch"]' }));
    const ref = t.list.querySelector<HTMLElement>('.refs');
    for (const [left, right, expectedLeft, expectedTop] of [
      [110, 190, '196px', '60px'],
      [600, 680, '334px', '60px'],
      [200, 600, '196px', '81px'],
    ] as const) {
      await t.hide();
      ref.dataset.left = String(left);
      ref.dataset.right = String(right);
      await t.show(ref);
      assert.equal(t.style.left, expectedLeft);
      assert.equal(t.style.top, expectedTop);
    }
  } finally {
    await t.dispose();
  }
});
test('reference popup copies the full name without pinning on text interaction', async () => {
  const t = await setup();
  try {
    await t.content(
      createElement('small', { className: 'refs', 'data-references': '["origin/full-branch"]' }),
    );
    const ref = t.list.querySelector('.refs');
    await t.show(ref);
    t.event(t.popup, 'pointerdown');
    t.event(t.popup, 'click');
    assert.equal(t.popup.hidden, false);
    t.popup.querySelector<HTMLButtonElement>('button').click();
    assert.deepEqual(t.messages, [{ type: 'copyReference', text: 'origin/full-branch' }]);
    t.event(t.popup, 'pointerout');
    await t.tick(120);
    assert.equal(t.popup.hidden, true);
  } finally {
    await t.dispose();
  }
});
test('Jump hints share the branch popup surface and side placement without forwarding clicks', async () => {
  const t = await setup();
  try {
    let clicked = false;
    await t.content(
      createElement('span', {
        className: 'graph-jump',
        'data-scroll-width': '0',
        'aria-label': 'Jump to "parent title" by Author',
        onClick: () => {
          clicked = true;
        },
      }),
    );
    const arrow = t.list.querySelector('.graph-jump');
    await t.show(arrow);
    assert.equal(t.popup.className, 'commit-hover refs-hover jump-hover');
    assert.equal(t.popup.textContent, 'Jump to "parent title" by Author');
    assert.equal(t.style.left, '196px');
    assert.equal(t.style.maxWidth, '480px');
    t.event(t.popup, 'click');
    assert.equal(clicked, false);
    t.event(arrow, 'pointerdown');
    await t.tick();
    assert.equal(t.popup.hidden, true);
    t.event(arrow, 'focusin');
    await t.tick(170);
    assert.equal(t.popup.hidden, false);
    await t.hide();
    assert.equal(t.popup.hidden, true);
  } finally {
    await t.dispose();
  }
});

test('reference hover lists HEAD and branch separately with colored outline icons', async () => {
  const t = await setup();
  try {
    await t.content(
      createElement(ReferenceLabels, { groups: referenceGroups('HEAD -> main'), compact: true }),
    );
    const label = t.list.querySelector<HTMLElement>('.reference-labels');
    assert.equal(label.textContent, 'main');
    assert.equal(label.querySelectorAll('.reference-icon-body').length, 2);
    await t.show(label);
    assert.equal(t.popup.hidden, false);
    assert.ok(t.popup.classList.contains('reference-popup'));
    assert.equal(t.style.color, '', 'reference popup uses the theme hover foreground');
    const rows = [...t.popup.querySelectorAll('.reference-popup-row')];
    assert.deepEqual(
      rows.map((row) => row.querySelector('span').textContent),
      ['HEAD', 'main'],
    );
    assert.ok(rows[0].querySelector('.reference-head'));
    assert.ok(rows[1].querySelector('.reference-local'));
    t.event(label, 'pointerout', { relatedTarget: t.popup });
    await t.tick(130);
    assert.equal(t.popup.hidden, false);
    await t.hide();
    assert.equal(t.popup.hidden, true);
  } finally {
    await t.dispose();
  }
});
