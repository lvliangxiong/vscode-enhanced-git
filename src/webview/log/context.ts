import type { WebviewApi } from '../api';
import type { FileIconMessage } from '../theme-file-icons';
import type { StoreApi } from 'zustand/vanilla';
import type { LogState } from '../state/log';
import type { createBranchState } from '../state/branches';
import type { Lifetime } from './lifetime';
import type { createColumnsController } from './columns';
import type { createCommitsController } from './commits';
import type { createGraphController } from './graph-render';
import type { createHistoryController } from './history';
import type { createBranchesController } from './branches';
import type { createBranchToolsController } from './branch-tools';
import type { createLayoutController } from './layout';
import type { createFiltersController } from './filters';
import type { createToolbarController } from './toolbar';
import type { createHoverController } from './hover';
import type { createFilesController } from './files';
import type { createDetailsController } from './details';
import type { SessionUi } from '../react/session-ui';

export interface BrowserScope {
  vsgitVisible?: boolean;
  vsgitComparison?: {
    ref?: string;
    start: import('../../shared/model').ComparisonEndpoint;
    end: import('../../shared/model').ComparisonEndpoint;
    [key: string]: unknown;
  };
  vsgitFontSheet?: CSSStyleSheet;
  vsgitFontPrefix?: string;
}
export interface LogEnvironment {
  window: Window;
  document: Document;
  scope: BrowserScope;
  api: WebviewApi;
  comparison?: BrowserScope['vsgitComparison'];
  scriptStarted: number;
  $<T extends HTMLElement = HTMLElement>(id: string): T;
  send(type: string, payload?: Record<string, unknown>): void;
  el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string | number,
    cls?: string,
  ): HTMLElementTagNameMap[K];
  layoutSheet: CSSStyleSheet;
  themedFileIcons: {
    set(node: HTMLElement, path: string, directory?: boolean, expanded?: boolean): HTMLElement;
    receive(data: FileIconMessage): void;
    dispose(): void;
  };
  setStatus(message: string | string[]): void;
}
/** Explicit dependency graph; factories register first, effects start after all are present. */
export interface LogActions {
  columns: ReturnType<typeof createColumnsController>;
  commits: ReturnType<typeof createCommitsController>;
  graph: ReturnType<typeof createGraphController>;
  history: ReturnType<typeof createHistoryController>;
  branches: ReturnType<typeof createBranchesController>;
  branchTools: ReturnType<typeof createBranchToolsController>;
  layout: ReturnType<typeof createLayoutController>;
  filters: ReturnType<typeof createFiltersController>;
  toolbar: ReturnType<typeof createToolbarController>;
  hover: ReturnType<typeof createHoverController>;
  files: ReturnType<typeof createFilesController>;
  details: ReturnType<typeof createDetailsController>;
}
export interface LogContext {
  env: LogEnvironment;
  store: StoreApi<LogState>;
  branchState: ReturnType<typeof createBranchState>;
  actions: LogActions;
  lifetime: Lifetime;
  ui: SessionUi;
}
