import { syncPaneTheme } from '../src/webview/log-pane';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installGraphTheme } from '../src/webview/log/theme';
import { Lifetime } from '../src/webview/log/lifetime';
import type { LogContext } from '../src/webview/log/context';

test('shadow panes follow theme classes without reading or freezing inherited theme tokens', () => {
  const classes = new Set(['pane-body', 'compare-log', 'vscode-dark']);
  let host = new Set(['vscode-light']);
  const body = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const hostBody = { classList: { contains: (name) => host.has(name) } };
  const theme = () => syncPaneTheme(body as any, hostBody as any);
  theme();
  assert.deepEqual([...classes], ['pane-body', 'compare-log', 'vscode-light']);
  host = new Set(['vscode-high-contrast', 'vscode-high-contrast-light']);
  theme();
  assert.ok(classes.has('vscode-high-contrast-light'));
  assert.ok(!classes.has('vscode-light'));
  host = new Set(['vscode-dark']);
  theme();
  assert.deepEqual([...classes], ['pane-body', 'compare-log', 'vscode-dark']);
});

test('theme and zoom changes coalesce Canvas repaints, including same-kind themes, and dispose observers', () => {
  const frames: (() => void)[] = [],
    observers: (() => void)[] = [],
    events: Record<string, () => void> = {};
  let paints = 0,
    disconnected = 0;
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(callback) {
      observers.push(callback);
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  } as unknown as typeof MutationObserver;
  const lifetime = new Lifetime();
  try {
    installGraphTheme({
      env: {
        document: { body: {}, documentElement: {} },
        window: {
          addEventListener: (name, fn) => (events[name] = fn),
          removeEventListener() {},
          requestAnimationFrame: (fn) => (frames.push(fn), frames.length),
          cancelAnimationFrame() {},
        },
      },
      lifetime,
      actions: { graph: { repaintGraphCanvases: () => paints++ } },
    } as unknown as LogContext);
    observers[0]();
    observers[1]();
    events['vsgitTheme']();
    events['resize']();
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(paints, 1);
    events['vsgitTheme']();
    frames.shift()();
    assert.equal(paints, 2);
    lifetime.dispose();
    assert.equal(disconnected, 2);
  } finally {
    globalThis.MutationObserver = previous;
  }
});
