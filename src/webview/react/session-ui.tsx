import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createStore } from 'zustand/vanilla';
import { UiContext } from './session-context';
import { LogShell } from './log-shell';
import type { UiSnapshot, SessionUi, SessionUiEnvironment } from './session-types';
export type {
  SessionUi,
  SessionUiEnvironment,
  ActionMenuItem,
  MenuModel,
  HoverModel,
  ChromeState,
  SessionSlots,
} from './session-types';

/** One React root owns the complete log document, including transient surfaces. */
export function mountSessionUi(env: SessionUiEnvironment): SessionUi {
  const store = createStore<UiSnapshot>(() => ({
    slots: {},
    session: null,
    chrome: {
      buttons: {},
      overflow: { collapsed: false, expanded: false, visibleCount: Infinity, focusFirst: false },
    },
    menus: {},
    hovers: {},
    refDialog: null,
  }));
  const root = createRoot(env.container);
  let disposed = false;
  const ui: SessionUi = {
    bindSession: (session) => store.setState({ session }),
    setSlots: (slots) => store.setState((state) => ({ slots: { ...state.slots, ...slots } })),
    patchChrome: (patch) =>
      store.setState((state) => ({
        chrome: {
          ...state.chrome,
          ...patch,
          buttons: patch.buttons
            ? { ...state.chrome.buttons, ...patch.buttons }
            : state.chrome.buttons,
        },
      })),
    openContextMenu(model) {
      ui.openMenu('branch-menu', model);
    },
    closeContextMenu() {
      ui.closeMenu('branch-menu');
    },
    openMenu: (id, model) =>
      store.setState((state) => ({ menus: { ...state.menus, [id]: model } })),
    isMenuOpen(id, anchor) {
      const menu = store.getState().menus[id];
      return Boolean(menu && (!anchor || menu.anchor === anchor));
    },
    closeMenu(id, restore) {
      const model = store.getState().menus[id];
      store.setState((state) => ({ menus: { ...state.menus, [id]: null } }));
      if (restore) model?.anchor?.focus();
    },
    openRefDialog(model) {
      const id = crypto.randomUUID();
      store.setState({ refDialog: { ...model, id } });
      return id;
    },
    finishRefDialog(id, error) {
      const current = store.getState().refDialog;
      if (!current || current.id !== id) return;
      if (error) store.setState({ refDialog: { ...current, busy: false } });
      else {
        store.setState({ refDialog: null });
        current.onClose?.();
        if (!env.document.hidden)
          env.document
            .querySelector<HTMLElement>('.commit[aria-selected="true"]')
            ?.focus({ preventScroll: true });
      }
    },
    showHover: (id, model) =>
      store.setState((state) => ({ hovers: { ...state.hovers, [id]: model } })),
    hideHover: (id) => store.setState((state) => ({ hovers: { ...state.hovers, [id]: null } })),
    dispose() {
      if (disposed) return;
      disposed = true;
      root.unmount();
    },
  };
  // Startup alone is synchronous: DOM-based geometry services connect after this mount.
  // All subsequent rendering uses subscriptions and React's regular update scheduling.
  flushSync(() =>
    root.render(
      <UiContext.Provider value={{ store, env, ui }}>
        <LogShell />
      </UiContext.Provider>,
    ),
  );
  return ui;
}
