import type { WebviewApi } from '../api';
import { flushSync } from 'react-dom';
import { createLogStore } from '../state/log';
import { createBranchState } from '../state/branches';
import { mountSessionUi } from '../react/session-ui';
import { BranchesContent } from '../react/branches-panel';
import { FilesContent, MessageContent, PreviewContent } from '../react/details-panel';
import { FilterSurface } from '../react/filter-surface';
import { LogBranchSummary } from '../react/branch-summary';
import { VsGitFileIcons } from '../theme-file-icons';
import { Lifetime } from './lifetime';
import { createBranchesController } from './branches';
import { createBranchToolsController } from './branch-tools';
import { createGraphController } from './graph-render';
import { createColumnsController } from './columns';
import { createCommitsController } from './commits';
import { createHistoryController } from './history';
import { createFiltersController } from './filters';
import { createFilesController } from './files';
import { createDetailsController } from './details';
import { createLayoutController } from './layout';
import { createToolbarController } from './toolbar';
import { createHoverController } from './hover';
import { installGraphTheme } from './theme';
import { receiveLogMessage, type LogMessage } from './messages';
import type { BrowserScope, LogActions, LogContext, LogEnvironment } from './context';

export interface MountLogOptions {
  document: Document;
  window: Window;
  scope?: BrowserScope;
  api: WebviewApi;
}
/** Composition root shared by standalone editor logs and isolated repository panes. */
export function mountLog(options: MountLogOptions) {
  const { document, window, api } = options;
  const scope = options.scope || {};
  const lifetime = new Lifetime();
  const $: LogEnvironment['$'] = (id) => document.getElementById(id) as any;
  const layoutSheet = $<HTMLStyleElement>('layout-style').sheet!;
  const savedLayout = JSON.parse($('saved-layout')?.textContent || '{}');
  const frameConfig = JSON.parse($('frame-config')?.textContent || '{}');
  const comparison = scope.vsgitComparison || (frameConfig.start ? frameConfig : undefined);
  const store = createLogStore(
    api.getState(),
    api.getState()?.layout ?? savedLayout,
    Boolean(comparison),
  );
  const send: LogEnvironment['send'] = (type, payload = {}) => {
    if (!lifetime.disposed) api.postMessage({ type, ...payload });
  };
  const ui = mountSessionUi({
    container: $('app'),
    document,
    window,
    sheet: layoutSheet,
    comparison,
  });
  if (comparison) document.body.classList.add('compare-log');
  const themedFileIcons = VsGitFileIcons.create({
    send,
    sheet: layoutSheet,
    document,
    window,
    scope,
  });
  const env: LogEnvironment = {
    window,
    document,
    scope,
    api,
    $,
    send,
    comparison,
    scriptStarted: performance.now(),
    layoutSheet,
    themedFileIcons,
    setStatus: (status) => store.setState({ status }),
    el(tag, text, cls) {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = String(text);
      if (cls) node.className = cls;
      return node;
    },
  };
  const actions = {} as LogActions;
  const ctx: LogContext = {
    env,
    store,
    actions,
    branchState: createBranchState(store),
    lifetime,
    ui,
  };
  // Constructors declare dependencies; they never wait for another module's source order.
  actions.branches = createBranchesController(ctx);
  actions.branchTools = createBranchToolsController(ctx);
  actions.graph = createGraphController(ctx);
  actions.columns = createColumnsController(ctx);
  actions.commits = createCommitsController(ctx);
  actions.history = createHistoryController(ctx);
  actions.files = createFilesController(ctx);
  actions.details = createDetailsController(ctx);
  actions.filters = createFiltersController(ctx);
  actions.layout = createLayoutController(ctx);
  actions.toolbar = createToolbarController(ctx);
  actions.hover = createHoverController(ctx);
  ui.bindSession(ctx);
  flushSync(() => {
    ui.setSlots({
      branches: <BranchesContent ctx={ctx} />,
      files: <FilesContent ctx={ctx} />,
      message: <MessageContent ctx={ctx} />,
      preview: <PreviewContent ctx={ctx} />,
      status: <LogBranchSummary ctx={ctx} />,
      filter: <FilterSurface controller={actions.filters.surface} />,
    });
  });
  for (const controller of Object.values(actions)) {
    lifetime.add(() => controller.dispose());
    controller.start();
  }
  installGraphTheme(ctx);
  lifetime.add(() => themedFileIcons.dispose());
  // Prune a tree selection only when its repository snapshot actually changes.
  lifetime.add(
    store.subscribe((next, previous) => {
      if (next.branches !== previous.branches) {
        const valid = new Set(['HEAD', ...next.branches.map((b) => b.ref)]);
        const selectedBranchRefs = new Set(
          [...next.selectedBranchRefs].filter((ref) => valid.has(ref)),
        );
        if (selectedBranchRefs.size !== next.selectedBranchRefs.size)
          store.setState({ selectedBranchRefs });
      }
    }),
  );
  const receive = (message: LogMessage) => {
    if (!lifetime.disposed) receiveLogMessage(ctx, message);
  };
  lifetime.listen(window, 'message', ((event: MessageEvent) => {
    if (event.data && typeof event.data.type === 'string') receive(event.data);
  }) as EventListener);
  const dispose = () => {
    if (lifetime.disposed) return;
    lifetime.dispose();
    ui.dispose();
  };
  lifetime.listen(window, 'vsgitDispose', dispose);
  lifetime.listen(window, 'pagehide', dispose);
  actions.history.requestHistory('init', {});
  return { store, actions, receive, dispose, context: ctx };
}
