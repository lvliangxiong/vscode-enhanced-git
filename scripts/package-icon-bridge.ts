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
fs.mkdirSync(path.join(bridge, 'media'), { recursive: true });
fs.copyFileSync(path.join(root, 'media/bridge-icon.png'), path.join(bridge, 'media/icon.png'));
fs.rmSync(path.join(bridge, 'out'), { recursive: true, force: true });
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
    '--githubBranch',
    'main',
    '--baseContentUrl',
    'https://github.com/lvliangxiong/vscode-git/blob/main/icon-theme-bridge',
    '--baseImagesUrl',
    'https://raw.githubusercontent.com/lvliangxiong/vscode-git/main/icon-theme-bridge',
    '--out',
    path.join(root, 'dist/vscode-git-icon-theme.vsix'),
  ],
  { cwd: bridge, stdio: 'inherit' },
);
