import { createCommitDateFormatter as formatter } from '../src/webview/log/commit-date';
import test from 'node:test';
import assert from 'node:assert/strict';
test('commit dates use local calendar days across month and year boundaries', () => {
  const format = formatter(new Date(2026, 0, 1, 0, 5));
  assert.equal(format(new Date(2026, 0, 1, 0, 1)), 'Today 00:01');
  assert.equal(format(new Date(2025, 11, 31, 23, 59)), 'Yesterday 23:59');
  assert.equal(format(new Date(2025, 11, 30, 23, 59)), '2025/12/30, 23:59');
  assert.equal(format(new Date(2026, 0, 2, 12, 0)), '2026/1/2, 12:00');
  assert.equal(format('invalid'), '');
});
test('yesterday is a calendar day, not a rolling 24 hour duration', () => {
  const format = formatter(new Date(2026, 9, 9, 23, 59));
  assert.equal(format(new Date(2026, 9, 8, 0, 1)), 'Yesterday 00:01');
  assert.equal(format(new Date(2026, 9, 9, 0, 0)), 'Today 00:00');
});
