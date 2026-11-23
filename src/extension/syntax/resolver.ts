import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { parseRawGrammar, type IRawTheme } from 'vscode-textmate';
import type * as VSCode from 'vscode';
import type { GrammarInfo, SyntaxRequest, SyntaxSnapshot } from '../../shared/syntax';
import { languageFor } from '../icons/theme';

/** Match VS Code's global token customizations followed by matching theme overrides. */
export function tokenSettings(
  custom: Record<string, any>,
  themeName: string,
): IRawTheme['settings'] {
  const rules: IRawTheme['settings'] = [];
  const scopes = {
    comments: ['comment', 'punctuation.definition.comment'],
    strings: ['string', 'meta.embedded.assembly'],
    numbers: ['constant.numeric'],
    keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
    types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
    functions: ['entity.name.function', 'support.function'],
    variables: ['variable', 'entity.name.variable'],
  };
  const append = (value: Record<string, any>) => {
    for (const [key, scope] of Object.entries(scopes)) {
      const setting = value?.[key];
      if (setting)
        rules.push({
          scope,
          settings: typeof setting === 'string' ? { foreground: setting } : setting,
        });
    }
    rules.push(...(Array.isArray(value?.textMateRules) ? value.textMateRules : []));
  };
  append(custom);
  for (const [key, value] of Object.entries(custom || {})) {
    if (!key.startsWith('[')) continue;
    const matches = [...key.matchAll(/\[([^\]]+)\]/g)].some(([, name]) => {
      const pattern = name
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp(`^${pattern}$`).test(themeName);
    });
    if (matches) append(value);
  }
  return rules;
}

export function createSyntaxResolver(vscode: typeof VSCode) {
  let files = new Map<string, Promise<any>>();
  const extensions = () => vscode.extensions.all;
  const grammars = () =>
    extensions().flatMap((extension) =>
      (extension.packageJSON.contributes?.grammars || []).map((grammar) => ({
        ...grammar,
        file: path.resolve(extension.extensionPath, grammar.path),
      })),
    );
  const read = (file: string) => {
    if (!files.has(file))
      files.set(
        file,
        (async () => {
          const stat = await fs.stat(file);
          if (stat.size > 10 * 1024 * 1024) throw Error('Syntax resource exceeds size limit');
          const text = await fs.readFile(file, 'utf8');
          if (file.endsWith('.tmTheme') || file.endsWith('.tmLanguage'))
            return parseRawGrammar(text, file);
          const errors = [];
          const value = parse(text, errors, { allowTrailingComma: true });
          if (errors.length) throw Error('Invalid syntax resource');
          return value;
        })(),
      );
    return files.get(file);
  };
  const readTheme = async (file: string, parents = new Set<string>()): Promise<any[]> => {
    if (parents.has(file) || parents.size >= 16) throw Error('Cyclic theme include');
    const next = new Set(parents).add(file);
    const theme = await read(file);
    const inherited = theme.include
      ? await readTheme(path.resolve(path.dirname(file), theme.include), next)
      : [];
    const tokens =
      typeof theme.tokenColors === 'string'
        ? (await read(path.resolve(path.dirname(file), theme.tokenColors))).settings
        : theme.tokenColors || theme.settings || [];
    return [...inherited, ...(Array.isArray(tokens) ? tokens : [])];
  };
  return {
    reset() {
      files = new Map();
    },
    catalog(): GrammarInfo[] {
      return grammars().map(({ file, path: ignored, ...grammar }) => grammar);
    },
    async grammar(scope: string) {
      const grammar = grammars().findLast((item) => item.scopeName === scope);
      return grammar ? read(grammar.file) : null;
    },
    async snapshot(request: SyntaxRequest): Promise<SyntaxSnapshot> {
      const name =
        request.theme ||
        vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ||
        '';
      const legacy = name.replace(/^Default (?=(?:Dark|Light)(?:\+| Modern)$)/, '');
      const theme = extensions()
        .flatMap((extension) =>
          (extension.packageJSON.contributes?.themes || []).map((item) => ({
            ...item,
            directory: extension.extensionPath,
          })),
        )
        .find((item) => item.id === name || item.label === name || item.id === legacy);
      const settings = theme ? await readTheme(path.resolve(theme.directory, theme.path)) : [];
      const custom =
        request.customizations ??
        vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations', {});
      const languages = extensions().flatMap(
        (extension) => extension.packageJSON.contributes?.languages || [],
      );
      return {
        name,
        available: !!theme,
        settings: [...settings, ...tokenSettings(custom, name)],
        grammars: this.catalog(),
        language: languageFor(request.path, languages, request.associations || {}),
      };
    },
  };
}
