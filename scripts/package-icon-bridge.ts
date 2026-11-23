import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
const root = path.resolve(__dirname, '..');
const bridge = path.join(root, 'icon-theme-bridge');
const manifest = JSON.parse(fs.readFileSync(path.join(bridge, 'package.json'), 'utf8'));
manifest.version = require('../package.json').version;
manifest.publisher = require('../package.json').publisher;
fs.writeFileSync(path.join(bridge, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
buildSync({
  entryPoints: [path.join(root, 'src/icon-bridge/extension.ts')],
  outfile: path.join(bridge, 'out/extension.js'),
  bundle: true,
  platform: 'node',
  mainFields: ['module', 'main'],
  target: 'node18',
  external: ['vscode'],
});
fs.copyFileSync(
  path.join(path.dirname(require.resolve('jsonc-parser/package.json')), 'LICENSE.md'),
  path.join(bridge, 'out/jsonc-parser-LICENSE.md'),
);
fs.copyFileSync(
  path.join(path.dirname(require.resolve('vscode-textmate/package.json')), 'LICENSE.md'),
  path.join(bridge, 'out/vscode-textmate-LICENSE.txt'),
);
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/@vscode/vsce/vsce'),
    'package',
    '--no-dependencies',
    '--allow-missing-repository',
    '--skip-license',
    '--out',
    path.join(root, 'dist/vsgit-icon-theme.vsix'),
  ],
  { cwd: bridge, stdio: 'inherit' },
);
