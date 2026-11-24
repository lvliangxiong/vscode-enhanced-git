import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('webview styles and view contributions reference existing icon assets', () => {
  const webview = path.resolve(__dirname, '../out/webview');
  const referenced = new Set<string>();
  for (const file of fs.readdirSync(webview).filter((file) => file.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(webview, file), 'utf8');
    for (const [, asset] of css.matchAll(/url\(['"]?(icons\/[^'"\s)]+)['"]?\)/g)) {
      assert.ok(fs.existsSync(path.join(webview, asset)), `${file}: ${asset}`);
      referenced.add(path.basename(asset));
    }
  }
  assert.ok(referenced.size > 0, 'must inspect icon references');
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const groups of [manifest.contributes.views, manifest.contributes.viewsContainers]) {
    for (const views of Object.values(groups) as Array<Array<{ icon?: string }>>) {
      for (const { icon } of views) {
        if (!icon?.startsWith('media/icons/')) continue;
        assert.ok(fs.existsSync(path.join(root, icon)), `manifest: ${icon}`);
        referenced.add(path.basename(icon));
      }
    }
  }
  const packaged = fs
    .readdirSync(path.join(webview, 'icons'))
    .filter((file) => file.endsWith('.svg'));
  assert.deepEqual([...referenced].sort(), packaged.sort(), 'do not ship unreferenced SVG assets');
});
