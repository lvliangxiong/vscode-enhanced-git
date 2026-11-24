import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/basic-languages/monaco.contribution.js';
import 'monaco-editor/base/browser/ui/codicons/codicon/codicon.css';
import { createTokenizationSupport } from 'monaco-editor/languages/features/json/tokenization.js';

monaco.languages.register({ id: 'json', extensions: ['.json', '.jsonc'] });
monaco.languages.setTokensProvider('json', createTokenizationSupport(true));
import { mergeLayout } from './layout';
import { mergeResultLayout } from './three-way';
import { mergeFont, mergeTheme } from './theme';
import type { MountMergeEditors } from './types';
import { createTextMateAdapter } from './textmate';
import { createMergeScroll } from './scroll';
import { createMergeConnectors } from './connectors';
import { createMergeAlignment } from './alignment';
import { mergeOverviewMarkers, createMergeOverviewNavigation } from './overview';
import { mergeDiffStyle, type MergeDiffStyle } from '../../shared/merge-diff';

import { configureWorker, languageFor } from './editor-support';

export const mountMergeEditors: MountMergeEditors = async (containers, data) => {
  configureWorker();
  const nativeLayout = mergeLayout(data);
  const jetbrainsLayout = mergeResultLayout(data, nativeLayout);
  const models: monaco.editor.ITextModel[] = [];
  const editors: monaco.editor.IStandaloneCodeEditor[] = [];
  const subscriptions: monaco.IDisposable[] = [];
  let themeObserver: MutationObserver;
  let syntax: ReturnType<typeof createTextMateAdapter>;
  let disposed = false;
  let repaint = () => {};
  let presentation: monaco.IDisposable;
  let updateAlignment = () => {};
  let navigate: (direction: -1 | 1) => void = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    themeObserver?.disconnect();
    syntax?.dispose();
    presentation?.dispose();
    subscriptions.forEach((item) => item.dispose());
    editors.forEach((item) => item.dispose());
    models.forEach((item) => item.dispose());
  };
  try {
    let font = mergeFont(getComputedStyle(document.body));
    const updateTheme = () => {
      const style = getComputedStyle(document.body);
      font = mergeFont(style);
      monaco.editor.defineTheme(
        'vscode-enhanced-git-merge',
        mergeTheme(style, document.body.className),
      );
      monaco.editor.setTheme('vscode-enhanced-git-merge');
      syntax?.applyColors();
      editors.forEach((editor) => editor.updateOptions(font));
      updateAlignment();
      repaint();
    };
    updateTheme();
    const language = languageFor(data.path);
    containers.forEach((container, side) => {
      const model = monaco.editor.createModel(data.contents[side], language);
      models.push(model);
      const editor = monaco.editor.create(container, {
        model,
        theme: 'vscode-enhanced-git-merge',
        ...font,
        readOnly: true,
        domReadOnly: true,
        ariaLabel: data.labels[side] + ' (read-only)',
        automaticLayout: true,
        wordWrap: 'off',
        minimap: { enabled: false },
        hideCursorInOverviewRuler: true,
        overviewRulerLanes: 1,
        overviewRulerBorder: false,
        folding: false,
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        stickyScroll: { enabled: false },
        renderLineHighlight: 'none',
        renderWhitespace: 'selection',
        padding: { top: 8, bottom: 8 },
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 4,
        glyphMargin: false,
        contextmenu: true,
        links: false,
        selectionHighlight: false,
        occurrencesHighlight: 'off',
        codeLens: false,
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
          horizontal: 'auto',
        },
      });
      editors.push(editor);
    });
    const decorations = editors.map((editor) => editor.createDecorationsCollection());
    const overviewDecorations = editors.map((editor) => editor.createDecorationsCollection());
    let style: MergeDiffStyle;
    const setStyle = (value: MergeDiffStyle) => {
      const next = mergeDiffStyle(value);
      if (next === style) return;
      const source = editors.find((editor) => editor.hasTextFocus()) || editors[1];
      const line = source.getVisibleRanges()[0]?.startLineNumber || 1;
      const offset = source.getScrollTop() - source.getTopForLineNumber(line);
      const restoreScroll = !!presentation;
      presentation?.dispose();
      style = next;
      const aligned = style === 'native';
      const layout = aligned ? nativeLayout : jetbrainsLayout;
      const overview = models.map((model, side) =>
        mergeOverviewMarkers(layout, side, aligned, model.getLineCount()),
      );
      containers[0].closest('.merge-panes')?.classList.toggle('merge-native', aligned);
      editors.forEach((editor, side) => {
        overviewDecorations[side].set(
          overview[side].map((marker) => ({
            range: new monaco.Range(marker.line, 1, marker.endLine, 1),
            options: {
              overviewRuler: {
                position: monaco.editor.OverviewRulerLane.Full,
                color: {
                  id: `editorGutter.${marker.kind === 'inserted' ? 'added' : marker.kind === 'modified' ? 'modified' : 'deleted'}Background`,
                },
              },
            },
          })),
        );
        editor.updateOptions({ lineDecorationsWidth: aligned ? 16 : 4 });
        decorations[side].set(
          layout.sides[side].map(({ start, end, kind }) => ({
            range: new monaco.Range(start + 1, 1, end, 1),
            options: {
              isWholeLine: true,
              className: `merge-${aligned ? (side === 1 ? 'inserted' : 'deleted') : kind}-line`,
              linesDecorationsClassName: aligned
                ? `merge-change-gutter codicon codicon-${side === 1 ? 'add' : 'remove'}`
                : undefined,
            },
          })),
        );
      });
      const alignment = aligned ? createMergeAlignment(editors, layout) : undefined;
      updateAlignment = () => alignment?.update(font.lineHeight);
      updateAlignment();
      const connectors = aligned
        ? undefined
        : createMergeConnectors(containers, editors, layout, () => font.lineHeight);
      repaint = () => connectors?.schedule();
      const scroll = createMergeScroll(editors, layout, () => font.lineHeight, repaint, aligned);
      const overviewClicks = editors.map((editor, side) =>
        createMergeOverviewNavigation(
          containers[side],
          editor,
          overview[side],
          () => font.lineHeight,
          (change) => scroll.revealChange(change, side),
        ),
      );
      navigate = scroll.navigate;
      presentation = {
        dispose() {
          overviewClicks.forEach((listener) => listener.dispose());
          scroll.dispose();
          connectors?.dispose();
          alignment?.dispose();
        },
      };
      if (restoreScroll)
        source.setScrollTop(Math.max(0, source.getTopForLineNumber(line) + offset));
      editors.forEach((editor) => editor.render());
    };
    setStyle(mergeDiffStyle(data.style));
    syntax = createTextMateAdapter(models);
    let themeFrame = 0;
    subscriptions.push({ dispose: () => cancelAnimationFrame(themeFrame) });
    themeObserver = new MutationObserver(() => {
      cancelAnimationFrame(themeFrame);
      themeFrame = requestAnimationFrame(updateTheme);
    });
    const watch = { attributes: true, attributeFilter: ['style', 'class', 'data-vscode-theme-id'] };
    themeObserver.observe(document.body, watch);
    themeObserver.observe(document.documentElement, watch);
    return {
      dispose,
      setStyle,
      navigate(direction) {
        // Navigation is supplied by the active presentation, without recreating models.
        navigate(direction);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
};
