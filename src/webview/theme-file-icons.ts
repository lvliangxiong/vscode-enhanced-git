export interface FileIconMessage {
  type: string;
  generation?: number;
  unavailable?: boolean;
  fonts?: Record<
    string,
    { sources: { data: string; format?: string }[]; weight?: string; style?: string }
  >;
  icons?: Record<
    string,
    { image?: string; font?: string; character?: string; color?: string; size?: string }
  >;
  entries?: { key: string; id?: string }[];
}

/* File/folder icons share the active VS Code theme, including local UI-host assets. */
export const VsCodeEnhancedGitFileIcons = {
  create({
    send,
    sheet,
    document = globalThis.document,
    window = globalThis.window,
    scope = {},
  }: {
    send(type: string, payload?: object): void;
    sheet: CSSStyleSheet;
    document?: Document;
    window?: Window;
    scope?: { vsCodeEnhancedGitFontSheet?: CSSStyleSheet; vsCodeEnhancedGitFontPrefix?: string };
  }) {
    let generation = 0,
      request = 0,
      timer;
    const cache = new Map(),
      pending = new Map(),
      inflight = new Map(),
      classes = new Map(),
      fonts = new Map();
    const index = sheet.insertRule('@media all {}', sheet.cssRules.length),
      rules = sheet.cssRules[index] as CSSGroupingRule;
    const fontSheet = scope.vsCodeEnhancedGitFontSheet || sheet,
      fontIndex = fontSheet.insertRule('@media all {}', fontSheet.cssRules.length),
      fontRules = fontSheet.cssRules[fontIndex] as CSSGroupingRule;
    const nodes = () => document.querySelectorAll<HTMLElement>('.theme-file-icon');
    const update = (node) => {
      const key = node.dataset.iconKey,
        value = cache.get(key);
      node.className = 'theme-file-icon' + (value ? ' ' + value : '');
      if (!cache.has(key) && !inflight.has(key)) pending.set(key, JSON.parse(key));
    };
    const schedule = () => {
      if (timer || !pending.size) return;
      timer = setTimeout(() => {
        timer = undefined;
        const entries = [...pending].slice(0, 500).map(([key, entry]) => ({ key, ...entry }));
        for (const entry of entries) {
          pending.delete(entry.key);
          inflight.set(entry.key, true);
        }
        send('fileIcons', { entries, generation, request: ++request });
        schedule();
      }, 0);
    };
    function set(node, path, directory = false, expanded = false) {
      node.dataset.iconKey = JSON.stringify({ path, directory, expanded });
      update(node);
      schedule();
      return node;
    }
    function node(path, directory = false, expanded = false) {
      const element = document.createElement('span');
      element.setAttribute('aria-hidden', 'true');
      return set(element, path, directory, expanded);
    }
    function reset() {
      generation++;
      cache.clear();
      pending.clear();
      inflight.clear();
      classes.clear();
      fonts.clear();
      while (rules.cssRules.length) rules.deleteRule(0);
      while (fontRules.cssRules.length) fontRules.deleteRule(0);
      for (const node of nodes()) update(node);
      schedule();
    }
    function receive(data: FileIconMessage) {
      if (data.type === 'fileIconsChanged') {
        reset();
        return;
      }
      if (data.type !== 'fileIcons' || data.generation !== generation) return;
      if (data.unavailable) {
        for (const [key] of inflight) cache.set(key, 'theme-file-icon-fallback');
        inflight.clear();
        for (const node of nodes()) update(node);
        return;
      }
      for (const [id, font] of Object.entries(data.fonts || {}))
        if (!fonts.has(id)) {
          const family =
            'vscode-enhanced-git-file-font-' +
            (scope.vsCodeEnhancedGitFontPrefix || '') +
            generation +
            '-' +
            fonts.size;
          fonts.set(id, family);
          const sources = font.sources.filter((src) =>
            /^data:font\/[\w-]+;base64,[A-Za-z0-9+/=]+$/.test(src.data),
          );
          if (sources.length) {
            const rule = fontRules.insertRule('@font-face {}', fontRules.cssRules.length),
              style = (fontRules.cssRules[rule] as CSSStyleRule).style;
            style.fontFamily = family;
            style.setProperty('src', sources.map((src) => `url("${src.data}")`).join(','));
            style.fontWeight = font.weight || 'normal';
            style.fontStyle = font.style || 'normal';
          }
        }
      for (const [id, icon] of Object.entries(data.icons || {}))
        if (!classes.has(id)) {
          const cls = 'theme-file-' + generation + '-' + classes.size;
          classes.set(id, cls);
          const at = rules.insertRule('.' + cls + '::before {}', rules.cssRules.length),
            style = (rules.cssRules[at] as CSSStyleRule).style;
          if (icon.image && /^data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+$/.test(icon.image)) {
            style.content = '""';
            style.backgroundImage = `url("${icon.image}")`;
          } else if (icon.font && fonts.has(icon.font)) {
            style.content = JSON.stringify(icon.character);
            style.fontFamily = fonts.get(icon.font);
            style.color = icon.color || 'inherit';
            style.fontSize = /^\d+(\.\d+)?(px|%|em)$/.test(icon.size) ? icon.size : '100%';
          }
        }
      for (const entry of data.entries || []) {
        inflight.delete(entry.key);
        cache.set(entry.key, entry.id ? classes.get(entry.id) || '' : '');
      }
      for (const node of nodes()) update(node);
      schedule();
    }
    const listener = (event: MessageEvent) => receive(event.data);
    window.addEventListener('message', listener);
    return {
      node,
      set,
      receive,
      reset,
      dispose() {
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        pending.clear();
        inflight.clear();
        cache.clear();
      },
    };
  },
};
