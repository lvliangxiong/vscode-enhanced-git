import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Registry, INITIAL } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';
import { createSyntaxResolver, tokenSettings } from '../src/extension/syntax/resolver';
import { mergeSyntaxService } from '../src/extension/syntax/service';

test('token overrides honor global rules, matching theme selectors and wildcard selectors', () => {
  const result = tokenSettings(
    {
      comments: '#123456',
      textMateRules: [{ scope: 'keyword', settings: { foreground: '#222222' } }],
      '[Other]': { comments: '#ffffff' },
      '[Dark*][Other]': { comments: { foreground: '#654321', fontStyle: 'italic' } },
      '[Dark Test]': { textMateRules: [{ scope: 'keyword', settings: { foreground: '#abcdef' } }] },
    },
    'Dark Test',
  );
  assert.deepEqual(
    result.map((rule) => rule.settings.foreground),
    ['#123456', '#222222', '#654321', '#abcdef'],
  );
  assert.equal(result[2].settings.fontStyle, 'italic');
});

test('syntax resolver reads inherited JSONC themes, file associations, injected grammars and cache invalidation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-syntax-'));
  try {
    await fs.writeFile(
      path.join(root, 'base.json'),
      '{// theme\n"tokenColors":[{"scope":"comment","settings":{"foreground":"#112233"}}],}',
    );
    await fs.writeFile(
      path.join(root, 'theme.json'),
      JSON.stringify({
        include: './base.json',
        tokenColors: [{ scope: 'keyword', settings: { foreground: '#abcdef' } }],
      }),
    );
    await fs.writeFile(
      path.join(root, 'grammar.json'),
      JSON.stringify({
        scopeName: 'source.fixture',
        patterns: [{ match: '//.*$', name: 'comment.fixture' }],
      }),
    );
    const vscode = {
      extensions: {
        all: [
          {
            extensionPath: root,
            packageJSON: {
              contributes: {
                themes: [{ id: 'Fixture', label: 'Fixture Theme', path: './theme.json' }],
                languages: [{ id: 'fixture', extensions: ['.example'] }],
                grammars: [
                  {
                    language: 'fixture',
                    scopeName: 'source.fixture',
                    path: './grammar.json',
                    injectTo: ['source.host'],
                    embeddedLanguages: { 'meta.js': 'javascript' },
                  },
                ],
              },
            },
          },
        ],
      },
      workspace: {
        getConfiguration: (section) => ({
          get: (name, fallback) =>
            section === 'workbench' && name === 'colorTheme' ? 'Fixture' : fallback,
        }),
      },
    } as any;
    const resolver = createSyntaxResolver(vscode);
    const snapshot = await resolver.snapshot({
      path: 'custom.file',
      associations: { '*.file': 'fixture' },
      customizations: { comments: '#334455' },
    });
    assert.equal(snapshot.language, 'fixture');
    assert.deepEqual(
      snapshot.settings.map((rule) => rule.settings.foreground),
      ['#112233', '#abcdef', '#334455'],
    );
    assert.deepEqual(snapshot.grammars[0].injectTo, ['source.host']);
    assert.equal(
      'file' in snapshot.grammars[0],
      false,
      'filesystem paths remain in the extension host',
    );
    const grammar = await resolver.grammar('source.fixture');
    assert.equal(grammar.scopeName, 'source.fixture');
    assert.equal(await resolver.grammar('unknown'), null);
    await fs.writeFile(
      path.join(root, 'grammar.json'),
      JSON.stringify({ scopeName: 'source.updated', patterns: [] }),
    );
    assert.equal((await resolver.grammar('source.fixture')).scopeName, 'source.fixture');
    resolver.reset();
    assert.equal((await resolver.grammar('source.fixture')).scopeName, 'source.updated');
    await fs.writeFile(path.join(root, 'theme.json'), '{"include":"./theme.json"}');
    resolver.reset();
    await assert.rejects(resolver.snapshot({ path: 'a.example' }), /Cyclic theme include/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('packaged TextMate engine preserves multiline state and applies updated theme metadata', async () => {
  const wasm = await fs.readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm);
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) =>
      scope === 'source.fixture'
        ? {
            scopeName: scope,
            repository: { $self: {}, $base: {} },
            patterns: [
              { name: 'comment.block.fixture', begin: '/\\*', end: '\\*/' },
              { name: 'keyword.fixture', match: '\\bconst\\b' },
            ],
          }
        : null,
  });
  try {
    const grammar = await registry.loadGrammarWithConfiguration('source.fixture', 7, {});
    registry.setTheme({
      settings: [{ scope: 'comment', settings: { foreground: '#123456', fontStyle: 'italic' } }],
    });
    const first = grammar.tokenizeLine2('/* start', INITIAL);
    const next = grammar.tokenizeLine2('still a comment */ const', first.ruleStack);
    const foreground = (value: number) => registry.getColorMap()[(value >>> 15) & 511];
    assert.equal(foreground(first.tokens[1]), '#123456');
    assert.equal(foreground(next.tokens[1]), '#123456');
    assert.equal(first.tokens[1] & 255, 7, 'encoded language metadata remains compatible');
    registry.setTheme({ settings: [{ scope: 'comment', settings: { foreground: '#FEDCBA' } }] });
    assert.equal(foreground(grammar.tokenizeLine2('/* start', INITIAL).tokens[1]), '#FEDCBA');
  } finally {
    registry.dispose();
  }
});

