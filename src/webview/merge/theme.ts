import type { editor } from 'monaco-editor';

const colors = [
  'editor.background',
  'editor.foreground',
  'editorGutter.background',
  'editorGutter.addedBackground',
  'editorGutter.deletedBackground',
  'editorGutter.modifiedBackground',
  'editorOverviewRuler.background',
  'editorHoverWidget.background',
  'editorHoverWidget.foreground',
  'editorHoverWidget.border',
  'editorLink.activeForeground',
  'editorBracketMatch.background',
  'editorBracketMatch.border',
  'diffEditor.insertedTextBackground',
  'diffEditor.removedTextBackground',
  'editor.selectionBackground',
  'editor.inactiveSelectionBackground',
  'editor.selectionHighlightBackground',
  'editor.lineHighlightBackground',
  'editorCursor.foreground',
  'editorLineNumber.foreground',
  'editorLineNumber.activeForeground',
  'editorWhitespace.foreground',
  'editorIndentGuide.background1',
  'editorIndentGuide.activeBackground1',
  'editorWidget.background',
  'editorWidget.foreground',
  'editorWidget.border',
  'editorWidget.resizeBorder',
  'editor.findMatchBackground',
  'editor.findMatchHighlightBackground',
  'editor.findMatchBorder',
  'editor.findMatchHighlightBorder',
  'editorOverviewRuler.border',
  'scrollbarSlider.background',
  'scrollbarSlider.hoverBackground',
  'scrollbarSlider.activeBackground',
  'input.background',
  'input.foreground',
  'input.border',
  'inputOption.activeBorder',
  'inputOption.activeBackground',
  'focusBorder',
  'list.activeSelectionBackground',
  'list.activeSelectionForeground',
  'list.hoverBackground',
  'list.hoverForeground',
];

function hex(value: string): string | undefined {
  value = value.trim();
  // Monaco's token theme rejects CSS shorthand, even though UI color parsing accepts it.
  if (/^#[a-f\d]{3,4}$/i.test(value))
    return '#' + value.slice(1).replace(/./g, (digit) => digit + digit);
  if (/^#(?:[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) return value;
  const rgb = value.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)$/);
  if (!rgb) return undefined;
  return (
    '#' +
    rgb
      .slice(1, 4)
      .map((v) => Number(v).toString(16).padStart(2, '0'))
      .join('') +
    (rgb[4] === undefined
      ? ''
      : Math.round(Number(rgb[4]) * 255)
          .toString(16)
          .padStart(2, '0'))
  );
}

/** Webview variables supply UI colors. TextMate installs its own token color map
 * separately; Monaco's palette remains the fallback when no grammar is available.
 */
export function mergeTheme(
  style: CSSStyleDeclaration,
  className: string,
): editor.IStandaloneThemeData {
  const base = className.includes('vscode-high-contrast-light')
    ? 'hc-light'
    : className.includes('vscode-high-contrast')
      ? 'hc-black'
      : className.includes('vscode-light')
        ? 'vs'
        : 'vs-dark';
  const mapped: Record<string, string> = {};
  for (const key of colors) {
    const color = hex(style.getPropertyValue('--vscode-' + key.replaceAll('.', '-')));
    if (color) mapped[key] = color;
  }
  mapped['editorGutter.addedBackground'] ??= '#73c991';
  mapped['editorGutter.deletedBackground'] ??= '#f14c4c';
  mapped['editorGutter.modifiedBackground'] ??= '#569cd6';
  return { base, inherit: true, rules: [], colors: mapped };
}

export function mergeFont(style: CSSStyleDeclaration) {
  const size = parseFloat(style.getPropertyValue('--vscode-editor-font-size')) || 13;
  return {
    fontSize: size,
    fontFamily: style.getPropertyValue('--vscode-editor-font-family').trim() || 'monospace',
    fontWeight: style.getPropertyValue('--vscode-editor-font-weight').trim() || 'normal',
    lineHeight: Math.max(20, Math.round(size * 1.5)),
  };
}
