import { flushSync } from 'react-dom';
import type { LogContext } from './context';

export const columnLabels = {
  author: 'Author',
  hash: 'Hash',
  date: 'Date',
  signature: 'GPG Signature',
};
export interface ColumnsController {
  start(): void;
  dispose(): void;
  normalizeColumnOrder(saved: unknown): string[];
  applyColumns(): void;
  moveColumn(source: string, target: string, after: boolean): void;
  saveView(): void;
  installColumnDrag(node: HTMLElement, key: string): void;
  installColumnResize(grip: HTMLElement, key: string): void;
  cancelDrag(): void;
  getRuleStyle(): CSSStyleDeclaration;
}

export function createColumnsController(ctx: LogContext): ColumnsController {
  const { api, $, document, window, layoutSheet } = ctx.env;
  const state = ctx.store.getState;
  const requestAnimationFrame = window.requestAnimationFrame.bind(window);
  const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const matchMedia = window.matchMedia.bind(window);
  const graphColumnMinimum = 230;
  let columnRule: number;
  let repaintFrame = 0;
  let stop: (() => void) | undefined;
  const columnResizeStyles: Record<string, CSSStyleDeclaration> = {};
  const columnDragStyles: Record<string, CSSStyleDeclaration> = {};
  function ensureStyles() {
    if (columnRule !== undefined) return;
    columnRule = layoutSheet.insertRule('.commit {}', layoutSheet.cssRules.length);
    for (const key of ['subject', ...Object.keys(columnLabels)]) {
      const resize = layoutSheet.insertRule(
        `.commit > [data-column="${key}"] > .column-resizer {}`,
        layoutSheet.cssRules.length,
      );
      columnResizeStyles[key] = (layoutSheet.cssRules[resize] as CSSStyleRule).style;
      const drag = layoutSheet.insertRule(
        `.commit > [data-column="${key}"] {}`,
        layoutSheet.cssRules.length,
      );
      columnDragStyles[key] = (layoutSheet.cssRules[drag] as CSSStyleRule).style;
    }
  }
  function saveView() {
    const { viewSettings, columnWidths, columnOrder } = state();
    api.setState({ ...api.getState(), viewSettings, columnWidths, columnOrder });
  }
  const cancelDrag = () => cancelColumnDrag?.();
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancelDrag();
  };
  function normalizeColumnOrder(saved) {
    const order = Array.isArray(saved) ? saved : [];
    return [
      ...new Set([
        ...(order.includes('subject') ? [] : ['subject']),
        ...order,
        ...Object.keys(columnLabels),
      ]),
    ].filter((key) => key === 'subject' || Object.hasOwn(columnLabels, key));
  }
  function applyColumns() {
    ensureStyles();
    (layoutSheet.cssRules[columnRule] as CSSStyleRule).style.gridTemplateColumns = state()
      .columnOrder.filter((key) => key === 'subject' || state().viewSettings[key])
      .map((key) =>
        key === 'subject'
          ? `minmax(min(${graphColumnMinimum}px, 50%),1fr)`
          : `minmax(0,${state().columnWidths[key]}px)`,
      )
      .join(' ');
    const visible = state().columnOrder.filter(
      (key) => key === 'subject' || state().viewSettings[key],
    );
    // Keep every column in the viewport. Saved widths remain preferred sizes, so
    // widening the pane restores them without persisting a temporary squeeze.
    (layoutSheet.cssRules[columnRule] as CSSStyleRule).style.minWidth = '0';
    for (const [key, style] of Object.entries(columnResizeStyles)) {
      style.left = 'auto';
      style.right = '-5px';
      style.display = key === visible.at(-1) ? 'none' : '';
    }
  }
  function moveColumn(source, target, after) {
    if (
      source === target ||
      !state().columnOrder.includes(source) ||
      !state().columnOrder.includes(target)
    )
      return;
    const next = state().columnOrder.filter((key) => key !== source);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
    flushSync(() => ctx.store.setState({ columnOrder: next }));
    applyColumns();
    saveView();
    cancelAnimationFrame(repaintFrame);
    repaintFrame = requestAnimationFrame(() => {
      repaintFrame = 0;
      ctx.actions.graph.repaintGraphCanvases();
    });
  }
  let cancelColumnDrag;
  // Keep the grid fixed while dragging. Only the held column follows the pointer;
  // its neighbours slide into the vacant slot after crossing their midpoint.
  function installColumnDrag(node, key) {
    node.dataset.column = key;
    let press,
      scrollAnimation = 0,
      suppressClick = false;
    const finish = (commit = false) => {
      if (!press) return;
      cancelAnimationFrame(scrollAnimation);
      scrollAnimation = 0;
      const active = press.active;
      if (active) {
        suppressClick = true;
        const cells = [...$('commits').querySelectorAll<HTMLElement>('.log-column')];
        const positions = cells.map((cell) => cell.getBoundingClientRect().left);
        if (commit && press.destination !== key) {
          const sourceIndex = press.columns.findIndex((c) => c.key === key);
          const destinationIndex = press.columns.findIndex((c) => c.key === press.destination);
          moveColumn(key, press.destination, destinationIndex > sourceIndex);
        }
        for (const style of Object.values(columnDragStyles)) {
          style.transform = '';
          style.transition = '';
          style.zIndex = '';
          style.background = '';
          style.boxShadow = '';
        }
        document.body.classList.remove('reordering-columns');
        // Settle into the final slot (or return to the initial one on cancellation).
        cells.forEach((cell, index) => {
          const delta = positions[index] - cell.getBoundingClientRect().left;
          if (delta && !matchMedia('(prefers-reduced-motion: reduce)').matches)
            cell.animate(
              [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
              {
                duration: 150,
                easing: 'ease-out',
              },
            );
        });
      }
      press = undefined;
      cancelColumnDrag = undefined;
      // Scrolling may have deferred recycling the captured row during the drag.
      if (active) ctx.actions.commits.renderCommitWindow();
    };
    node.addEventListener('pointerdown', (event) => {
      if (
        event.button !== 0 ||
        (event.target as HTMLElement).closest('.column-resizer, .graph-jump')
      )
        return;
      cancelColumnDrag?.();
      suppressClick = false;
      press = {
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        active: false,
        destination: key,
        scrollLeft: $('commits').scrollLeft,
        maxScroll: Math.max(0, $('commits').scrollWidth - $('commits').clientWidth),
      };
      cancelColumnDrag = () => finish();
      node.setPointerCapture(event.pointerId);
    });
    node.addEventListener('pointermove', (event) => {
      if (!press) return;
      if (!press.active) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) return;
        press.active = true;
        press.columns = [...node.parentElement.querySelectorAll('.log-column')].map((cell) => ({
          key: cell.dataset.column,
          ...pickColumnRect(cell),
        }));
        document.body.classList.add('reordering-columns');
        const style = columnDragStyles[key];
        style.zIndex = '3';
        style.background = 'var(--vscode-editor-background)';
        style.boxShadow = '0 0 8px var(--vscode-widget-shadow)';
      }
      event.preventDefault();
      event.stopPropagation();
      press.pointerX = event.clientX;
      updateDrag();
      if (!scrollAnimation) scrollAnimation = requestAnimationFrame(scrollAtEdge);
    });
    function updateDrag() {
      const columns = press.columns,
        source = columns.find((c) => c.key === key),
        sourceIndex = columns.indexOf(source);
      const delta = press.pointerX - press.x + $('commits').scrollLeft - press.scrollLeft,
        center = source.left + source.width / 2 + delta;
      // Transforms must not create extra scrollable space while approaching an edge.
      const heldDelta = Math.max(
        columns[0].left - source.left,
        Math.min(delta, columns.at(-1).left + columns.at(-1).width - source.left - source.width),
      );
      let destinationIndex = sourceIndex;
      for (let i = sourceIndex + 1; i < columns.length; i++)
        if (center > columns[i].left + columns[i].width / 2) destinationIndex = i;
      for (let i = sourceIndex - 1; i >= 0; i--)
        if (center < columns[i].left + columns[i].width / 2) destinationIndex = i;
      press.destination = columns[destinationIndex].key;
      const gap = columns.length > 1 ? columns[1].left - columns[0].left - columns[0].width : 0;
      for (let i = 0; i < columns.length; i++) {
        const column = columns[i],
          style = columnDragStyles[column.key];
        const offset =
          column.key === key
            ? heldDelta
            : i > sourceIndex && i <= destinationIndex
              ? -(source.width + gap)
              : i < sourceIndex && i >= destinationIndex
                ? source.width + gap
                : 0;
        style.transition =
          column.key === key || matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'none'
            : 'transform 140ms ease-out';
        style.transform = `translateX(${offset}px)`;
      }
    }
    function scrollAtEdge() {
      scrollAnimation = 0;
      if (!press?.active) return;
      const list = $('commits'),
        bounds = list.getBoundingClientRect(),
        edge = 32,
        x = press.pointerX;
      const speed =
        x < bounds.left + edge
          ? -Math.min(18, (bounds.left + edge - x) / 2)
          : x > bounds.right - edge
            ? Math.min(18, (x - bounds.right + edge) / 2)
            : 0;
      if (!speed) return;
      const previous = list.scrollLeft;
      list.scrollLeft = Math.max(0, Math.min(press.maxScroll, previous + speed));
      if (list.scrollLeft === previous) return;
      updateDrag();
      scrollAnimation = requestAnimationFrame(scrollAtEdge);
    }
    node.addEventListener('pointerup', (event) => {
      if (press?.active) {
        event.preventDefault();
        event.stopPropagation();
      }
      finish(true);
    });
    for (const type of ['pointercancel', 'lostpointercapture'])
      node.addEventListener(type, () => finish());
    node.addEventListener('pointerleave', () => {
      if (!press?.active) finish();
    });
    node.addEventListener(
      'click',
      (event) => {
        if (suppressClick) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick = false;
        }
      },
      true,
    );
    node.addEventListener('dragstart', (event) => event.preventDefault());
  }
  function pickColumnRect(cell) {
    const { left, width } = cell.getBoundingClientRect();
    return { left, width };
  }

  function installColumnResize(grip, key) {
    const measure = () => {
      const visible = state().columnOrder.filter(
        (column) => column === 'subject' || state().viewSettings[column],
      );
      const index = visible.indexOf(key);
      if (index < 0 || index === visible.length - 1) return;
      const row = grip.parentElement.parentElement;
      return {
        index,
        columns: visible.map((column) => ({
          key: column,
          width: row.querySelector(`[data-column="${column}"]`).getBoundingClientRect().width,
          min: column === 'subject' ? graphColumnMinimum : 55,
        })),
      };
    };
    const resize = (initial: NonNullable<ReturnType<typeof measure>>, delta: number) => {
      const columns = resizeSubsequentColumns(initial.columns, initial.index, delta);
      // Persist the measured widths, including preceding columns. Their saved
      // preferred widths may differ from the actual widths in a squeezed pane.
      // The graph remains flexible and receives precisely its allocated remainder.
      ctx.store.setState({
        columnWidths: {
          ...state().columnWidths,
          ...Object.fromEntries(columns.map((column) => [column.key, column.width])),
        },
      });
      applyColumns();
      ctx.actions.graph.repaintGraphCanvases();
    };
    grip.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const initial = measure();
      if (!initial) return;
      const start = event.clientX;
      grip.setPointerCapture(event.pointerId);
      grip.onpointermove = (move) => resize(initial, move.clientX - start);
      const end = () => {
        grip.onpointermove = null;
        saveView();
      };
      grip.onpointerup = end;
      grip.onpointercancel = end;
      grip.onlostpointercapture = end;
    };
    grip.onclick = (event) => event.stopPropagation();
    grip.onkeydown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const initial = measure();
      if (initial) {
        resize(initial, event.key === 'ArrowRight' ? 10 : -10);
        saveView();
      }
    };
  }

  return {
    start() {
      const columnOrder = normalizeColumnOrder(state().columnOrder);
      if (JSON.stringify(columnOrder) !== JSON.stringify(state().columnOrder))
        ctx.store.setState({ columnOrder });
      applyColumns();
      document.addEventListener('keydown', keydown);
      window.addEventListener('blur', cancelDrag);
      window.addEventListener('resize', cancelDrag);
      stop = ctx.store.subscribe((next, previous) => {
        if (
          next.columnOrder !== previous.columnOrder ||
          next.columnWidths !== previous.columnWidths ||
          next.viewSettings !== previous.viewSettings
        )
          applyColumns();
      });
    },
    dispose() {
      cancelDrag();
      cancelAnimationFrame(repaintFrame);
      stop?.();
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('resize', cancelDrag);
    },
    normalizeColumnOrder,
    applyColumns,
    moveColumn,
    saveView,
    installColumnDrag,
    installColumnResize,
    cancelDrag,
    getRuleStyle() {
      ensureStyles();
      return (layoutSheet.cssRules[columnRule] as CSSStyleRule).style;
    },
  };
}

