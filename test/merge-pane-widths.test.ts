import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  equalPaneWidths,
  fitPaneWidths,
  movePaneSash,
  restorePaneWidths,
} from '../src/webview/merge/pane-widths';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test('merge sashes trade only adjacent widths and stop at each pane minimum', () => {
  const left = movePaneSash(equalPaneWidths, 0, 90, 900);
  close(left[0] * 900, 390);
  close(left[1] * 900, 210);
  close(left[2] * 900, 300);
  const right = movePaneSash(left, 1, -45, 900);
  close(right[0], left[0]);
  close(right[1] * 900, 165);
  close(right[2] * 900, 345);
  for (const side of [0, 1] as const)
    for (const delta of [-100000, 100000]) {
      const values = movePaneSash(equalPaneWidths, side, delta, 900);
      values.forEach((value) => assert.ok(value * 900 >= 120 - 1e-9));
      close(
        values.reduce((sum, value) => sum + value, 0),
        1,
      );
      close(values[side === 0 ? 2 : 0], 1 / 3);
    }
});

test('saved widths are validated and fit narrow editor groups without losing the preferred proportions', () => {
  for (const value of [
    null,
    [],
    [1, 2],
    [0, 1, 1],
    [-1, 1, 1],
    ['1', 1, 1],
    [Infinity, 1, 1],
    [1e308, 1e308, 1e308],
  ])
    assert.deepEqual(restorePaneWidths(value), equalPaneWidths);
  const preferred = restorePaneWidths([1, 3, 2]);
  const narrow = fitPaneWidths(preferred, 240);
  narrow.forEach((value) => close(value, 1 / 3));
  assert.deepEqual(fitPaneWidths(preferred, 1200), preferred);
  const limited = fitPaneWidths(preferred, 500);
  limited.forEach((value) => assert.ok(value * 500 >= 120 - 1e-9));
  close(
    limited.reduce((sum, value) => sum + value, 0),
    1,
  );
  assert.deepEqual(movePaneSash(preferred, 0, 100, 0), preferred);
});
