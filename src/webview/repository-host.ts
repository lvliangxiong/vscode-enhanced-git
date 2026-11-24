import type { WebviewApi } from './api';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createStore } from 'zustand/vanilla';
import { createPane, type LogPane, type PaneFactory, type PaneMessage } from './log-pane';
import { RepositoryHost, type RepositoryHostState } from './react/repository-host';

export interface RepositoryHostOptions {
  document: Document;
  window: Window;
  api: WebviewApi;
  paneFactory?: PaneFactory;
}

export function mountRepositoryHost({
  document,
  window,
  api,
  paneFactory = createPane,
}: RepositoryHostOptions) {
  let states = api.getState()?.repositories || {};
  const frames = new Map<string, LogPane>();
  const requested = new Set<string>();
  const loaded = new Set<string>();
  let pendingLocate: { root: string; target: string } | undefined;
  function revealPending() {
    if (!pendingLocate || !loaded.has(pendingLocate.root)) return;
    const target = pendingLocate;
    pendingLocate = undefined;
    frames.get(target.root)?.receive({ type: 'historyReveal', ...target });
  }
  const store = createStore<RepositoryHostState>(() => ({
    repositories: [],
    documents: new Map(),
    statuses: new Map(),
    closeVersion: 0,
    emptyMessage: 'Loading repositories…',
  }));
  const root = createRoot(document.getElementById('host-app'));
  const sheet = (document.getElementById('layout-style') as HTMLStyleElement).sheet;
  let hostVisible = true,
    disposed = false;
  const set = (patch: Partial<RepositoryHostState>) => flushSync(() => store.setState(patch));
  const dismiss = () => set({ closeVersion: store.getState().closeVersion + 1 });
  function syncVisibility() {
    if (!hostVisible || document.hidden) dismiss();
    for (const [key, frame] of frames)
      frame.receive({
        type: 'vsCodeEnhancedGitVisibility',
        visible: key === store.getState().active && hostVisible && !document.hidden,
      });
  }
  function select(key: string) {
    const state = store.getState();
    if (!state.repositories.some((repo) => repo.root === key)) return;
    set({ active: key, closeVersion: state.closeVersion + 1 });
    syncVisibility();
    if (!frames.has(key) && !requested.has(key)) {
      requested.add(key);
      api.postMessage({ type: 'openRepository', root: key });
    }
  }
  function fromPane(key: string, message: PaneMessage) {
    if (disposed || !store.getState().repositories.some((repo) => repo.root === key)) return;
    if (message.type === 'frameState') {
      states = { ...states, [key]: message.state };
      api.setState({ repositories: states });
    } else if (message.type === 'frameStatus')
      set({
        statuses: new Map(store.getState().statuses).set(key, {
          status: message.status,
          branchNames: message.branchNames,
          count: message.count,
          updates: message.updates,
        }),
      });
    else if (message.type === 'dismissBranchSummary') {
      if (store.getState().active === key) dismiss();
    } else api.postMessage({ ...message, pane: key });
  }
  function receive(data: PaneMessage) {
    if (disposed) return;
    const state = store.getState();
    if (data?.type === 'hostVisibility') {
      hostVisible = data.visible;
      syncVisibility();
    } else if (data?.type === 'locateCommit') {
      pendingLocate = { root: data.root, target: data.target };
      select(data.root);
      revealPending();
    } else if (data?.type === 'repositories') {
      const repositories = data.repositories as RepositoryHostState['repositories'];
      const keep = new Set(repositories.map((repo) => repo.root));
      for (const key of requested) if (!keep.has(key)) requested.delete(key);
      for (const [key, frame] of frames)
        if (!keep.has(key)) {
          frame.dispose();
          frames.delete(key);
          loaded.delete(key);
          requested.delete(key);
        }
      const active = keep.has(state.active) ? state.active : repositories[0]?.root;
      set({
        repositories,
        active,
        documents: new Map([...state.documents].filter(([key]) => keep.has(key))),
        statuses: new Map([...state.statuses].filter(([key]) => keep.has(key))),
        emptyMessage: 'Open a folder containing a Git repository first.',
      });
      if (pendingLocate && keep.has(pendingLocate.root)) select(pendingLocate.root);
      else if (active) select(active);
      else dismiss();
    } else if (data?.type === 'repositoryDocument') {
      requested.delete(data.root);
      if (frames.has(data.root) || !state.repositories.some((repo) => repo.root === data.root))
        return;
      set({
        documents: new Map(state.documents).set(data.root, { html: data.html, name: data.name }),
      });
      const element = [...document.querySelectorAll<HTMLElement>('.log-pane')].find(
        (node) => node.dataset.root === data.root,
      );
      const frame = paneFactory(element, data.html, {
        pane: data.root,
        state: states[data.root],
        send: (message) => fromPane(data.root, message),
      });
      frames.set(data.root, frame);
      syncVisibility();
    } else if (typeof data?.pane === 'string') {
      frames.get(data.pane)?.receive(data);
      if (data.type === 'data') {
        loaded.add(data.pane);
        revealPending();
      }
    } else if (data?.type === 'repositoryHostError') {
      requested.delete(data.root);
      if (data.root)
        set({ statuses: new Map(state.statuses).set(data.root, { status: data.message }) });
      else if (state.active)
        set({ statuses: new Map(state.statuses).set(state.active, { status: data.message }) });
      else set({ emptyMessage: data.message });
    }
  }
  const message = (event: MessageEvent) => receive(event.data);
  const theme = new MutationObserver(() =>
    frames.forEach((frame) => frame.receive({ type: 'vsCodeEnhancedGitTheme' })),
  );
  const refresh = () => frames.get(store.getState().active)?.receive({ type: 'vsCodeEnhancedGitRefresh' });
  flushSync(() =>
    root.render(createElement(RepositoryHost, { store, document, window, sheet, select, refresh })),
  );
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('message', message);
  theme.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  api.postMessage({ type: 'repositoryHostReady' });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('visibilitychange', syncVisibility);
    window.removeEventListener('message', message);
    window.removeEventListener('pagehide', dispose);
    theme.disconnect();
    frames.forEach((frame) => frame.dispose());
    frames.clear();
    flushSync(() => root.unmount());
  };
  window.addEventListener('pagehide', dispose);
  return { store, select, receive, dispose };
}

if (typeof acquireVsCodeApi === 'function')
  mountRepositoryHost({ document, window, api: acquireVsCodeApi() });
