import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { LogState } from '../state/log';
import type { UiSnapshot, SessionUi, SessionUiEnvironment } from './session-types';
export const UiContext = createContext<{
  store: StoreApi<UiSnapshot>;
  env: SessionUiEnvironment;
  ui: SessionUi;
} | null>(null);
export function useUiContext() {
  const context = useContext(UiContext);
  if (!context) throw Error('Missing Git Log UI context');
  return context;
}
export function useUi<T>(select: (state: UiSnapshot) => T): T {
  const { store } = useUiContext();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}
export const noSubscription = () => () => {};
export function useSession() {
  return useUi((state) => state.session);
}
/** Subscribe only to the domain fields a control actually renders. */
export function useSessionState(fields?: readonly (keyof LogState)[]): LogState | undefined {
  const session = useSession();
  const previous = useRef<LogState | undefined>(undefined);
  const snapshot = () => {
    const next = session?.store.getState();
    const last = previous.current;
    if (fields && next && last && fields.every((key) => Object.is(next[key], last[key])))
      return previous.current;
    previous.current = next;
    return next;
  };
  return useSyncExternalStore(session?.store.subscribe ?? noSubscription, snapshot, snapshot);
}
const cssRules = new WeakMap<CSSStyleSheet, Map<string, CSSStyleDeclaration>>();
/** Reuse a nonce-authorized rule across repeated popup mounts. */
export function useRule(selector: string) {
  const { env } = useUiContext();
  let sheetRules = cssRules.get(env.sheet);
  if (!sheetRules) cssRules.set(env.sheet, (sheetRules = new Map()));
  if (!sheetRules.has(selector)) {
    const index = env.sheet.insertRule(`${selector} {}`, env.sheet.cssRules.length);
    sheetRules.set(selector, (env.sheet.cssRules[index] as CSSStyleRule).style);
  }
  return sheetRules.get(selector)!;
}
