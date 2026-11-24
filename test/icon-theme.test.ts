import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { isBuiltin } from 'node:module';
const {
  associations,
  iconId,
  languageFor,
  createThemeResolver,
} = require('../out/extension/icons/theme');
test('theme matching uses filename, parent suffix, compound extension, language and fallback precedence', () => {
  const t = associations(
    {
      file: 'fallback',
      fileNames: { 'src/HELLO.TS': 'name-parent', 'hello.ts': 'name' },
      fileExtensions: { 'src/ts': 'parent', 'd.ts': 'compound', ts: 'simple' },
      languageIds: { typescript: 'language' },
      folder: 'closed',
      folderExpanded: 'open',
      folderNames: { src: 'src' },
      folderNamesExpanded: { src: 'src-open' },
      light: { fileExtensions: { ts: 'light' } },
    },
    2,
  );
  assert.equal(iconId(t, { path: 'src/hello.ts' }, 'typescript'), 'name-parent');
  assert.equal(iconId(t, { path: 'hello.ts' }, 'typescript'), 'name');
  assert.equal(iconId(t, { path: 'src/a.d.ts' }, 'typescript'), 'parent');
  assert.equal(iconId(t, { path: 'a.d.ts' }, 'typescript'), 'compound');
  assert.equal(iconId(t, { path: 'a' }, 'typescript'), 'language');
  assert.equal(iconId(t, { path: 'x' }), 'fallback');
  assert.equal(iconId(t, { path: 'src', directory: true, expanded: true }), 'src-open');
  assert.equal(iconId(t, { path: 'elsewhere', directory: true, expanded: true }), 'open');
  assert.equal(iconId(associations(t, 1), { path: 'a.ts' }), 'light');
  assert.equal(
    iconId(
      associations(
        { folder: 'base', light: { folder: 'light' }, highContrast: { folder: 'hc' } },
        3,
      ),
      { path: 'folder', directory: true },
    ),
    'hc',
  );
});
test('language associations include remote languages, filenames, longest extensions and user mappings', () => {
  const langs = [
    { id: 'typescript', extensions: ['.ts'] },
    { id: 'go', extensions: ['.go'] },
    { id: 'config', filenames: ['go.mod'] },
    { id: 'template', filenamePatterns: ['*.yaml.template'] },
  ];
  assert.equal(languageFor('app/main.go', langs), 'go');
  assert.equal(languageFor('go.mod', langs), 'config');
  assert.equal(languageFor('x.yaml.template', langs), 'template');
  assert.equal(languageFor('x.go', langs, { '*.go': 'plaintext' }), 'plaintext');
});
test('JSONC themes resolve only needed assets and font glyphs; reset follows theme changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-enhanced-git-theme-'));
  try {
    // A packaged extension cannot resolve dependencies from our development
    // node_modules. Allow only Node built-ins to catch accidental external imports.
    const bundled = { exports: {} as { createThemeResolver: typeof createThemeResolver } };
    vm.runInNewContext(await fs.readFile(require.resolve('../out/extension/icons/theme'), 'utf8'), {
      module: bundled,
      exports: bundled.exports,
      Buffer,
      require(name: string) {
        assert.ok(isBuiltin(name), `Unbundled runtime dependency: ${name}`);
        return require(name);
      },
    });
    assert.equal(
      await fs.readFile(path.resolve(__dirname, '../out/jsonc-parser-LICENSE.md'), 'utf8'),
      await fs.readFile(
        path.join(path.dirname(require.resolve('jsonc-parser/package.json')), 'LICENSE.md'),
        'utf8',
      ),
    );
    await fs.writeFile(path.join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fs.writeFile(path.join(root, 'font.woff'), 'fixture font');
    const theme = {
      file: 'glyph',
      fileExtensions: { go: 'go' },
      iconDefinitions: {
        go: { iconPath: './icon.svg' },
        glyph: { fontCharacter: '\\E001', fontColor: '#123456' },
      },
      fonts: [{ id: 'font', size: '150%', src: [{ path: 'font.woff', format: 'woff' }] }],
    };
    await fs.writeFile(path.join(root, 'theme.json'), '// comment\n' + JSON.stringify(theme));
    let id = 'fixture';
    const v = {
      extensions: {
        all: [
          {
            extensionPath: root,
            packageJSON: { contributes: { iconThemes: [{ id: 'fixture', path: 'theme.json' }] } },
          },
        ],
      },
      workspace: {
        getConfiguration: (section) => ({ get: () => (section === 'workbench' ? id : {}) }),
      },
      window: { activeColorTheme: { kind: 2 } },
    };
    const r = bundled.exports.createThemeResolver(v),
      result = await r.resolve({
        entries: [
          { key: 'go', path: 'main.go' },
          { key: 'other', path: 'x' },
        ],
      });
    assert.match(result.icons.go.image, /^data:image\/svg\+xml;base64,/);
    assert.equal(result.icons.glyph.character, '\ue001');
    assert.equal(result.icons.glyph.size, '150%');
    assert.match(result.fonts.font.sources[0].data, /^data:font\/woff;base64,/);
    id = null;
    r.reset();
    const none = await r.resolve({ entries: [{ key: 'go', path: 'main.go' }] });
    assert.equal(none.entries[0].id, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
