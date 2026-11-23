import type { WebviewApi } from './api';
import { mountLog, type MountLogOptions } from './log/session';

export interface PaneMessage {
  type: string;
  [key: string]: any;
}
export interface LogPane {
  element: HTMLElement;
  receive(message: PaneMessage): void;
  dispose(): void;
}
export interface PaneOptions {
  pane: string | number;
  state?: Record<string, any>;
  send(message: PaneMessage): void;
}
export type PaneFactory = (element: HTMLElement, html: string, options: PaneOptions) => LogPane;

/** Tokens inherit through Shadow DOM. Only theme-kind classes need propagation. */
export function syncPaneTheme(body: HTMLElement, hostBody: HTMLElement) {
  for (const name of [
    'vscode-dark',
    'vscode-light',
    'vscode-high-contrast',
    'vscode-high-contrast-light',
  ]) {
    body.classList.toggle(name, hostBody.classList.contains(name));
  }
}

/** Isolation/host adapter only: React owns the log, its state and its DOM. */
export const createPane: PaneFactory = (element, html, { state, send }) => {
  const document = element.ownerDocument;
  const window = document.defaultView as Window & typeof globalThis;
  const parsed = new window.DOMParser().parseFromString(html, 'text/html');
  const shadow = element.attachShadow({ mode: 'open' });
  const body = document.createElement('div');
  body.className = 'pane-body';
  const events = new window.EventTarget();
  const abort = new window.AbortController();
  let disposed = false;
  let visible = !element.hidden;
  const nonce = document.querySelector<HTMLElement>('script[nonce]')?.nonce || '';
  for (const source of parsed.querySelectorAll<HTMLStyleElement>('style')) {
    const style = document.createElement('style');
    style.nonce = nonce;
    style.id = source.id;
    style.textContent = source.textContent
      .replace(/:root/g, ':host')
      .replace(/(?<![\w-])body(?![\w-])/g, '.pane-body');
    shadow.append(style);
  }
  const sizing = document.createElement('style');
  sizing.nonce = nonce;
  sizing.textContent = '.pane-body {height:100%;}';
  shadow.append(sizing);
  // Embedded documents carry styles and JSON configuration, never executable programs.
  parsed
    .querySelectorAll('script:not([type="application/json"])')
    .forEach((script) => script.remove());
  body.append(...parsed.body.childNodes);
  shadow.append(body);
  const api: WebviewApi = {
    postMessage(message) {
      if (!disposed)
        queueMicrotask(() => {
          if (!disposed) send(message);
        });
    },
    getState: () => state,
    setState(value) {
      state = value as Record<string, any>;
      api.postMessage({ type: 'frameState', state });
      return value;
    },
  };
  const scopedDocument = new Proxy(document, {
    get(target, key) {
      if (key === 'body') return body;
      if (key === 'documentElement') return element;
      if (key === 'activeElement') return shadow.activeElement;
      if (key === 'hidden') return !visible || document.hidden;
      if (
        [
          'getElementById',
          'querySelector',
          'querySelectorAll',
          'addEventListener',
          'removeEventListener',
        ].includes(String(key))
      )
        return shadow[key].bind(shadow);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const scopedWindow = new Proxy(window, {
    get(target, key) {
      if (key === 'addEventListener' || key === 'removeEventListener')
        return (type, listener, options) => {
          const owner = [
            'message',
            'resize',
            'focus',
            'blur',
            'vsgitHidden',
            'vsgitTheme',
            'vsgitDispose',
          ].includes(type)
            ? events
            : shadow;
          owner[key](type, listener, options);
        };
      if (key === 'dispatchEvent') return events.dispatchEvent.bind(events);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const fontStyle = document.createElement('style');
  fontStyle.nonce = nonce;
  document.head.append(fontStyle);
  const scope: MountLogOptions['scope'] = {
    vsgitVisible: visible,
    vsgitFontSheet: fontStyle.sheet,
    vsgitFontPrefix: `pane-${window.crypto.randomUUID()}-`,
  };
  const config = shadow.getElementById('frame-config');
  const settings = config ? JSON.parse(config.textContent) : {};
  if (!settings.repositoryFrame) scope.vsgitComparison = settings;
  syncPaneTheme(body, document.body);
  for (const type of ['focus', 'blur'])
    window.addEventListener(type, () => events.dispatchEvent(new window.Event(type)), {
      signal: abort.signal,
    });
  shadow.addEventListener(
    'focusout',
    (event) => {
      if (!shadow.contains((event as FocusEvent).relatedTarget as Node))
        events.dispatchEvent(new window.Event('blur'));
    },
    { signal: abort.signal },
  );
  const resize = new window.ResizeObserver(() => events.dispatchEvent(new window.Event('resize')));
  resize.observe(element);
  const session = mountLog({ document: scopedDocument, window: scopedWindow, scope, api });
  let stopStatus: (() => void) | undefined;
  if (settings.repositoryFrame) {
    body.querySelector<HTMLElement>('footer').hidden = true;
    let previous = '';
    const report = () => {
      const state = session.store.getState();
      const value = {
        type: 'frameStatus',
        status: typeof state.status === 'string' ? state.status : '',
        branchNames: Array.isArray(state.status) ? state.status : null,
        count: `${state.commits.length} commits · ${state.selected.size} selected${state.historyLoading ? ' · Loading…' : ''}`,
        updates: state.updatesAvailable,
      };
      const key = JSON.stringify(value);
      if (previous !== key) {
        previous = key;
        api.postMessage(value);
      }
    };
    stopStatus = session.store.subscribe(report);
    shadow.addEventListener(
      'pointerdown',
      () => api.postMessage({ type: 'dismissBranchSummary' }),
      { signal: abort.signal },
    );
    report();
  }
  return {
    element,
    receive(message) {
      if (disposed) return;
      if (message.type === 'vsgitTheme') {
        syncPaneTheme(body, document.body);
        events.dispatchEvent(new window.Event('vsgitTheme'));
        return;
      }
      if (message.type === 'vsgitVisibility') visible = message.visible;
      // Deliver to every pane-scoped subscriber, including the file-icon service.
      // Calling only the log router drops icon replies and theme invalidations.
      events.dispatchEvent(new window.MessageEvent('message', { data: message }));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopStatus?.();
      session.dispose();
      abort.abort();
      resize.disconnect();
      fontStyle.remove();
      // The host React tree owns the element and removes it after disposal.
      shadow.replaceChildren();
    },
  };
};
