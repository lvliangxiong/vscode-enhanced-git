import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createLogStore, type LogState } from '../../src/webview/state/log';
import { createCommitsController } from '../../src/webview/log/commits';
import { createHistoryController } from '../../src/webview/log/history';
import type { LogContext } from '../../src/webview/log/context';
import { Lifetime } from '../../src/webview/log/lifetime';
import { createReactDom } from './react-dom';

/** Real controllers + React rendering, with only geometry/host services replaced. */
export function createLogControllerHarness() {
  const dom = createReactDom(
    '<style id="layout-style"></style><div id="commits"></div><input id="search">',
  );
  const { document, window } = dom;
  const list = document.getElementById('commits');
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 48 });
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  });
  const store = createLogStore();
  let graphWidth = 20;
  const messages: any[] = [];
  const detailRequests: string[] = [];
  const root = createRoot(list);
  const ctx = {
    store,
    lifetime: new Lifetime(),
    env: {
      document,
      window,
      scope: {},
      $: (id: string) => document.getElementById(id),
      layoutSheet: (document.getElementById('layout-style') as HTMLStyleElement).sheet,
      api: { getState: () => ({}), setState() {} },
      setStatus() {},
      send: (type: string, payload) => messages.push({ type, ...payload }),
    },
    ui: { setSlots: ({ commits }) => flushSync(() => root.render(commits)) },
    branchState: { reset() {} },
    actions: {
      columns: {
        applyColumns() {},
        installColumnDrag(node, key) {
          node.dataset.column = key;
        },
        installColumnResize() {},
        cancelDrag() {},
        saveView() {},
      },
      graph: {
        setWidth(value: number) {
          graphWidth = value;
        },
        getWidth: () => graphWidth,
        repaintGraphCanvases() {},
        rowGraphWidth: (row, height) => Math.ceil(((row.width * 16 + 2) * height) / 22),
        graphCell() {
          const node = document.createElement('span');
          node.className = 'graph-cell';
          return node;
        },
      },
      branches: {
        requestDetails: () => detailRequests.push([...store.getState().selected].join(',')),
        openCommitMenu() {},
        openCommitRefDialog() {},
        navigateCommit() {},
      },
      filters: { closeFilter() {} },
    },
  } as unknown as LogContext;
  ctx.actions.history = createHistoryController(ctx);
  ctx.actions.commits = createCommitsController(ctx);
  return {
    ...dom,
    ctx,
    store,
    list,
    messages,
    detailRequests,
    start() {
      ctx.actions.commits.start();
      ctx.actions.history.start();
    },
    set(patch: Partial<LogState> | ((state: LogState) => Partial<LogState>)) {
      flushSync(() => store.setState(patch));
    },
    async dispose() {
      ctx.actions.history.dispose();
      ctx.actions.commits.dispose();
      flushSync(() => root.unmount());
      await dom.dispose();
    },
  };
}