interface ResizableColumn {
  key: string;
  width: number;
  min: number;
}

/** JTable AUTO_RESIZE_SUBSEQUENT_COLUMNS: only the held column and its successors change.
 * Delta is shared by remaining capacity towards each bound, not by raw width.
 * https://docs.oracle.com/en/java/javase/21/docs/api/java.desktop/javax/swing/JTable.html#doLayout()
 */
export function resizeSubsequentColumns(
  columns: readonly ResizableColumn[],
  index: number,
  delta: number,
): ResizableColumn[] {
  const result = columns.map((column) => ({ ...column }));
  if (index < 0 || index >= result.length - 1 || !Number.isFinite(delta)) return result;
  const left = result[index];
  const right = result.slice(index + 1);
  // Match TableColumn's effectively unbounded default maximum. If the pane was
  // already squeezed below a minimum, a drag must not make that column jump.
  const maximum = 2147483647;
  const shrink = (column: ResizableColumn) => Math.max(0, column.width - column.min);
  const grow = (column: ResizableColumn) => Math.max(0, maximum - column.width);
  const rightShrink = right.reduce((sum, column) => sum + shrink(column), 0);
  const rightGrow = right.reduce((sum, column) => sum + grow(column), 0);
  const applied = Math.max(
    -Math.min(shrink(left), rightGrow),
    Math.min(delta, grow(left), rightShrink),
  );
  if (!applied) return result;
  left.width += applied;
  const capacity = applied > 0 ? shrink : grow;
  let remainingCapacity = applied > 0 ? rightShrink : rightGrow;
  let remainingDelta = -applied;
  for (const column of right) {
    const available = capacity(column);
    if (!available) continue;
    const share = remainingDelta * (available / remainingCapacity);
    column.width += share;
    remainingDelta -= share;
    remainingCapacity -= available;
  }
  return result;
}
