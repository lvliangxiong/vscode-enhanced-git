import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerComparisonPanelToggle } from '../src/extension/commands/panel-toggle';

test('comparison Cmd+J coalesces duplicate dispatches, releases for subsequent presses and clears scope on close', async () => {
  let handler: () => Promise<unknown>, finish: () => void;
  let count = 0;
  const contexts: boolean[] = [];
  const subscriptions: any[] = [];
  const vscode: any = {
    commands: {
      registerCommand(_id, fn) {
        handler = fn;
        return { dispose() {} };
      },
      executeCommand(id, _key, value) {
        if (id === 'setContext') {
          contexts.push(value);
          return Promise.resolve();
        }
        count++;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    },
  };
  const controller = registerComparisonPanelToggle(vscode, { subscriptions } as any);
  let changed: () => void, close: () => void;
  const panel: any = {
    visible: true,
    onDidChangeViewState(fn) {
      changed = fn;
      return { dispose() {} };
    },
    onDidDispose(fn) {
      close = fn;
      return { dispose() {} };
    },
  };
  try {
    controller.track(panel);
    assert.equal(contexts.at(-1), true);
    const first = handler();
    const duplicate = handler();
    assert.equal(first, duplicate);
    await Promise.resolve();
    assert.equal(count, 1);
    finish();
    await first;
    await handler();
    assert.equal(count, 1, 'focus-handoff echo must not reopen the panel');
    await new Promise((resolve) => setTimeout(resolve, 180));
    const next = handler();
    await Promise.resolve();
    assert.equal(count, 2);
    finish();
    await next;
    panel.visible = false;
    changed();
    assert.equal(contexts.at(-1), false);
    panel.visible = true;
    changed();
    close();
    assert.equal(contexts.at(-1), false);
  } finally {
    subscriptions.forEach((item) => item.dispose());
  }
});
