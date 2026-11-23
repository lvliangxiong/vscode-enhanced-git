import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushSync } from 'react-dom';
import { CommitSubject } from '../src/webview/react/commit-subject';
import { createReactDom } from './helpers/react-dom';
import { mountComponent } from './helpers/react-view';

test('shared commit titles reveal clipped text and dismiss on scroll; unclipped titles stay quiet', async () => {
  const dom = createReactDom();
  const view = mountComponent(dom.document.getElementById('root'), CommitSubject);
  const wait = () => new Promise((resolve) => setTimeout(resolve, 180));
  try {
    const text = 'A long commit title that must be shown in full';
    view.render({ text });
    const subject = dom.document.querySelector<HTMLElement>('.subject-text');
    Object.defineProperties(subject, {
      scrollWidth: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 50 },
    });
    subject.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true }));
    await wait();
    assert.equal(dom.document.querySelector('[role="tooltip"]').textContent, text);
    assert.ok(
      dom.document.querySelector('.commit-hover.message-hover .hover-message'),
      'original popup surface and message structure are shared',
    );
    assert.equal((dom.document.querySelector('[role="tooltip"]') as HTMLElement).style.left, '8px');
    flushSync(() => dom.window.dispatchEvent(new dom.window.Event('scroll')));
    assert.equal(dom.document.querySelector('[role="tooltip"]'), null);
    Object.defineProperty(subject, 'clientWidth', { configurable: true, value: 400 });
    subject.dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true }));
    subject.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true }));
    await wait();
    assert.equal(dom.document.querySelector('[role="tooltip"]'), null);
  } finally {
    view.dispose();
    await dom.dispose();
  }
});

test('main Log keeps its existing delegated title hover target', async () => {
  const dom = createReactDom();
  const view = mountComponent(dom.document.getElementById('root'), CommitSubject);
  try {
    view.render({ text: 'Main Log title', hostHover: true });
    const target = dom.document.querySelector('.subject-text');
    assert.ok(target.matches('.subject-text:not([data-shared-hover])'));
    assert.equal(dom.document.querySelector('.commit-subject-tooltip'), null);
  } finally {
    view.dispose();
    await dom.dispose();
  }
});
