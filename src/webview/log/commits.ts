import { referenceGroups } from '../../shared/reference-labels';
import { createCommitDateFormatter } from './commit-date';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from 'zustand/vanilla';
import { createRows } from '../../shared/graph';
import { resolveUsers } from '../../shared/filters';
import type { Commit } from '../../shared/model';
import { CommitViewport } from '../react/commit-viewport';
import type { CommitListProps } from '../react/commit-list';
import { columnLabels } from './columns';
import type { LogContext } from './context';

export interface CommitsController {
  start(): void;
  dispose(): void;
  select(commit: Commit, event?: Partial<MouseEvent>): void;
  navigateBranchHead(branchRef: string): void;
  navigateToRevision(hash: string): void;
  jumpToCommit(hash: string, edge?: { source: string; parent: string }): void;
  highlightGraphJump(hash: string, edge?: { source: string; parent: string }): void;
  finishGraphJump(data: { target: string; requestId?: number; resetFilters?: boolean }): void;
  revealCommit(hash: string, alignment?: 'nearest' | 'center'): HTMLElement | undefined;
  renderCommits(): void;
  renderCommitWindow(force?: boolean): void;
  commitRowKey(commit: Commit, event: KeyboardEvent, row: HTMLElement): void;
  getCacheStats(): { rows: number; positions: number };
}

