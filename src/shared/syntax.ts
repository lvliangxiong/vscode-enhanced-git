import type { IRawGrammar, IRawTheme } from 'vscode-textmate';

export interface GrammarInfo {
  scopeName: string;
  language?: string;
  injectTo?: string[];
  embeddedLanguages?: Record<string, string>;
  tokenTypes?: Record<string, 'string' | 'comment' | 'other'>;
}
export interface SyntaxSnapshot {
  name: string;
  available?: boolean;
  settings: IRawTheme['settings'];
  grammars: GrammarInfo[];
  language?: string;
}
export type RawGrammar = IRawGrammar;

export interface SyntaxRequest {
  path: string;
  /** Webview's actual settings ID, including themes selected by automatic switching. */
  theme?: string;
  customizations?: Record<string, any>;
  associations?: Record<string, string>;
}
