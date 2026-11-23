import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogControllerHarness } from './helpers/log-controller';

function setup(reducedMotion = false) {
  const h = createLogControllerHarness();
  const effects = [];
  Object.defineProperty(h.window, 'matchMedia', { value: () => ({ matches: reducedMotion }) });
  h.document.documentElement.style.setProperty('--vscode-focusBorder', '#58a6ff');
  const commits = ['child', 'parent'].map((hash) => ({ hash, parents: [], decorations: '' }));
  h.set({ commits, historyRequest: 1 });
  h.start();
  const shape = (name, cls) => {
    const node = h.document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    node.setAttribute('class', cls);
    node.setAttribute('stroke', '#996633');
    node.setAttribute('stroke-width', '1.5');
    node.animate = (keyframes, options) => {
      const effect = {
        name,
        keyframes,
        options,
        cancelled: false,
        onfinish: undefined,
        cancel() {
          this.cancelled = true;
        },
      };
      effects.push(effect);
      return effect as any;
    };
    return node;
  };
  function installShapes() {
    for (const row of h.list.querySelectorAll<HTMLElement>('.commit'))
      row.querySelector('.graph-cell').append(shape(row.dataset.hash + ' dot', 'graph-node'));
    for (const [name, source, parent, target] of [
      ['other incoming', 'other', 'parent', 'other'],
      ['outgoing', 'child', 'parent', 'parent'],
      ['return', 'child', 'parent', 'child'],
    ]) {
      const arrow = h.document.createElement('span');
      arrow.className = 'graph-jump';
      arrow.dataset.edgeSource = source;
      arrow.dataset.edgeParent = parent;
      arrow.dataset.target = target;
      arrow.append(shape(name, 'graph-arrow-shape'));
      h.list.append(arrow);
    }
  }
  installShapes();
  return { ...h, effects, commits, installShapes, c: h.ctx.actions.commits };
}

test('jump pulses only the destination dot and the reverse arrow for the exact edge', async () => {
  const h = setup();
  try {
    h.c.jumpToCommit('parent', { source: 'child', parent: 'parent' });
    assert.deepEqual(
      h.effects.map((e) => e.name),
      ['parent dot', 'return'],
    );
    assert.deepEqual([...h.store.getState().selected], ['parent']);
    assert.ok(h.effects.every((e) => e.options.duration * e.options.iterations === 2400));
    assert.equal(h.effects[0].keyframes[1].transform, 'scale(1.55)');
    assert.equal(h.effects[1].keyframes[1].transform, 'scale(1.35)');
    h.c.jumpToCommit('child', { source: 'child', parent: 'parent' });
    assert.ok(h.effects.slice(0, 2).every((e) => e.cancelled));
    assert.deepEqual(
      h.effects.slice(2).map((e) => e.name),
      ['child dot', 'outgoing'],
    );
    h.effects.slice(2).forEach((e) => e.onfinish());
    h.c.highlightGraphJump('parent');
    assert.ok(
      h.effects.slice(2, 4).every((e) => !e.cancelled),
      'finished effects are removed from cancellation ownership',
    );
  } finally {
    await h.dispose();
  }
});

test('loading a parent preserves the edge identity until rendering and ignores superseded jumps', async () => {
  const h = setup();
  try {
    h.set({ commits: [] });
    h.c.jumpToCommit('parent', { source: 'child', parent: 'parent' });
    assert.equal(h.effects.length, 0);
    assert.equal(h.messages[0].target, 'parent');
    h.set({ commits: h.commits });
    h.installShapes();
    const requestId = h.store.getState().historyRequest;
    h.c.finishGraphJump({ target: 'parent', requestId });
    assert.equal(h.effects.length, 0);
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.deepEqual(
      h.effects.map((e) => e.name),
      ['parent dot', 'return'],
    );
    h.c.finishGraphJump({ target: 'child', requestId });
    h.set({ historyRequest: requestId + 1 });
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.deepEqual([...h.store.getState().selected], ['parent']);
    assert.equal(h.effects.length, 2);
  } finally {
    await h.dispose();
  }
});

test('reduced motion uses a temporary stationary highlight; direct jumps still mark the dot', async () => {
  const h = setup(true);
  try {
    h.c.jumpToCommit('parent');
    assert.deepEqual(
      h.effects.map((e) => e.name),
      ['parent dot'],
    );
    assert.ok(
      h.effects[0].keyframes.every(
        (key) => key.transform === 'scale(1)' && key.stroke === '#58a6ff',
      ),
    );
    assert.equal(h.effects[0].options.iterations, 1);
    h.c.jumpToCommit('parent');
    assert.equal(h.effects[0].cancelled, true);
    assert.equal(h.effects.length, 2);
  } finally {
    await h.dispose();
  }
});

test('disposing a log cancels a pending jump before it can change selection', async () => {
  const h = setup();
  try {
    h.c.finishGraphJump({ target: 'parent', requestId: h.store.getState().historyRequest });
    const selected = [...h.store.getState().selected];
    h.c.dispose();
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    assert.deepEqual([...h.store.getState().selected], selected);
    assert.equal(h.effects.length, 0);
  } finally {
    await h.dispose();
  }
});
