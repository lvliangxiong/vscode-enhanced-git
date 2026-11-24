import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

/** Unit tests mount the real component directly, without shipping a controller adapter. */
export function mountComponent<P extends object>(container: Element, Component: ComponentType<P>) {
  const root = createRoot(container);
  return {
    render(props: P) {
      flushSync(() => root.render(createElement(Component, props)));
    },
    dispose() {
      flushSync(() => root.unmount());
    },
  };
}
