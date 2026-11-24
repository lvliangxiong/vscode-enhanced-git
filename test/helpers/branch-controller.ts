import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createReactDom } from './react-dom';
import { createLogStore, type LogState } from '../../src/webview/state/log';
import { createBranchState } from '../../src/webview/state/branches';
import { createBranchesController } from '../../src/webview/log/branches';
import { createBranchToolsController } from '../../src/webview/log/branch-tools';
import { createCommitsController } from '../../src/webview/log/commits';
import { createFilesController } from '../../src/webview/log/files';
import { createDetailsController } from '../../src/webview/log/details';
import { mountSessionUi, type MenuModel } from '../../src/webview/react/session-ui';
import { BranchesContent } from '../../src/webview/react/branches-panel';
import { Lifetime } from '../../src/webview/log/lifetime';
import type { LogContext } from '../../src/webview/log/context';

/** Real controllers and a single React session root; only Git/host boundaries are mocked. */
export function createBranchControllerFixture(initial: Partial<LogState> = {}) {
  const dom = createReactDom('<style id="layout-style"></style><div id="root"></div>');
  const { document, window } = dom;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.getClientRects = function () {
    if (this.hidden) return [];
    for (let parent = this.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === 'DETAILS' && !(parent as HTMLDetailsElement).open) return [];
    return [{}];
  } as unknown as typeof window.HTMLElement.prototype.getClientRects;
  const store = createLogStore();
  store.setState(initial);
  const messages: { type: string; [key: string]: any }[] = [];
  const destinations: string[] = [];
  const counters = { loads: 0, closed: 0 };
  let saved: Record<string, any> = {},
    lastMenu: MenuModel | undefined;
  const sheet = (document.getElementById('layout-style') as HTMLStyleElement).sheet!;
  const ui = mountSessionUi({
    container: document.getElementById('root')!,
    document,
    window: window as unknown as Window,
    sheet,
  });
  const openMenu = ui.openContextMenu;
  ui.openContextMenu = (menu) => {
    lastMenu = menu;
    flushSync(() => openMenu(menu));
  };
  const ctx = {
    store,
    ui,
    branchState: createBranchState(store),
    actions: {},
    lifetime: new Lifetime(),
    env: {
      document,
      window,
      scope: {},
      scriptStarted: 0,
      layoutSheet: sheet,
      $: (id: string) => document.getElementById(id),
      api: { getState: () => saved, setState: (value: Record<string, any>) => (saved = value) },
      send: (type: string, payload: object = {}) => messages.push({ type, ...payload }),
      setStatus: (status: string) => store.setState({ status }),
      el(tag: string, text?: string, cls?: string) {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (cls) node.className = cls;
        return node;
      },
      themedFileIcons: { set() {}, dispose() {} },
    },
  } as unknown as LogContext;
  ctx.actions.history = {
    refValues: () =>
      Array.isArray(store.getState().ref)
        ? store.getState().ref
        : store.getState().ref
          ? [store.getState().ref]
          : [],
    applyFilters: () => {
      counters.loads++;
    },
    cancelFilterTimer() {},
    filters: () => ({}),
    requestHistory: (type, payload) => messages.push({ type, ...payload }),
  } as unknown as LogContext['actions']['history'];
  ctx.actions.filters = {
    closeFilter: () => {
      counters.closed++;
    },
    clearFilter() {},
  } as unknown as LogContext['actions']['filters'];
  ctx.actions.toolbar = { closeViewMenu() {} } as unknown as LogContext['actions']['toolbar'];
  ctx.actions.layout = {
    toggleBranches() {},
    applyDetailLayout() {},
  } as unknown as LogContext['actions']['layout'];
  ctx.actions.files = createFilesController(ctx);
  ctx.actions.details = createDetailsController(ctx);
  ctx.actions.branches = createBranchesController(ctx);
  ctx.actions.branchTools = createBranchToolsController(ctx);
  ctx.actions.commits = createCommitsController(ctx);
  ctx.actions.commits.navigateBranchHead = (ref) => destinations.push(ref);
  flushSync(() => {
    ui.bindSession(ctx);
    ui.setSlots({ branches: createElement(BranchesContent, { ctx }) });
  });
  return {
    ctx,
    store,
    ui,
    messages,
    document,
    window,
    counters,
    destinations,
    menu: () => lastMenu?.items || [],
    set: (patch: Partial<LogState>) => flushSync(() => store.setState(patch)),
    async dispose() {
      ctx.lifetime.dispose();
      ctx.actions.commits.dispose();
      flushSync(() => ui.dispose());
      await dom.dispose();
    },
  };
}