test('Remote syntax uses the UI theme, prefers workspace grammars and routes missing scopes to the UI bridge', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-remote-syntax-'));
  const commands = new Map<string, (...args: any[]) => void>();
  const subscriptions: any[] = [];
  try {
    await fs.writeFile(
      path.join(root, 'remote.json'),
      '{"scopeName":"source.remote","patterns":[]}',
    );
    const local = {
      name: 'Local Theme',
      available: true,
      settings: [{ scope: 'comment', settings: { foreground: '#123456' } }],
      language: 'local',
      grammars: [
        { scopeName: 'source.shared', language: 'local' },
        { scopeName: 'source.ui', language: 'ui' },
      ],
    };
    const calls: any[] = [];
    const event = () => ({ dispose() {} });
    const api = {
      Uri: { file: (file) => ({ fsPath: file }) },
      env: { remoteName: 'ssh-remote' },
      extensions: {
        all: [
          {
            extensionPath: root,
            packageJSON: {
              contributes: {
                languages: [{ id: 'remote', extensions: ['.go'] }],
                grammars: [{ scopeName: 'source.shared', language: 'remote', path: 'remote.json' }],
              },
            },
          },
        ],
        onDidChange: event,
      },
      window: { onDidChangeActiveColorTheme: event },
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
        onDidChangeConfiguration: event,
      },
      commands: {
        registerCommand: (name, handler) => {
          commands.set(name, handler);
          return {
            dispose() {
              commands.delete(name);
            },
          };
        },
        executeCommand: async (name, ...args) => {
          calls.push([name, ...args]);
          return name === 'vsgit.syntax.snapshot'
            ? local
            : { scopeName: 'source.ui', patterns: [] };
        },
      },
    } as any;
    const service = mergeSyntaxService(api, { subscriptions } as any);
    const snapshot = await service.snapshot(path.join(root, 'file.go'), 'Local Theme');
    assert.equal(calls.find(([name]) => name === 'vsgit.syntax.snapshot')[1].theme, 'Local Theme');
    assert.equal(snapshot.name, 'Local Theme');
    assert.deepEqual(snapshot.settings, local.settings);
    assert.equal(snapshot.language, 'remote');
    assert.equal(
      snapshot.grammars.find((item) => item.scopeName === 'source.shared').language,
      'remote',
    );
    assert.equal((await service.grammar('source.shared')).scopeName, 'source.remote');
    assert.equal(calls.filter(([name]) => name === 'vsgit.syntax.grammar').length, 0);
    assert.equal((await service.grammar('source.ui')).scopeName, 'source.ui');
    assert.equal(calls.at(-1)[0], 'vsgit.syntax.grammar');
    let changed = 0;
    const listener = service.subscribe(() => changed++);
    commands.get('vsgit.syntax.changed')();
    assert.equal(changed, 1);
    listener.dispose();
    commands.get('vsgit.syntax.changed')();
    assert.equal(changed, 1);
  } finally {
    subscriptions.forEach((item) => item.dispose());
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('actual webview theme overrides a stale configured theme and applies the matching token customizations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vsgit-active-theme-'));
  try {
    await fs.writeFile(
      path.join(root, 'dark.json'),
      JSON.stringify({
        tokenColors: [{ scope: 'keyword', settings: { foreground: '#aabbcc' } }],
      }),
    );
    await fs.writeFile(
      path.join(root, 'light.json'),
      JSON.stringify({
        tokenColors: [{ scope: 'keyword', settings: { foreground: '#112233' } }],
      }),
    );
    const api = {
      workspace: { getConfiguration: () => ({ get: () => 'Configured Dark' }) },
      extensions: {
        all: [
          {
            extensionPath: root,
            packageJSON: {
              contributes: {
                themes: [
                  { id: 'Configured Dark', path: 'dark.json' },
                  { label: 'Actual Light', path: 'light.json' },
                ],
              },
            },
          },
        ],
      },
    } as any;
    const resolver = createSyntaxResolver(api);
    const request = {
      path: 'file.go',
      customizations: {
        '[Configured Dark]': { strings: '#dddddd' },
        '[Actual Light]': { strings: '#223344' },
      },
    };
    assert.equal((await resolver.snapshot(request)).name, 'Configured Dark');
    const light = await resolver.snapshot({ ...request, theme: 'Actual Light' });
    assert.equal(light.name, 'Actual Light');
    assert.equal(light.available, true);
    assert.deepEqual(
      light.settings.map((rule) => rule.settings.foreground),
      ['#112233', '#223344'],
    );
    const dark = await resolver.snapshot({ ...request, theme: 'Configured Dark' });
    assert.deepEqual(
      dark.settings.map((rule) => rule.settings.foreground),
      ['#aabbcc', '#dddddd'],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
