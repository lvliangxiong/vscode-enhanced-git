import { installJunctionResize } from './resize';
import type { LogContext } from './context';

export interface LayoutController {
  start(): void;
  dispose(): void;
  applyLayout(): void;
  applyDetailSplit(): void;
  applyDetailLayout(): void;
  saveLayout(): void;
  toggleBranches(): void;
  toggleDetails(): void;
}
/** Layout state lives in the session store; this adapter only measures and applies geometry. */
export function createLayoutController(ctx: LogContext): LayoutController {
  const { store, lifetime } = ctx;
  const state = store.getState;
  const { $, api, send, document, window, layoutSheet, comparison } = ctx.env;
  const style = (selector: string) =>
    (
      layoutSheet.cssRules[
        layoutSheet.insertRule(`${selector} {}`, layoutSheet.cssRules.length)
      ] as CSSStyleRule
    ).style;
  const layoutStyle = style('main');
  const detailStyle = style('#message');
  const junctionStyle = style('#split-junction');
  const bounds = () => {
    const total =
      $('layout').clientWidth *
        (state().previewLocation === 'right' && state().showPreview ? 0.7 : 1) -
      (comparison || state().branchesCollapsed ? 0 : 4) -
      (state().detailsCollapsed ? 0 : 4);
    const sideMin = Math.min(220, total * 0.3);
    // Reserve space for five fixed-width actions. On very
    // narrow hosts, share the available width without overflowing the layout.
    const rightMin = Math.min(260, total * 0.65);
    const centerMin = Math.min(240, Math.max(0, total - sideMin - rightMin));
    return { total, sideMin, rightMin, centerMin };
  };
  const detailHeight = () =>
    Math.max(
      0,
      $('detail').clientHeight -
        $('detail').querySelector<HTMLElement>('.detail-toolbar').offsetHeight -
        4,
    );
  function applyLayout() {
    const { total, sideMin, rightMin, centerMin } = bounds();
    if (total <= 0) return;
    const railWidth =
      parseFloat(
        window
          .getComputedStyle(document.documentElement)
          .getPropertyValue('--log-branch-rail-width'),
      ) || 32;
    let left = comparison
      ? 0
      : state().branchesCollapsed
        ? railWidth
        : Math.max(sideMin, total * state().widths.left);
    let right = state().detailsCollapsed
      ? railWidth
      : Math.max(rightMin, total * state().widths.right);
    const maxSides = total - centerMin;
    if (state().detailsCollapsed) left = Math.min(left, Math.max(0, maxSides - right));
    else if (comparison || state().branchesCollapsed)
      right = Math.min(right, Math.max(0, maxSides - left));
    else if (left + right > maxSides) {
      const available = Math.max(0, maxSides - sideMin - rightMin),
        extra = left + right - sideMin - rightMin;
      left = sideMin + (extra ? ((left - sideMin) / extra) * available : 0);
      right = maxSides - left;
    }
    layoutStyle.gridTemplateColumns = `${left}px ${comparison || state().branchesCollapsed ? 0 : 4}px minmax(0, 1fr) ${state().detailsCollapsed ? 0 : 4}px ${right}px${state().previewLocation === 'right' && state().showPreview ? ' 30%' : ''}`;
    for (const [id, value] of [
      ['split-left', left],
      ['split-right', right],
    ] as const) {
      $(id).setAttribute(
        'aria-valuemin',
        String(Math.round(id === 'split-right' ? rightMin : sideMin)),
      );
      $(id).setAttribute(
        'aria-valuemax',
        String(Math.round(maxSides - (id === 'split-right' ? left : right))),
      );
      $(id).setAttribute('aria-valuenow', String(Math.round(value)));
    }
  }
  function applyDetailSplit() {
    if (!state().showDetails || state().detailsCollapsed) return;
    const total = detailHeight(),
      min = Math.min(48, total / 2);
    const top = Math.max(min, Math.min(total - min, total * state().detailRatio));
    detailStyle.flexBasis = `${total - top}px`;
    const sash = $('split-detail');
    sash.setAttribute('aria-valuemin', String(Math.round(min)));
    sash.setAttribute('aria-valuemax', String(Math.round(total - min)));
    sash.setAttribute('aria-valuenow', String(Math.round(top)));
    const layout = $('layout').getBoundingClientRect(),
      vertical = $('split-right').getBoundingClientRect();
    junctionStyle.top = `${sash.getBoundingClientRect().top - layout.top - 4}px`;
    junctionStyle.left = `${vertical.left - layout.left - 4}px`;
  }
  function applyDetailLayout() {
    applyLayout();
    applyDetailSplit();
  }
  function saveLayout() {
    const layout = {
      ...state().widths,
      branchesCollapsed: state().branchesCollapsed,
      detailsCollapsed: state().detailsCollapsed,
      detailRatio: state().detailRatio,
    };
    api.setState({ ...api.getState(), layout });
    if (!comparison) send('layoutState', { layout });
  }
  function toggleBranches() {
    store.setState({ branchesCollapsed: !state().branchesCollapsed });
    ctx.ui.closeContextMenu();
    saveLayout();
    $('branches-toggle').focus();
  }
  function toggleDetails() {
    store.setState({ detailsCollapsed: !state().detailsCollapsed });
    ctx.actions.toolbar.closeFilesMenu();
    saveLayout();
    window.requestAnimationFrame(() =>
      $(state().detailsCollapsed ? 'details-expand' : 'details-toggle').focus(),
    );
  }
  function collapseDraggedPane(side: 'left' | 'right', desired: number, restoreWidth: number) {
    const { sideMin, rightMin } = bounds();
    const threshold = Math.min(80, (side === 'left' ? sideMin : rightMin) / 2);
    if (desired > threshold) return false;
    store.setState({
      widths: { ...state().widths, [side]: restoreWidth },
      ...(side === 'left' ? { branchesCollapsed: true } : { detailsCollapsed: true }),
    });
    ctx.ui.closeContextMenu();
    if (side === 'right') ctx.actions.toolbar.closeFilesMenu();
    saveLayout();
    window.requestAnimationFrame(() =>
      $(side === 'left' ? 'branches-toggle' : 'details-expand').focus(),
    );
    return true;
  }
  function resizeWidth(side: 'left' | 'right', desired: number) {
    const { total, sideMin, rightMin, centerMin } = bounds();
    if (total <= 0) return;
    const other = $(side === 'left' ? 'detail' : 'branch-pane').getBoundingClientRect().width;
    store.setState({
      widths: {
        ...state().widths,
        [side]:
          Math.max(
            side === 'right' ? rightMin : sideMin,
            Math.min(total - centerMin - other, desired),
          ) / total,
      },
    });
  }
  function resizeHeight(desired: number) {
    const total = detailHeight(),
      min = Math.min(48, total / 2);
    if (total > 0)
      store.setState({ detailRatio: Math.max(min, Math.min(total - min, desired)) / total });
  }
  function installWidthSash(id: string, side: 'left' | 'right') {
    const sash = $(id);
    const pane = () => $(side === 'left' ? 'branch-pane' : 'detail');
    let drag: { x: number; width: number; restoreWidth: number } | undefined;
    lifetime.listen(sash, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag = {
        x: event.clientX,
        width: pane().getBoundingClientRect().width,
        restoreWidth: state().widths[side],
      };
      sash.setPointerCapture(event.pointerId);
      sash.classList.add('dragging');
      document.body.classList.add('resizing');
      event.preventDefault();
    });
    lifetime.listen(sash, 'pointermove', (event: PointerEvent) => {
      if (!drag) return;
      const desired = drag.width + (event.clientX - drag.x) * (side === 'left' ? 1 : -1);
      if (collapseDraggedPane(side, desired, drag.restoreWidth)) {
        end();
        if (sash.hasPointerCapture(event.pointerId)) sash.releasePointerCapture(event.pointerId);
      } else resizeWidth(side, desired);
    });
    const end = () => {
      if (!drag) return;
      drag = undefined;
      sash.classList.remove('dragging');
      document.body.classList.remove('resizing');
      saveLayout();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
      lifetime.listen(sash, event, end);
    lifetime.listen(sash, 'keydown', (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') store.setState({ widths: { left: 0.23, right: 0.27 } });
      else
        resizeWidth(
          side,
          pane().getBoundingClientRect().width +
            (event.key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1),
        );
      saveLayout();
    });
    lifetime.listen(sash, 'dblclick', () => {
      store.setState({ widths: { left: 0.23, right: 0.27 } });
      saveLayout();
    });
  }
  function start() {
    installWidthSash('split-left', 'left');
    installWidthSash('split-right', 'right');
    const sash = $('split-detail'),
      junction = $('split-junction');
    let junctionRestoreWidth = state().widths.right;
    lifetime.add(
      installJunctionResize(junction, {
        measure: () => {
          junctionRestoreWidth = state().widths.right;
          return {
            width: $('detail').getBoundingClientRect().width,
            height: $('files').getBoundingClientRect().height,
          };
        },
        collapse: (width) => collapseDraggedPane('right', width, junctionRestoreWidth),
        resize: (width, height) => {
          resizeWidth('right', width);
          resizeHeight(height);
        },
        active: (value) => {
          for (const node of [junction, $('split-right'), sash])
            node.classList.toggle('dragging', value);
          document.body.classList.toggle('resizing-both', value);
        },
        save: saveLayout,
        reset: () =>
          store.setState({ widths: { ...state().widths, right: 0.27 }, detailRatio: 0.68 }),
      }),
    );
    let drag: { y: number; height: number } | undefined;
    lifetime.listen(sash, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag = { y: event.clientY, height: $('files').getBoundingClientRect().height };
      sash.setPointerCapture(event.pointerId);
      sash.classList.add('dragging');
      document.body.classList.add('resizing-vertical');
      event.preventDefault();
    });
    lifetime.listen(sash, 'pointermove', (event: PointerEvent) => {
      if (drag) resizeHeight(drag.height + event.clientY - drag.y);
    });
    const end = () => {
      if (!drag) return;
      drag = undefined;
      sash.classList.remove('dragging');
      document.body.classList.remove('resizing-vertical');
      saveLayout();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
      lifetime.listen(sash, event, end);
    lifetime.listen(sash, 'keydown', (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') store.setState({ detailRatio: 0.68 });
      else
        resizeHeight(
          $('files').getBoundingClientRect().height + (event.key === 'ArrowDown' ? 10 : -10),
        );
      saveLayout();
    });
    lifetime.listen(sash, 'dblclick', () => {
      store.setState({ detailRatio: 0.68 });
      saveLayout();
    });
    for (const [element, update] of [
      [$('detail'), applyDetailSplit],
      [$('layout'), applyLayout],
    ] as const) {
      const observer = new ResizeObserver(update);
      observer.observe(element);
      lifetime.add(() => observer.disconnect());
    }
    lifetime.add(
      store.subscribe((next, previous) => {
        if (next.widths !== previous.widths || next.detailRatio !== previous.detailRatio)
          applyDetailLayout();
      }),
    );
    applyDetailLayout();
  }
  return {
    start,
    dispose() {},
    applyLayout,
    applyDetailSplit,
    applyDetailLayout,
    saveLayout,
    toggleBranches,
    toggleDetails,
  };
}
