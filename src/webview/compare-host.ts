import type { WebviewApi } from './api';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createStore } from 'zustand/vanilla';
import { createPane, type LogPane, type PaneFactory, type PaneMessage } from './log-pane';
import { CompareHost, type ComparisonHostState } from './react/compare-host';

export interface ComparisonHostOptions {
  document: Document;
  window: Window;
  api: WebviewApi;
  documents: string[];
  paneFactory?: PaneFactory;
}
export function mountComparisonHost({
  document,
  window,
  api,
  documents,
  paneFactory = createPane,
}: ComparisonHostOptions) {
  let saved = api.getState() || {};
  let disposed = false,
    hostVisible = true;
  const frames: LogPane[] = [];
  const store = createStore<ComparisonHostState>(() => ({
    split: Math.max(0.15, Math.min(0.85, saved.split ?? 0.5)),
    dragging: false,
  }));
  const root = createRoot(document.getElementById('host-app'));
  const sheet = (document.getElementById('host-style') as HTMLStyleElement).sheet;
  const resize = (value: number) =>
    flushSync(() => store.setState({ split: Math.max(0.15, Math.min(0.85, value)) }));
  const save = (force = false) => {
    if (!force && !store.getState().dragging) return;
    store.setState({ dragging: false });
    saved = { ...saved, split: store.getState().split };
    api.setState(saved);
  };
  const stop = store.subscribe((state, previous) => {
    if (state.dragging !== previous.dragging)
      document.body.classList.toggle('dragging', state.dragging);
  });
  const syncVisibility = () =>
    frames.forEach((frame) =>
      frame.receive({ type: 'vsgitVisibility', visible: hostVisible && !document.hidden }),
    );
  const receive = (data: PaneMessage) => {
    if (disposed) return;
    if (data?.type === 'hostVisibility') {
      hostVisible = data.visible;
      syncVisibility();
    } else if (Number.isInteger(data?.pane)) frames[data.pane]?.receive(data);
  };
  flushSync(() => root.render(createElement(CompareHost, { store, sheet, window, resize, save })));
  for (const [pane, element] of [...document.querySelectorAll<HTMLElement>('.log-pane')].entries())
    frames.push(
      paneFactory(element, documents[pane], {
        pane,
        state: saved[pane],
        send(message) {
          if (disposed) return;
          if (message.type === 'frameState') {
            saved = { ...saved, [pane]: message.state };
            api.setState(saved);
          } else api.postMessage({ ...message, pane });
        },
      }),
    );
  const message = (event: MessageEvent) => receive(event.data);
  const theme = new MutationObserver(() =>
    frames.forEach((frame) => frame.receive({ type: 'vsgitTheme' })),
  );
  window.addEventListener('message', message);
  document.addEventListener('visibilitychange', syncVisibility);
  theme.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  syncVisibility();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    theme.disconnect();
    frames.forEach((frame) => frame.dispose());
    window.removeEventListener('message', message);
    window.removeEventListener('pagehide', dispose);
    document.removeEventListener('visibilitychange', syncVisibility);
    flushSync(() => root.unmount());
  };
  window.addEventListener('pagehide', dispose);
  return { store, receive, resize, save, dispose };
}

if (typeof acquireVsCodeApi === 'function')
  mountComparisonHost({
    document,
    window,
    api: acquireVsCodeApi(),
    documents: JSON.parse(document.getElementById('compare-documents').textContent),
  });
