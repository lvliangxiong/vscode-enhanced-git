import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import less from 'less';
import { build } from 'esbuild';

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const outputRoot = path.join(root, 'out');
const options = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.CommonJS,
  esModuleInterop: true,
};
async function main(): Promise<void> {
  await fs.rm(outputRoot, { recursive: true, force: true });
  async function write(relative: string, text: string) {
    const file = path.join(outputRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  for (const entry of await fs.readdir(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(sourceRoot, file);
    if (file.endsWith('.d.ts')) continue;
    const source = await fs.readFile(file, 'utf8');
    if (relative.startsWith('webview/') && file.endsWith('.ts')) {
      // Only browser entry points are emitted. Their imported modules share the
      // same React runtime and never rely on a script loading order.
      if (
        ![
          'main.ts',
          'branch-changes.ts',
          'repository-host.ts',
          'compare-host.ts',
          'merge-diff.ts',
          'file-history.ts',
        ].includes(relative.slice('webview/'.length))
      )
        continue;
      await build({
        entryPoints: [file],
        outfile: path.join(
          outputRoot,
          relative === 'webview/merge-diff.ts'
            ? relative.replace('webview/', 'webview/monaco/').replace(/\.ts$/, '.js')
            : relative.replace(/\.ts$/, '.js'),
        ),
        loader: { '.ttf': 'file' },
        bundle: true,
        format: 'iife',
        target: 'es2023',
        define: { 'process.env.NODE_ENV': '"production"' },
        minify: true,
      });
    } else if (relative.startsWith('webview/') && file.endsWith('.tsx')) {
      continue;
    } else if (['extension/icons/theme.ts', 'extension/syntax/resolver.ts'].includes(relative)) {
      // Embed the npm parser at its runtime boundary. VSIX packages omit
      // node_modules; the remaining extension modules keep their relative imports.
      await build({
        entryPoints: [file],
        outfile: path.join(outputRoot, relative.replace(/\.ts$/, '.js')),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        // jsonc-parser's UMD entry hides require calls inside its factory;
        // its ESM entry lets esbuild include all parser internals.
        mainFields: ['module', 'main'],
        target: 'es2023',
      });
    } else if (file.endsWith('.ts')) {
      const { outputText } = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: options,
      });
      await write(relative.replace(/\.ts$/, '.js'), outputText);
    } else if (file.endsWith('.less') && !entry.name.startsWith('_')) {
      const result = await less.render(source, {
        filename: file,
        math: 'parens-division',
        javascriptEnabled: false,
      });
      await write(path.join('webview', path.basename(file, '.less') + '.css'), result.css);
    }
  }
  await build({
    entryPoints: [require.resolve('monaco-editor/editor/editor.worker.js')],
    outfile: path.join(outputRoot, 'webview/monaco/editor.worker.js'),
    bundle: true,
    format: 'iife',
    target: 'es2023',
    minify: true,
  });
  await fs.copyFile(
    require.resolve('vscode-oniguruma/release/onig.wasm'),
    path.join(outputRoot, 'webview/monaco/onig.wasm'),
  );
  const monacoRoot = path.resolve(
    path.dirname(require.resolve('monaco-editor/editor/editor.api.js')),
    '../../..',
  );
  const specialRoots: Record<string, string> = {
    'monaco-editor': monacoRoot,
    dompurify: path.resolve(path.dirname(require.resolve('dompurify')), '..'),
  };
  for (const dependency of [
    'react',
    'react-dom',
    'scheduler',
    'zustand',
    'monaco-editor',
    'marked',
    'dompurify',
  ]) {
    const directory =
      specialRoots[dependency] || path.dirname(require.resolve(`${dependency}/package.json`));
    await fs.copyFile(
      path.join(directory, 'LICENSE'),
      path.join(outputRoot, `${dependency}-LICENSE.txt`),
    );
  }
  await fs.copyFile(
    path.join(monacoRoot, 'ThirdPartyNotices.txt'),
    path.join(outputRoot, 'monaco-editor-ThirdPartyNotices.txt'),
  );
  await fs.copyFile(
    path.join(path.dirname(require.resolve('jsonc-parser/package.json')), 'LICENSE.md'),
    path.join(outputRoot, 'jsonc-parser-LICENSE.md'),
  );
  for (const [name, file] of [
    ['vscode-textmate', 'LICENSE.md'],
    ['vscode-oniguruma', 'LICENSE.txt'],
  ])
    await fs.copyFile(
      path.join(path.dirname(require.resolve(`${name}/package.json`)), file),
      path.join(outputRoot, `${name}-LICENSE.txt`),
    );
  await fs.copyFile(
    path.join(path.dirname(require.resolve('vscode-oniguruma/package.json')), 'NOTICES.txt'),
    path.join(outputRoot, 'vscode-oniguruma-NOTICES.txt'),
  );
  await fs.cp(path.join(root, 'media'), path.join(outputRoot, 'webview'), { recursive: true });
  console.log('Built extension, webviews, Less styles and icon bridge in out/.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
