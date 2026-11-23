import type { MockPointerEvent } from './helpers/mocks';
import { installJunctionResize } from '../src/webview/log/resize';
import { test } from 'node:test';
import assert from 'node:assert/strict';
function setup() {
  const events = {},
    calls = [],
    handle = {
      addEventListener: (name, fn) => (events[name] = fn),
      setPointerCapture: (id) => calls.push(['capture', id]),
      focus: () => calls.push(['focus']),
    };
  let size = { width: 300, height: 250 };
  installJunctionResize(handle as unknown as HTMLElement, {
    measure: () => size,
    resize: (width, height) => {
      size = { width, height };
      calls.push(['resize', width, height]);
    },
    active: (value) => calls.push(['active', value]),
    save: () => calls.push(['save']),
    reset: () => calls.push(['reset']),
  });
  const fire = (name, data = {}) => {
    const event: MockPointerEvent = {
      button: 0,
      pointerId: 1,
      clientX: 600,
      clientY: 280,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...data,
    };
    events[name](event);
    return event;
  };
  return { fire, calls, size: () => size };
}
test('junction diagonal drag resizes all three areas from the initial geometry and saves once', () => {
  const t = setup();
  assert.ok(t.fire('pointerdown').stopped);
  assert.equal(t.calls.filter((c) => c[0] === 'focus').length, 1);
  t.fire('pointermove', { clientX: 560, clientY: 310 });
  assert.deepEqual(t.size(), { width: 340, height: 280 });
  t.fire('pointermove', { clientX: 580, clientY: 300 });
  assert.deepEqual(t.size(), { width: 320, height: 270 });
  assert.equal(t.calls.filter((c) => c[0] === 'save').length, 0);
  t.fire('pointerup');
  t.fire('lostpointercapture');
  assert.equal(t.calls.filter((c) => c[0] === 'save').length, 1);
  t.fire('pointermove', { clientX: 10, clientY: 10 });
  assert.deepEqual(t.size(), { width: 320, height: 270 });
  assert.deepEqual(
    t.calls.filter((c) => c[0] === 'active'),
    [
      ['active', true],
      ['active', false],
    ],
  );
});
test('junction supports keyboard axes, combined reset and pointer cancellation without bubbling to column sash', () => {
  const t = setup();
  assert.ok(t.fire('keydown', { key: 'ArrowLeft' }).stopped);
  t.fire('keydown', { key: 'ArrowDown' });
  assert.deepEqual(t.size(), { width: 310, height: 260 });
  assert.ok(t.fire('dblclick').stopped);
  assert.equal(t.calls.filter((c) => c[0] === 'reset').length, 1);
  t.fire('pointerdown', { button: 2 });
  t.fire('pointermove', { clientX: 0, clientY: 0 });
  assert.deepEqual(t.size(), { width: 310, height: 260 });
  t.fire('pointerdown');
  t.fire('pointercancel');
  assert.deepEqual(t.calls.at(-2), ['active', false]);
});
