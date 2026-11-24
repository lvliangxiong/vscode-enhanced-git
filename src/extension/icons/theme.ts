'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
import { parse } from 'jsonc-parser';
const normalize = (value) =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
const keyed = (map) =>
  Object.fromEntries(Object.entries(map || {}).map(([key, value]) => [normalize(key), value]));
function associations(theme, kind) {
  const override =
    kind === 1
      ? theme.light
      : kind === 3
        ? theme.highContrast
        : kind === 4
          ? theme.highContrastLight || theme.light
          : undefined;
  const result = { ...theme, ...override };
  for (const key of [
    'fileNames',
    'fileExtensions',
    'folderNames',
    'folderNamesExpanded',
    'rootFolderNames',
    'rootFolderNamesExpanded',
    'languageIds',
  ])
    result[key] = keyed({ ...theme[key], ...override?.[key] });
  return result;
}
function matchName(map, name, parent) {
  return map[parent + '/' + name] ?? map[name];
}
function matchExtension(map, name, parent) {
  const parts = name.split('.');
  parts.shift();
  const endings = parts.map((_, i) => parts.slice(i).join('.'));
  for (const suffix of endings)
    if (map[parent + '/' + suffix] !== undefined) return map[parent + '/' + suffix];
  for (const suffix of endings) if (map[suffix] !== undefined) return map[suffix];
}
function globMatch(pattern, value) {
  const expression = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll('\0', '.*');
  try {
    return new RegExp('^' + expression + '$', 'i').test(
      pattern.includes('/') ? value : value.split('/').pop(),
    );
  } catch {
    return false;
  }
}
function languageFor(resource, languages, custom = {}) {
  const normalized = normalize(resource),
    name = normalized.split('/').pop() ?? '';
  const customMatch = Object.entries(custom)
    .filter(([pattern]) => globMatch(pattern, normalized))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (customMatch) return customMatch[1];
  let result,
    score = -1;
  for (const language of languages) {
    const exact = (language.filenames || []).some((value) => normalize(value) === name);
    const pattern = (language.filenamePatterns || []).some((value) => globMatch(value, normalized));
    const extension = (language.extensions || [])
      .filter((value) => name.endsWith(normalize(value)))
      .sort((a, b) => b.length - a.length)[0];
    const rank = exact ? 100000 : pattern ? 10000 : extension ? extension.length : -1;
    if (rank >= 0 && rank >= score) {
      result = language.id;
      score = rank;
    }
  }
  return result;
}
function iconId(theme, entry, language) {
  const parts = normalize(entry.path).split('/'),
    name = parts.pop(),
    parent = parts.pop() || '';
  if (entry.directory) {
    return (
      (entry.expanded ? matchName(theme.folderNamesExpanded, name, parent) : undefined) ??
      matchName(theme.folderNames, name, parent) ??
      (entry.expanded ? theme.folderExpanded : undefined) ??
      theme.folder
    );
  }
  return (
    matchName(theme.fileNames, name, parent) ??
    matchExtension(theme.fileExtensions, name, parent) ??
    theme.languageIds[language] ??
    theme.file
  );
}
function createThemeResolver(vscode) {
  let loaded, loading;
  const assets = new Map();
  const reset = () => {
    loaded = undefined;
    loading = undefined;
    assets.clear();
  };
  async function dataUri(file) {
    if (!assets.has(file))
      assets.set(
        file,
        fs.readFile(file).then((bytes) => {
          const mime = {
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.otf': 'font/otf',
          }[path.extname(file).toLowerCase()];
          if (!mime || bytes.length > 8 * 1024 * 1024) throw Error('Unsupported icon asset');
          return `data:${mime};base64,${bytes.toString('base64')}`;
        }),
      );
    return assets.get(file);
  }
  async function load() {
    const id = vscode.workspace.getConfiguration('workbench').get('iconTheme');
    if (loaded?.id === id) return loaded;
    if (loading?.id === id) return loading.promise;
    const promise = (async () => {
      if (!id) return { id, none: true };
      for (const extension of vscode.extensions.all) {
        const contribution = extension.packageJSON.contributes?.iconThemes?.find(
          (theme) => theme.id === id,
        );
        if (!contribution) continue;
        const file = path.resolve(extension.extensionPath, contribution.path),
          errors = [];
        const theme = parse(await fs.readFile(file, 'utf8'), errors, { allowTrailingComma: true });
        if (errors.length || !theme?.iconDefinitions) throw Error('Invalid file icon theme');
        return { id, theme, directory: path.dirname(file) };
      }
      throw Error(`File icon theme is not available locally: ${id}`);
    })();
    loading = { id, promise };
    const result = await promise;
    loaded = result;
    return result;
  }
  async function resolve(request) {
    const entries = (request?.entries || [])
      .filter((entry) => typeof entry.key === 'string' && typeof entry.path === 'string')
      .slice(0, 1000);
    const state = await load();
    if (state.none)
      return {
        icons: {},
        entries: entries.map((entry) => ({ key: entry.key, id: null })),
        fonts: {},
      };
    const theme = associations(state.theme, vscode.window.activeColorTheme.kind),
      fonts = {},
      icons = {},
      resolved: { key: string; id: string | null }[] = [];
    const localLanguages = vscode.extensions.all.flatMap((extension) =>
      (extension.packageJSON.contributes?.languages || []).map((language) => ({
        ...language,
        extensionPath: extension.extensionPath,
      })),
    );
    const languages = [...(request.languages || []), ...localLanguages];
    const custom =
      request.associations || vscode.workspace.getConfiguration('files').get('associations', {});
    for (const entry of entries) {
      const language = languageFor(entry.path, languages, custom),
        id = iconId(theme, entry, language);
      const explicit = entry.directory
        ? true
        : (() => {
            const p = normalize(entry.path).split('/'),
              n = p.pop(),
              parent = p.pop() || '';
            return (
              matchName(theme.fileNames, n, parent) !== undefined ||
              matchExtension(theme.fileExtensions, n, parent) !== undefined ||
              theme.languageIds[language] !== undefined
            );
          })();
      const languageInfo = localLanguages.findLast((item) => item.id === language && item.icon);
      const languageIcon =
        !entry.directory &&
        !explicit &&
        languageInfo &&
        (theme.showLanguageModeIcons === true ||
          (theme.showLanguageModeIcons !== false &&
            Object.keys(theme.fileNames).length +
              Object.keys(theme.fileExtensions).length +
              Object.keys(theme.languageIds).length >
              0));
      const key = languageIcon ? 'language:' + language : String(id ?? '');
      resolved.push({ key: entry.key, id: key || null });
      if (!key || icons[key]) continue;
      try {
        if (languageIcon) {
          const image =
            languageInfo.icon[
              [1, 4].includes(vscode.window.activeColorTheme.kind) ? 'light' : 'dark'
            ];
          icons[key] = { image: await dataUri(path.resolve(languageInfo.extensionPath, image)) };
          continue;
        }
        const definition = state.theme.iconDefinitions[id];
        if (!definition) {
          icons[key] = {};
          continue;
        }
        if (definition.iconPath)
          icons[key] = { image: await dataUri(path.resolve(state.directory, definition.iconPath)) };
        else if (definition.fontCharacter) {
          const font = (state.theme.fonts || []).find(
            (font) => font.id === (definition.fontId || state.theme.fonts?.[0]?.id),
          );
          if (!font) {
            icons[key] = {};
            continue;
          }
          if (!fonts[font.id]) {
            const sources = await Promise.all(
              (font.src || []).map(async (src) => ({
                data: await dataUri(path.resolve(state.directory, src.path)),
                format: src.format,
              })),
            );
            fonts[font.id] = { sources, weight: font.weight, style: font.style };
          }
          icons[key] = {
            font: font.id,
            character: definition.fontCharacter.replace(/\\([a-fA-F0-9]{1,6})\s?/g, (_, hex) =>
              String.fromCodePoint(parseInt(hex, 16)),
            ),
            color: definition.fontColor,
            size: definition.fontSize || font.size,
          };
        } else icons[key] = {};
      } catch {
        icons[key] = {};
      }
    }
    return { theme: state.id, icons, entries: resolved, fonts };
  }
  return { resolve, reset };
}
export { createThemeResolver, associations, iconId, languageFor };
