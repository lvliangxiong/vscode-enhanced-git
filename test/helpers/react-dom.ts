import { JSDOM } from 'jsdom';

/** Real DOM/event support for React view tests; dispose views before restoring globals. */
export function createReactDom(html = '<div id="root"></div>') {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const globals = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Node',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'MutationObserver',
  ] as const;
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const name of globals) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  return {
    window: dom.window,
    document: dom.window.document,
    async dispose() {
      dom.window.close();
      // React schedules a final task after synchronous commits/unmounts. Let it
      // finish against this document before another test replaces the globals.
      await new Promise<void>((resolve) => setImmediate(resolve));
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
