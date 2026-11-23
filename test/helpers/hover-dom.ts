import { createReactDom } from './react-dom';
import { mountSessionUi } from '../../src/webview/react/session-ui';
import { Lifetime } from '../../src/webview/log/lifetime';
import type { LogContext } from '../../src/webview/log/context';

export async function createHoverDom() {
  const dom = createReactDom('<style id="layout-style"></style><div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    scrollWidth: {
      configurable: true,
      get() {
        return Number(this.dataset.scrollWidth || 200);
      },
    },
    clientWidth: {
      configurable: true,
      get() {
        return Number(this.dataset.clientWidth || 80);
      },
    },
    offsetWidth: {
      configurable: true,
      get() {
        return 260;
      },
    },
    offsetHeight: {
      configurable: true,
      get() {
        return 26;
      },
    },
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      left: Number(this.dataset.left || 110),
      right: Number(this.dataset.right || 190),
      top: 60,
      bottom: 78,
      x: 110,
      y: 60,
      width: 80,
      height: 18,
      toJSON() {},
    };
  };
  Object.defineProperties(dom.window, { innerWidth: { value: 800 }, innerHeight: { value: 600 } });
  const sheet = (dom.document.getElementById('layout-style') as HTMLStyleElement).sheet;
  const ui = mountSessionUi({
    container: dom.document.getElementById('root'),
    document: dom.document,
    window: dom.window as unknown as Window,
    sheet,
  });
  const messages: any[] = [],
    lifetime = new Lifetime();
  const ctx = {
    env: {
      $: (id) => dom.document.getElementById(id),
      document: dom.document,
      window: dom.window,
      layoutSheet: sheet,
      send: (type, payload) => messages.push({ type, ...payload }),
    },
    ui,
    lifetime,
  } as unknown as LogContext;
  const tick = (ms = 10) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return {
    ...dom,
    ctx,
    ui,
    sheet,
    messages,
    tick,
    event(target: Element | Document | Window, type: string, fields: Record<string, unknown> = {}) {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, ...fields });
      target.dispatchEvent(event);
      return event;
    },
    style(id: string) {
      return [...sheet.cssRules].find(
        (rule) => (rule as CSSStyleRule).selectorText === `#${id}`,
      ) as CSSStyleRule;
    },
    async dispose() {
      lifetime.dispose();
      ui.dispose();
      await dom.dispose();
      for (const [name, descriptor] of saved)
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
    },
  };
}
