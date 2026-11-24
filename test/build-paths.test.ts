import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sourcePathKey } from '../scripts/build';

test('webview and bundled parser paths match the same build rules on Windows and POSIX', () => {
  for (const paths of [path.win32, path.posix]) {
    const root = paths.resolve('project', 'src');
    for (const key of [
      'webview/main.ts',
      'webview/merge-diff.ts',
      'extension/icons/theme.ts',
      'extension/syntax/resolver.ts',
    ]) {
      assert.equal(sourcePathKey(root, paths.join(root, ...key.split('/')), paths), key);
    }
  }
});