export function createCommitsController(ctx: LogContext): CommitsController {
  const { $, document, window, layoutSheet, comparison, setStatus, send } = ctx.env;
  const state = ctx.store.getState;
  const requestAnimationFrame = window.requestAnimationFrame.bind(window);
  const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const getComputedStyle = window.getComputedStyle.bind(window);
  let graphJumpAnimations: Animation[] = [];
  let spacerStyles: CSSStyleDeclaration[] = [];
  let stop: (() => void) | undefined;
  let commitViewportObserver: ResizeObserver;
  let virtualResizeFrame = 0;
  let graphJumpFrame = 0;
  const viewport = createStore<CommitListProps>(() => ({
    rows: [],
    select,
    context: (commit, event) =>
      ctx.actions.branches.openCommitMenu(commit, event.clientX, event.clientY),
    onKeyDown: commitRowKey,
    drag: (node, key) => ctx.actions.columns.installColumnDrag(node, key),
    resize: (node, key) => ctx.actions.columns.installColumnResize(node, key),
  }));
  function select(c, event: Partial<MouseEvent> = {}) {
    const previous = [...state().selected].join(',');
    let selected = new Set(state().selected);
    let anchor = state().anchor;
    const visible = state().commits.map((commit) => commit.hash);
    if (event.shiftKey && anchor && visible.includes(anchor)) {
      const a = visible.indexOf(anchor),
        b = visible.indexOf(c.hash);
      if (!event.metaKey && !event.ctrlKey) selected.clear();
      visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((hash) => selected.add(hash));
    } else if (event.metaKey || event.ctrlKey) {
      if (!selected.delete(c.hash)) selected.add(c.hash);
      anchor = c.hash;
    } else {
      selected = new Set([c.hash]);
      anchor = c.hash;
    }
    flushSync(() => ctx.store.setState({ selected, anchor }));
    if (previous !== [...selected].join(',')) ctx.actions.branches.requestDetails();
    if (state().visible && !ctx.env.document.hidden)
      [...$('commits').querySelectorAll<HTMLElement>('.commit')]
        .find((row) => row.dataset.hash === c.hash)
        ?.focus({ preventScroll: true });
  }
  function navigateBranchHead(branchRef: string) {
    ctx.actions.history.cancelFilterTimer();
    setStatus('Locating branch head…');
    ctx.actions.history.requestHistory('branchJump', {
      branchRef,
      ref: state().ref,
      limit: state().limit,
      filters: ctx.actions.history.filters(),
    });
  }
  function navigateToRevision(hash: string) {
    if (state().commits.some((commit) => commit.hash === hash)) {
      jumpToCommit(hash, undefined);
      return;
    }
    ctx.actions.history.cancelFilterTimer();
    setStatus('Loading commit ' + hash.slice(0, 8) + '…');
    ctx.actions.history.requestHistory('revisionJump', {
      target: hash,
      ref: state().ref,
      limit: state().limit,
      filters: ctx.actions.history.filters(),
    });
  }
  function jumpToCommit(hash, edge) {
    const commit = state().commits.find((item) => item.hash === hash);
    if (!commit) {
      ctx.actions.history.cancelFilterTimer();
      setStatus(`Loading parent ${hash.slice(0, 8)}…`);
      ctx.actions.history.requestHistory('graphJump', {
        target: hash,
        ref: state().ref,
        limit: state().limit,
        filters: ctx.actions.history.filters(),
      });
      ctx.store.setState({ pendingGraphJump: { hash, edge, requestId: state().historyRequest } });
      return;
    }
    revealCommit(hash, 'center');
    select(commit);
    if (state().visible && !ctx.env.document.hidden) highlightGraphJump(hash, edge);
  }
  function highlightGraphJump(hash, edge) {
    graphJumpAnimations.forEach((animation) => animation.cancel());
    graphJumpAnimations = [];
    const list = $('commits'),
      row = [...list.querySelectorAll<HTMLElement>('.commit')].find(
        (row) => row.dataset.hash === hash,
      );
    const dot = row?.querySelector<HTMLElement>('.graph-node');
    // The other arrow is on the adjacent row, and there may be several incoming
    // edges. Match both endpoints and the reverse direction, never just a lane.
    const arrow = edge
      ? [...list.querySelectorAll<HTMLElement>('.graph-jump')]
          .find(
            (node) =>
              node.getAttribute('data-edge-source') === edge.source &&
              node.getAttribute('data-edge-parent') === edge.parent &&
              node.getAttribute('data-target') !== hash,
          )
          ?.querySelector<HTMLElement>('.graph-arrow-shape')
      : undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const highlight =
      getComputedStyle(document.documentElement).getPropertyValue('--vscode-focusBorder').trim() ||
      '#58a6ff';
    for (const node of [dot, arrow]) {
      if (!node) continue;
      const rest = {
        opacity: 0,
        transform: 'scale(1)',
        stroke: node.getAttribute('stroke') || 'transparent',
        strokeWidth: node.getAttribute('stroke-width') || '0',
      };
      const emphasis = {
        opacity: 1,
        transform: reducedMotion ? 'scale(1)' : `scale(${node === dot ? 1.55 : 1.35})`,
        stroke: highlight,
        strokeWidth: '2',
      };
      const animation = node.animate(
        reducedMotion ? [emphasis, emphasis] : [rest, emphasis, rest],
        {
          duration: reducedMotion ? 2400 : 800,
          iterations: reducedMotion ? 1 : 3,
          easing: 'ease-in-out',
        },
      );
      graphJumpAnimations.push(animation);
      animation.onfinish = () => {
        graphJumpAnimations = graphJumpAnimations.filter((item) => item !== animation);
      };
    }
  }
  function finishGraphJump(data) {
    const pending = state().pendingGraphJump;
    const edge =
      pending && pending.hash === data.target && pending.requestId === data.requestId
        ? pending.edge
        : undefined;
    ctx.store.setState({ pendingGraphJump: undefined });
    cancelAnimationFrame(graphJumpFrame);
    graphJumpFrame = requestAnimationFrame(() => {
      graphJumpFrame = 0;
      if (data.requestId !== state().historyRequest) return;
      jumpToCommit(data.target, edge);
      if (data.resetFilters)
        setStatus('Filters cleared to reveal commit ' + data.target.slice(0, 8));
    });
  }
  function graphRenderKey(g, rowHeight = 24) {
    return JSON.stringify([
      rowHeight,
      g.lane,
      g.width,
      ctx.actions.graph.getWidth(),
      g.colorId,
      g.segments.map((s) => [s.from, s.to, s.startY, s.endY, s.edge.colorId, s.edge.dashed]),
      g.arrows.map((a) => [a.lane, a.down, a.y, a.edge.source, a.edge.hash]),
    ]);
  }
  // The data model owns indices/selection; DOM rows represent only a small window.
  let commitRows: ReturnType<typeof createRows>;
  let indexedCommits;
  let indexedLongEdges;
  let commitIndices = new Map<string, number>();
  let commitRowHeight = 24;
  let virtualStart = -1,
    virtualEnd = -1;

  function revealCommit(hash: string, alignment: 'nearest' | 'center' = 'nearest') {
    const index = commitIndices.get(hash);
    if (index === undefined) return;
    const list = $('commits'),
      top = index * commitRowHeight;
    if (alignment === 'center')
      list.scrollTop = Math.max(0, top - (list.clientHeight - commitRowHeight) / 2);
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (top + commitRowHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + commitRowHeight - list.clientHeight;
    renderCommitWindow();
    return [...list.querySelectorAll<HTMLElement>('.commit')].find(
      (row) => row.dataset.hash === hash,
    );
  }
  function renderCommits() {
    if (
      indexedCommits !== state().commits ||
      commitRows?.length !== state().commits.length ||
      indexedLongEdges !== state().viewSettings.longEdges
    ) {
      commitRows = createRows(state().commits, state().viewSettings.longEdges);
      commitIndices = new Map(state().commits.map((commit, i) => [commit.hash, i]));
      indexedCommits = state().commits;
      indexedLongEdges = state().viewSettings.longEdges;
    }
    commitRowHeight =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--log-commit-height'),
      ) || 24;
    ctx.actions.graph.setWidth(Math.ceil(((commitRows.maxWidth * 16 + 2) * commitRowHeight) / 22));
    ctx.actions.columns.applyColumns();
    renderCommitWindow(true);
    ctx.actions.graph.repaintGraphCanvases();
  }
  function renderCommitWindow(force = false) {
    if (!commitRows) return;
    const list = $('commits'),
      rowHeight = commitRowHeight;
    const scroll = Math.min(
      list.scrollTop,
      Math.max(0, state().commits.length * rowHeight - list.clientHeight),
    );
    const overscan = 12;
    const start = Math.max(0, Math.floor(scroll / rowHeight) - overscan);
    const end = Math.min(
      state().commits.length,
      Math.ceil((scroll + list.clientHeight) / rowHeight) + overscan,
    );
    if (!force && virtualStart === start && virtualEnd === end) return;
    if (document.body.classList.contains('reordering-columns')) {
      // Preserve the captured cell until pointerup; scrolling is not a cancellation.
      if (!force) return;
      ctx.actions.columns.cancelDrag();
    }
    virtualStart = start;
    virtualEnd = end;
    const focusedRow = (document.activeElement as Element)?.closest('.commit');
    const focusHash = focusedRow?.getAttribute('data-hash');
    const resolveCommit = (hash: string) => {
      const index = commitIndices.get(hash);
      return index === undefined ? undefined : state().commits[index];
    };
    spacerStyles[0].height = `${start * rowHeight}px`;
    spacerStyles[1].height = `${(state().commits.length - end) * rowHeight}px`;
    const formatDate = createCommitDateFormatter();
    const rows: import('../react/commit-list').CommitRowModel[] = [];
    const notPicked = state().notPickedHashes;
    for (let i = start; i < end; i++) {
      const c = state().commits[i],
        graph = commitRows.get(i);
      const isMe =
        Boolean(state().user) &&
        resolveUsers(['me'], [{ name: c.author || '', email: c.email || '' }], {
          name: state().userName,
          email: state().user,
        }).length > 0;
      const highlight =
        (state().viewSettings['highlight-merges'] && c.parents.length > 1) ||
        (state().viewSettings['highlight-me'] && isMe) ||
        (state().viewSettings['highlight-head'] && state().headHashes.has(c.hash));
      const dateValue = state().viewSettings.commitTimestamp ? c.date : c.authorDate || c.date,
        dateLabel = formatDate(dateValue);
      const allDecorations = c.decorations ?? '';
      const decorations = state().viewSettings['show-tags']
        ? allDecorations
        : allDecorations
            .split(', ')
            .filter((d) => !d.startsWith('tag:'))
            .join(', ');
      const groups = referenceGroups(
        decorations,
        state().branches,
        state().viewSettings.compactRefs,
      );
      const contentKey = JSON.stringify([
        groups,
        dateLabel,
        state().viewSettings,
        c.hash,
        c.subject,
        c.parents,
        c.decorations,
        c.author,
        c.email,
        c.date,
        c.authorDate,
        c.signature,
        highlight,
        isMe,
        state().headHashes.has(c.hash),
        state().notPickedHashes?.includes(c.hash),
      ]);
      const values = {
        author: c.author ?? '',
        hash: c.hash.slice(0, 8),
        date: dateLabel,
        signature:
          {
            G: 'Good',
            B: 'Bad',
            U: 'Unknown trust',
            X: 'Expired',
            Y: 'Expired key',
            R: 'Revoked',
            E: 'Cannot verify',
            N: 'Unsigned',
          }[c.signature ?? 'N'] || 'Unsigned',
      };
      const titles = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          `${key === 'hash' ? c.hash : key === 'date' && dateValue ? new Date(dateValue).toLocaleString() : value}\nHold and drag to reorder ${columnLabels[key]} column`,
        ]),
      );
      rows.push({
        commit: c,
        contentKey,
        graphKey: graphRenderKey(graph, rowHeight),
        graphWidth: ctx.actions.graph.rowGraphWidth(graph, rowHeight),
        selected: state().selected.has(c.hash),
        highlight,
        mergeMuted: state().viewSettings['highlight-merges'] && c.parents.length > 1,
        headHighlight: state().viewSettings['highlight-head'] && state().headHashes.has(c.hash),
        cherryMuted:
          state().viewSettings.notPicked && Array.isArray(notPicked) && !notPicked.includes(c.hash),
        isMe,
        index: i,
        total: state().commits.length,
        decorations,
        referenceGroups: groups,
        refsLeft: state().viewSettings.refsLeft,
        compactRefs: state().viewSettings.compactRefs,
        columns: state().columnOrder.filter(
          (key) => key === 'subject' || state().viewSettings[key],
        ),
        values,
        titles,
        graph: () => ctx.actions.graph.graphCell(graph, jumpToCommit, rowHeight, resolveCommit),
      });
    }
    flushSync(() =>
      viewport.setState({
        rows,
        select,
        context: (commit, event) =>
          ctx.actions.branches.openCommitMenu(commit, event.clientX, event.clientY),
        onKeyDown: commitRowKey,
        drag: ctx.actions.columns.installColumnDrag,
        resize: ctx.actions.columns.installColumnResize,
        emptyText: state().commits.length
          ? undefined
          : comparison &&
              !state().search &&
              !state().filterState.authors.length &&
              !state().filterState.paths.length &&
              !state().filterState.since &&
              !state().filterState.until
            ? `${comparison.start.name} contains all commits from ${comparison.end.name}`
            : 'No matching commits.',
      }),
    );
    const wanted = [...list.querySelectorAll<HTMLElement>('.commit')];
    list.scrollTop = scroll;
    if (focusHash && !list.contains(document.activeElement)) {
      // Keep keyboard ownership when the focused row is recycled by wheel scrolling.
      (
        wanted.find((row) => row.dataset.hash === focusHash) ||
        wanted[Math.min(overscan, wanted.length - 1)]
      )?.focus({ preventScroll: true });
    }
  }
  function commitRowKey(c, event, row) {
    const shortcutKey = event.code || event.key;
    if (
      event.altKey &&
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      ['KeyC', 'c', 'C'].includes(shortcutKey)
    ) {
      event.preventDefault();
      send('commitAction', {
        action: 'copy',
        hashes: state()
          .commits.filter((c) => state().selected.has(c.hash))
          .map((c) => c.hash),
      });
      return;
    }
    if (
      event.altKey &&
      event.metaKey &&
      !event.shiftKey &&
      ['KeyN', 'n', 'N'].includes(shortcutKey) &&
      state().selected.size === 1
    ) {
      event.preventDefault();
      ctx.actions.branches.openCommitRefDialog('branch', [...state().selected][0]);
      return;
    }
    if (
      ['ArrowLeft', 'ArrowRight'].includes(event.key) &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      state().selected.size === 1
    ) {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const selected = state().commits.find((c) => state().selected.has(c.hash));
      if (selected)
        ctx.actions.branches.navigateCommit(
          selected,
          event.key === 'ArrowRight',
          rect.left,
          rect.bottom,
        );
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      ctx.actions.branches.openCommitMenu(c, rect.left, rect.bottom);
      return;
    }
    if (event.key === ' ' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      select(c, event);
      return;
    }
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)
    ) {
      event.preventDefault();
      const page = Math.max(1, Math.floor($('commits').clientHeight / commitRowHeight));
      const delta = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page }[event.key];
      const index = commitIndices.get(c.hash);
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? state().commits.length - 1
            : Math.max(0, Math.min(state().commits.length - 1, index + delta));
      const nextCommit = state().commits[nextIndex];
      const next = revealCommit(nextCommit.hash);
      if (event.metaKey || event.ctrlKey) next?.focus({ preventScroll: true });
      else select(nextCommit, event);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      flushSync(() =>
        ctx.store.setState({ selected: new Set(state().commits.map((item) => item.hash)) }),
      );
      ctx.actions.branches.requestDetails();
    }
  }

  return {
    start() {
      spacerStyles = ['top', 'bottom'].map((side) => {
        const index = layoutSheet.insertRule(
          `.commit-spacer-${side} {}`,
          layoutSheet.cssRules.length,
        );
        return (layoutSheet.cssRules[index] as CSSStyleRule).style;
      });
      ctx.ui.setSlots({
        commits: createElement(CommitViewport, { model: viewport, session: ctx.store }),
      });
      commitViewportObserver = new (window as Window & typeof globalThis).ResizeObserver(() => {
        if (virtualResizeFrame) return;
        virtualResizeFrame = requestAnimationFrame(() => {
          virtualResizeFrame = 0;
          renderCommitWindow();
          ctx.actions.graph.repaintGraphCanvases();
        });
      });
      commitViewportObserver.observe($('commits'));
      stop = ctx.store.subscribe((next, previous) => {
        if (
          next.commits !== previous.commits ||
          next.viewSettings !== previous.viewSettings ||
          next.branches !== previous.branches ||
          next.user !== previous.user ||
          next.userName !== previous.userName ||
          next.headHashes !== previous.headHashes ||
          next.notPickedHashes !== previous.notPickedHashes
        )
          renderCommits();
      });
      renderCommits();
    },
    dispose() {
      stop?.();
      commitViewportObserver?.disconnect();
      cancelAnimationFrame(virtualResizeFrame);
      cancelAnimationFrame(graphJumpFrame);
      graphJumpAnimations.forEach((animation) => animation.cancel());
    },
    select,
    navigateBranchHead,
    navigateToRevision,
    jumpToCommit,
    highlightGraphJump,
    finishGraphJump,
    revealCommit,
    renderCommits,
    renderCommitWindow,
    commitRowKey,
    getCacheStats: () => ({
      rows: commitRows?.cacheSize || 0,
      positions: commitRows?.positionCacheSize || 0,
    }),
  };
}
