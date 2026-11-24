import * as monaco from 'monaco-editor/editor/editor.api.js';
import { Registry, INITIAL, type StateStack, type IGrammar } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';
import type { RawGrammar, SyntaxSnapshot } from '../../shared/syntax';
import { requestSyntax, onSyntaxChanged } from './syntax-channel';
import { mergeTheme } from './theme';

let oniguruma: Promise<void>;
function loadOniguruma() {
  return (oniguruma ??= (async () => {
    const source = document.querySelector<HTMLMetaElement>('meta[name="merge-oniguruma"]')?.content;
    if (!source) throw Error('Missing packaged syntax engine');
    const response = await fetch(source);
    if (!response.ok) throw Error('Cannot load syntax engine');
    await loadWASM(await response.arrayBuffer());
  })());
}
class TokenState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return this;
  }
  equals(other: monaco.languages.IState) {
    return other instanceof TokenState && this.stack.equals(other.stack);
  }
}

/** Feed VS Code TextMate metadata into Monaco without replacing virtualized models. */
export function createTextMateAdapter(models: monaco.editor.ITextModel[]) {
  let disposed = false;
  let generation = 0;
  let registry: Registry | undefined;
  let registration: monaco.IDisposable | undefined;
  let current: SyntaxSnapshot | undefined;
  let grammar: IGrammar | undefined;
  let language = '';
  const fallbackLanguages = models.map((model) => model.getLanguageId());
  const languageRegistrations = new Map<string, monaco.IDisposable[]>();
  const grammarCache = new Map<string, Promise<RawGrammar | null>>();
  const activeTheme = () =>
    document.body.dataset.vscodeThemeId || document.body.dataset.vscodeThemeName || '';
  let requestedTheme = activeTheme();
  let palette = '';
  const fallback = () => {
    registration?.dispose();
    registration = undefined;
    registry?.dispose();
    registry = undefined;
    grammar = undefined;
    current = undefined;
    palette = '';
    monaco.languages.setColorMap(null);
    models.forEach((model, side) => monaco.editor.setModelLanguage(model, fallbackLanguages[side]));
  };
  const colors = () => {
    if (!registry || !current) return false;
    const style = getComputedStyle(document.body);
    const mapped = mergeTheme(style, document.body.className).colors;
    registry.setTheme({
      name: current.name,
      settings: [
        ...current.settings,
        {
          settings: {
            foreground:
              mapped['editor.foreground'] ||
              (document.body.classList.contains('vscode-light') ||
              document.body.classList.contains('vscode-high-contrast-light')
                ? '#000000'
                : '#D4D4D4'),
            background:
              mapped['editor.background'] ||
              (document.body.classList.contains('vscode-light') ||
              document.body.classList.contains('vscode-high-contrast-light')
                ? '#FFFFFF'
                : '#1E1E1E'),
          },
        },
      ],
    });
    const map = registry.getColorMap();
    const changed = palette !== JSON.stringify(map);
    palette = JSON.stringify(map);
    monaco.languages.setColorMap(map);
    return changed;
  };
  const register = () => {
    const activeGrammar = grammar;
    if (!activeGrammar) return;
    registration?.dispose();
    registration = monaco.languages.setTokensProvider(language, {
      getInitialState: () => new TokenState(INITIAL),
      tokenizeEncoded(line, state) {
        const result = activeGrammar.tokenizeLine2(line, (state as TokenState).stack, 20);
        return { tokens: result.tokens, endState: new TokenState(result.ruleStack) };
      },
    });
  };
  const refresh = async () => {
    const revision = ++generation;
    const snapshot = await requestSyntax<SyntaxSnapshot>('snapshot', { theme: requestedTheme });
    if (disposed || revision !== generation) return;
    if (!snapshot || snapshot.available === false) {
      fallback();
      return;
    }
    const info = snapshot.grammars.find((item) => item.language === snapshot.language);
    if (!info) {
      fallback();
      return;
    }
    await loadOniguruma();
    if (disposed || revision !== generation) return;
    const next = new Registry({
      onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
      loadGrammar: (scope) => {
        if (!grammarCache.has(scope))
          grammarCache.set(scope, requestSyntax<RawGrammar>('grammar', { scope }));
        return grammarCache.get(scope)!;
      },
      getInjections: (scope) =>
        snapshot.grammars
          .filter((item) => item.injectTo?.includes(scope))
          .map((item) => item.scopeName),
    });
    // A private language leaves the built-in provider intact for reliable fallback.
    const id = 'vscode-enhanced-git-textmate-' + snapshot.language;
    if (!languageRegistrations.has(id)) {
      monaco.languages.register({ id });
      languageRegistrations.set(id, [
        monaco.languages.setLanguageConfiguration(id, {
          brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')'],
          ],
        }),
      ]);
    }
    const embeddedLanguages = Object.fromEntries(
      Object.entries(info.embeddedLanguages || {}).map(([scope, id]) => {
        if (!monaco.languages.getLanguages().some((item) => item.id === id))
          monaco.languages.register({ id });
        return [scope, monaco.languages.getEncodedLanguageId(id)];
      }),
    );
    let loaded: IGrammar | null;
    try {
      loaded = await next.loadGrammarWithConfiguration(
        info.scopeName,
        monaco.languages.getEncodedLanguageId(id),
        {
          embeddedLanguages,
          tokenTypes: Object.fromEntries(
            Object.entries(info.tokenTypes || {}).map(([scope, type]) => [
              scope,
              { other: 0, comment: 1, string: 2 }[type],
            ]),
          ),
        },
      );
    } catch (error) {
      next.dispose();
      throw error;
    }
    if (disposed || revision !== generation || !loaded) {
      next.dispose();
      if (!disposed && revision === generation) fallback();
      return;
    }
    const previous = registry;
    registry = next;
    palette = '';
    current = snapshot;
    grammar = loaded;
    language = id;
    colors();
    models.forEach((model) => monaco.editor.setModelLanguage(model, id));
    register();
    previous?.dispose();
  };
  const update = () => {
    requestedTheme = activeTheme();
    const expected = generation + 1;
    void refresh().catch((error) => {
      if (!disposed && expected === generation) {
        fallback();
        console.warn('Enhanced Git syntax fallback:', error.message);
      }
    });
  };
  const listener = onSyntaxChanged(() => {
    grammarCache.clear();
    update();
  });
  update();
  return {
    applyColors() {
      if (requestedTheme !== activeTheme()) {
        // Never pair the previous theme's scope colors with the new UI palette.
        fallback();
        update();
      } else if (current && requestedTheme && current.name !== requestedTheme) {
        fallback();
      } else if (colors()) {
        // Encoded tokens contain color-map indices. A new map needs new tokens too.
        register();
      }
    },
    dispose() {
      disposed = true;
      generation++;
      listener.dispose();
      registration?.dispose();
      registry?.dispose();
      languageRegistrations.forEach((items) => items.forEach((item) => item.dispose()));
      grammarCache.clear();
    },
  };
}
