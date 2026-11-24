import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createHoverDom } from './helpers/hover-dom';
import { installGraphHover } from '../src/webview/log/hover';

test('Canvas hit testing highlights a branch color; arrows stay individually scoped and clear on scroll/leave/hide', async () => {
  const t = await createHoverDom(),
    paints: unknown[][] = [];
  try {
    t.ui.setSlots({
      commits: createElement(
        'span',
        { className: 'graph-cell' },
        createElement('span', { className: 'graph-jump' }),
        createElement('span', { className: 'graph-line' }),
      ),
    });
    await t.tick();
    const list = t.document.getElementById('commits'),
      cell = list.querySelector<HTMLElement>('.graph-cell'),
      arrow = list.querySelector('.graph-jump'),
      line = list.querySelector('.graph-line');
    let color: number | undefined, activeArrow: Element | undefined;
    t.ctx.actions = {
      graph: {
        setHover(next, edge) {
          if (color === next && activeArrow === edge) return;
          color = next;
          activeArrow = edge;
          paints.push([color, activeArrow]);
        },
        hitCell(target, x, y) {
          assert.equal(target, cell);
          return x === 5 && y === 6 ? 7 : undefined;
        },
      },
    } as any;
    cell.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    installGraphHover(t.ctx, list);
    t.event(line, 'pointermove', { clientX: 15, clientY: 26 });
    assert.deepEqual(paints.at(-1), [7, undefined]);
    t.event(arrow, 'pointermove');
    assert.deepEqual(paints.at(-1), [undefined, arrow]);
    const before = paints.length;
    t.event(arrow, 'pointermove');
    assert.equal(paints.length, before);
    for (const event of ['scroll', 'pointerleave', 'blur', 'vsCodeGitHidden']) {
      t.event(arrow, 'pointermove');
      t.event(
        event === 'blur' || event === 'vsCodeGitHidden' ? (t.window as unknown as Window) : list,
        event,
      );
      assert.ok(paints.at(-1).every((value) => value === undefined));
    }
    t.event(arrow, 'focusin');
    assert.equal(paints.at(-1)[1], arrow);
    t.event(arrow, 'focusout');
    assert.equal(paints.at(-1)[1], undefined);
    t.ctx.lifetime.dispose();
    const count = paints.length;
    t.event(arrow, 'pointermove');
    assert.equal(paints.length, count);
  } finally {
    await t.dispose();
  }
});
