/* Filter interaction model. React owns its menus, editor and dialogs in the session root. */
import { createStore } from 'zustand/vanilla';
import { flushSync } from 'react-dom';
import type { Branch } from '../shared/model';
import type { FilterHost, FilterKind, FilterPeriod } from './filter-types';
import { recentEntries, searchEntries } from '../shared/filters';
import type { FilterEntry, FilterMenuProps, FilterRow } from './react/filter-menu';
export * from '../shared/filters';
export { FilterSurface } from './react/filter-surface';
export type {
  FilterHost,
  FilterKind,
  FilterModel,
  FilterPeriod,
  FilterPath,
  FilterApplyArgs,
} from './filter-types';

export interface FilterSnapshot {
  kind?: FilterKind;
  mode: 'menu' | 'editor' | 'date' | 'paths';
  query: string;
  entries: FilterEntry[];
  favorites: ReadonlySet<string>;
  activeIndex: number;
  submenuLabel?: string;
  submenuEntries?: FilterEntry[];
}

export function create(host: FilterHost) {
  const { popup, sheet } = host;
  const document: Document = host.document || popup.ownerDocument;
  const window: Window = host.window || document.defaultView;
  const store = createStore<FilterSnapshot>(() => ({
    mode: 'menu',
    query: '',
    entries: [],
    favorites: new Set(),
    activeIndex: 0,
  }));
  const dom = {
    rows: [] as FilterRow[],
    subrows: [] as FilterRow[],
    body: undefined as HTMLElement | undefined,
    submenu: undefined as HTMLElement | undefined,
    search: undefined as HTMLInputElement | undefined,
  };
  let disposed = false;
  let stopEffects: (() => void) | undefined;
  let anchor: HTMLElement | undefined;
  let submenuTimer: number | undefined;
  let focusPlan: { target: 'main' | 'sub' | 'search'; index?: number; scroll?: number } | undefined;
  const rule = sheet.insertRule('#filter-popup {}', sheet.cssRules.length);
  const subRule = sheet.insertRule('#filter-submenu {}', sheet.cssRules.length);
  sheet.insertRule('#filter-popup > .filter-surface { display: contents; }', sheet.cssRules.length);
  const model = () => host.model();
  const update = (value: Partial<FilterSnapshot>) => {
    if (!disposed) flushSync(() => store.setState(value));
  };
  const current = () =>
    store.getState().kind === 'branch'
      ? model().refs
      : store.getState().kind === 'user'
        ? model().authors
        : store.getState().kind === 'paths'
          ? model().paths
          : [];
  function position() {
    const state = store.getState();
    if (!state.kind || state.mode === 'date' || state.mode === 'paths' || !anchor) return;
    const r = anchor.getBoundingClientRect(),
      style = (sheet.cssRules[rule] as CSSStyleRule).style;
    style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - popup.offsetWidth - 4))}px`;
    style.top = `${Math.max(4, r.bottom + popup.offsetHeight + 3 < window.innerHeight ? r.bottom + 3 : r.top - popup.offsetHeight - 3)}px`;
    const submenuAnchor = dom.rows.find((row) => row?.submenuLabel === state.submenuLabel);
    if (dom.submenu && submenuAnchor) {
      const p = popup.getBoundingClientRect(),
        a = submenuAnchor.getBoundingClientRect(),
        s = (sheet.cssRules[subRule] as CSSStyleRule).style;
      s.left = `${Math.max(4, p.right + dom.submenu.offsetWidth < window.innerWidth ? p.right - 1 : p.left - dom.submenu.offsetWidth + 1)}px`;
      s.top = `${Math.max(4, Math.min(a.top, window.innerHeight - dom.submenu.offsetHeight - 4))}px`;
    }
  }
  function closeSub(restore = false) {
    window.clearTimeout(submenuTimer);
    const state = store.getState();
    if (!state.submenuLabel) return;
    const index = dom.rows.findIndex((row) => row?.submenuLabel === state.submenuLabel);
    if (restore) focusPlan = { target: 'main', index };
    update({ submenuLabel: undefined, submenuEntries: undefined });
  }
  function close(restore = false) {
    window.clearTimeout(submenuTimer);
    focusPlan = undefined;
    update({ kind: undefined, submenuLabel: undefined, submenuEntries: undefined, query: '' });
    popup.style.removeProperty('width');
    popup.style.removeProperty('height');
    if (anchor) {
      anchor.setAttribute('aria-expanded', 'false');
      if (restore) anchor.focus();
    }
  }
  function apply(values: string[] | FilterPeriod, addRecent = true) {
    const kind = store.getState().kind;
    if (!kind || disposed) return;
    if (kind === 'date') {
      if (Array.isArray(values)) return;
      host.apply(kind, values, addRecent);
    } else {
      if (!Array.isArray(values)) return;
      host.apply(kind, values, addRecent);
    }
    close(true);
  }
  // Removed menu rows can still deliver pointer leave / delayed hover callbacks.
  // A Select editor owns its focus and must not be changed by the previous menu.
  const selectMode = (mode: 'editor' | 'date' | 'paths') => {
    window.clearTimeout(submenuTimer);
    focusPlan = undefined;
    popup.style.removeProperty('width');
    update({ mode, query: '', submenuLabel: undefined, submenuEntries: undefined });
  };
  const editor = () => selectMode('editor');
  const dateDialog = () => selectMode('date');
  const treeDialog = () => selectMode('paths');
  function branchItems(): (Pick<Branch, 'name' | 'ref'> & Partial<Branch>)[] {
    return [
      { name: 'HEAD', ref: 'HEAD' },
      ...model()
        .branches.filter((b) => b.group !== 'Tags')
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    ];
  }
  const isFavorite = (branch: Pick<Branch, 'ref'>) => model().favorites.has(branch.ref);
  function branchEntry(b: Pick<Branch, 'name' | 'ref'>): FilterEntry {
    return { label: b.name, value: [b.name], branch: b };
  }
  function entries(next = store.getState()): FilterEntry[] {
    const { kind, query } = next;
    const m = model(),
      recent = kind && kind !== 'date' ? recentEntries(kind, m) : [],
      select = { label: 'Select…', action: () => (kind === 'date' ? dateDialog() : editor()) };
    if (kind === 'date')
      return [
        select,
        ...(
          [
            ['Last 24 hours', 1],
            ['Last 7 days', 7],
          ] as [string, number][]
        ).map(([label, days]) => ({
          label,
          action: () => {
            const since = new Date();
            since.setDate(since.getDate() - days);
            apply({ since: since.toISOString(), until: '', sinceHours: 0 }, false);
          },
        })),
      ];
    if (kind === 'paths')
      return [
        select,
        { label: 'Select in Tree…', action: treeDialog },
        ...(recent.length ? [{ heading: 'Recent', clearRecent: true }, ...recent] : []),
      ];
    if (kind === 'user') {
      const users = [
        ...new Set<string>(m.authorOptions.map((a) => a.name || a.email.split('@')[0])),
      ].sort((a, b) => a.localeCompare(b));
      if (query)
        return searchEntries(
          [
            select,
            ...(m.user ? [{ label: 'me', value: ['me'] }] : []),
            ...(recent.length
              ? [{ heading: 'Recent', clearRecent: true }, ...recent, { separator: true }]
              : []),
            ...users.map((label) => ({ label, value: [label] })),
          ],
          query,
        );
      return [
        select,
        ...(m.user ? [{ label: 'me', value: ['me'] }] : []),
        ...(recent.length ? [{ heading: 'Recent', clearRecent: true }, ...recent] : []),
      ];
    }
    const all = branchItems(),
      favorites = all.filter(isFavorite).sort((a, b) => a.name.localeCompare(b.name));
    const result: FilterEntry[] = [select];
    if (recent.length) result.push({ label: 'Recent', children: recent, clearRecent: true });
    if (favorites.length > 1)
      result.push({
        label: 'Favorites',
        action: () =>
          apply(
            favorites.map((b) => b.name),
            false,
          ),
      });
    // HEAD remains available even when it is not marked as a favorite.
    result.push(
      branchEntry(all[0]),
      ...favorites.filter((b) => b.ref !== 'HEAD').map(branchEntry),
      { separator: true },
    );
    const locals = all.filter((b) => b.group === 'Local');
    if (locals.length) result.push({ label: 'Local', children: locals.map(branchEntry) });
    for (const remote of [
      ...new Set(
        all.filter((b) => b.group === 'Remote').map((b) => b.remote || b.name.split('/')[0]),
      ),
    ].sort())
      result.push({
        label: remote + '/…',
        children: all
          .filter((b) => b.group === 'Remote' && (b.remote || b.name.split('/')[0]) === remote)
          .map(branchEntry),
      });
    return query ? searchEntries(result, query) : result;
  }
  function menuEntries(state = store.getState()) {
    const result = entries(state);
    return state.query && (state.kind === 'date' || state.kind === 'paths')
      ? searchEntries(result, state.query)
      : result;
  }
  function refresh() {
    const state = store.getState();
    if (!state.kind || state.mode !== 'menu') return;
    const submenu = state.submenuLabel;
    const container = submenu ? dom.submenu : dom.body;
    const rows = submenu ? dom.subrows : dom.rows;
    const focused = rows.findIndex(
      (row) => row === document.activeElement || row?.contains(document.activeElement),
    );
    if (document.activeElement === dom.search) focusPlan = { target: 'search' };
    else if (focused >= 0)
      focusPlan = {
        target: submenu ? 'sub' : 'main',
        index: focused,
        scroll: container?.scrollTop,
      };
    const items = menuEntries();
    const subEntry = items.find((entry) => entry.label === submenu && entry.children);
    update({
      entries: items,
      favorites: new Set(model().favorites),
      submenuLabel: subEntry?.label,
      submenuEntries: subEntry?.children,
    });
  }
  function openSub(row: FilterRow, children: FilterEntry[], focus = false) {
    window.clearTimeout(submenuTimer);
    if (!store.getState().kind || store.getState().mode !== 'menu' || !row?.isConnected) return;
    if (focus) focusPlan = { target: 'sub', index: 0 };
    if (store.getState().submenuLabel === row.submenuLabel) {
      if (focus) dom.subrows[0]?.focus();
      return;
    }
    update({ submenuLabel: row.submenuLabel, submenuEntries: children });
  }
  function query(value: string, focusSearch = true) {
    const old = store.getState();
    if (!old.query && value) popup.style.width = popup.offsetWidth + 'px';
    // Compute the menu from the next query in one notification/React commit.
    const items = menuEntries({ ...old, query: value });
    const best = items
      .filter((entry) => !entry.heading && !entry.separator)
      .findIndex((entry) => entry.label!.toLowerCase().startsWith(value.toLowerCase()));
    focusPlan = { target: value && focusSearch ? 'search' : 'main', index: 0 };
    update({
      query: value,
      entries: items,
      activeIndex: Math.max(0, best),
      submenuLabel: undefined,
      submenuEntries: undefined,
    });
  }
  function focusRow(rows: FilterRow[], index: number) {
    if (!rows.length) return;
    const row = rows[(index + rows.length) % rows.length];
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  }
  function menuKey(
    event: { key: string; preventDefault(): void; stopPropagation(): void },
    sub = false,
  ) {
    const rows = sub ? dom.subrows : dom.rows;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      focusRow(
        rows,
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? rows.length - 1
            : rows.indexOf(document.activeElement as FilterRow) +
              (event.key === 'ArrowDown' ? 1 : -1),
      );
    }
    if (sub && ['ArrowLeft', 'Escape'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      closeSub(true);
    }
  }
  function keyDown(event: KeyboardEvent) {
    const state = store.getState();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (state.query && state.mode === 'menu') query('');
      else close(true);
      return;
    }
    if (
      state.mode === 'menu' &&
      (event.target as HTMLElement).classList.contains('filter-speed-search')
    ) {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        update({
          activeIndex: dom.rows.length
            ? (state.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + dom.rows.length) %
              dom.rows.length
            : 0,
        });
      }
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        dom.rows[state.activeIndex]?.click();
      }
      return;
    }
    if (
      state.mode === 'menu' &&
      !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      ((event.key.length === 1 && event.key !== ' ') || event.key === 'Backspace')
    ) {
      event.preventDefault();
      query(event.key === 'Backspace' ? state.query.slice(0, -1) : state.query + event.key);
    }
  }
  const menuProps = (sub = false): FilterMenuProps => ({
    kind: store.getState().kind!,
    entries: sub ? store.getState().submenuEntries || [] : store.getState().entries,
    favorites: store.getState().favorites,
    register: (index, row) => {
      (sub ? dom.subrows : dom.rows)[index] = row;
    },
    favorite: (ref) => host.favorite(ref),
    clearRecent() {
      const kind = store.getState().kind;
      if (!kind || kind === 'date') return;
      host.clearRecent(kind);
      refresh();
    },
    removeRecent(entry) {
      const kind = store.getState().kind;
      if (!kind || kind === 'date' || !entry.value) return;
      host.removeRecent(kind, entry.value);
      refresh();
    },
    run(row, entry) {
      window.clearTimeout(submenuTimer);
      if (entry.children) openSub(row, entry.children, true);
      else if (entry.action) entry.action();
      else if (entry.value) apply(entry.value, entry.addRecent !== false);
    },
    enter(row, entry, index) {
      if (store.getState().mode !== 'menu' || !row?.isConnected) return;
      window.clearTimeout(submenuTimer);
      if (store.getState().query && !sub) update({ activeIndex: index });
      else row.focus({ preventScroll: true });
      if (!sub) {
        if (row.recentMenu) {
          if (store.getState().submenuLabel !== row.submenuLabel) closeSub();
        } else
          submenuTimer = window.setTimeout(() => {
            if (entry.children) openSub(row, entry.children);
            else closeSub();
          }, 200);
      }
    },
    leave(row, relatedTarget) {
      if (store.getState().mode !== 'menu' || !row?.isConnected) return;
      window.clearTimeout(submenuTimer);
      if (
        dom.submenu &&
        store.getState().submenuLabel === row.submenuLabel &&
        !(
          relatedTarget instanceof (window as Window & typeof globalThis).Node &&
          dom.submenu.contains(relatedTarget)
        )
      )
        submenuTimer = window.setTimeout(() => closeSub(), 350);
    },
    arrowEnter(row, entry) {
      if (store.getState().mode !== 'menu' || !row?.isConnected) return;
      window.clearTimeout(submenuTimer);
      submenuTimer = window.setTimeout(() => openSub(row, entry.children!), 200);
    },
    arrowLeave: () => window.clearTimeout(submenuTimer),
    clearEnter: () => closeSub(),
    openSub: (row, entry) => openSub(row, entry.children!, true),
  });
  function didCommit() {
    const state = store.getState();
    dom.rows.length = state.entries.filter((entry) => !entry.heading && !entry.separator).length;
    dom.subrows.length =
      state.submenuEntries?.filter((entry) => !entry.heading && !entry.separator).length || 0;
    position();
    if (focusPlan) {
      const plan = focusPlan;
      focusPlan = undefined;
      if (plan.target === 'search') dom.search?.focus();
      else {
        const rows = plan.target === 'sub' ? dom.subrows : dom.rows;
        rows[Math.min(plan.index || 0, rows.length - 1)]?.focus({ preventScroll: true });
        const container = plan.target === 'sub' ? dom.submenu : dom.body;
        if (container && plan.scroll !== undefined) container.scrollTop = plan.scroll;
      }
    }
    if (state.query) dom.rows[state.activeIndex]?.scrollIntoView({ block: 'nearest' });
  }
  return {
    store,
    dom,
    host,
    document,
    window,
    popup,
    current,
    branchItems,
    model,
    menuProps,
    menuKey,
    keyDown,
    didCommit,
    apply,
    query,
    open(nextKind: FilterKind, nextAnchor: HTMLElement) {
      if (disposed) return;
      if (store.getState().kind === nextKind) {
        close(true);
        return;
      }
      close();
      host.beforeOpen();
      anchor = nextAnchor;
      anchor.setAttribute('aria-expanded', 'true');
      const next: FilterSnapshot = { ...store.getState(), kind: nextKind, mode: 'menu', query: '' };
      focusPlan = { target: 'main', index: 0 };
      update({
        ...next,
        entries: menuEntries(next),
        favorites: new Set(model().favorites),
        activeIndex: 0,
      });
    },
    close,
    position,
    refresh,
    contains: (target: Node) => popup.contains(target),
    enterSub: () => window.clearTimeout(submenuTimer),
    leaveSub(relatedTarget: EventTarget | null) {
      const row = dom.rows.find((row) => row?.submenuLabel === store.getState().submenuLabel);
      if (row?.recentMenu) {
        window.clearTimeout(submenuTimer);
        if (!(
          relatedTarget instanceof (window as Window & typeof globalThis).Node &&
          row.contains(relatedTarget)
        ))
          submenuTimer = window.setTimeout(() => closeSub(), 350);
      }
    },
    start() {
      if (stopEffects) return stopEffects;
      const outside = (event: PointerEvent) => {
        const state = store.getState();
        if (
          state.kind &&
          !['date', 'paths'].includes(state.mode) &&
          !popup.contains(event.target as Node) &&
          !(event.target as HTMLElement).closest('.filter-chip')
        )
          close();
      };
      const fallbackKey = (event: KeyboardEvent) => {
        if (!event.defaultPrevented && popup.contains(event.target as Node)) keyDown(event);
      };
      document.addEventListener('keydown', fallbackKey);
      document.addEventListener('pointerdown', outside);
      const observer = new (window as Window & typeof globalThis).ResizeObserver(position);
      observer.observe(popup);
      const unsubscribe = host.subscribe?.(refresh);
      stopEffects = () => {
        window.clearTimeout(submenuTimer);
        observer.disconnect();
        unsubscribe?.();
        document.removeEventListener('keydown', fallbackKey);
        document.removeEventListener('pointerdown', outside);
        stopEffects = undefined;
      };
      return stopEffects;
    },
    dispose() {
      close();
      disposed = true;
      stopEffects?.();
    },
  };
}
export type FilterController = ReturnType<typeof create>;
