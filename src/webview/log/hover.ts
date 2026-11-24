import type { LogContext } from './context';
import { installToolbarTooltips } from './tooltips';

/** Pointer geometry is imperative; popup contents and lifetime belong to the React root. */
export function installCommitHover(
  ctx: LogContext,
  list: HTMLElement,
  branchList: boolean | 'recent' = false,
) {
  const { $, document, window, layoutSheet, send } = ctx.env;
  const { lifetime, ui } = ctx;
  const id =
    branchList === 'recent' ? 'recent-hover' : branchList ? 'branch-hover' : 'commit-hover';
  const popup = $(id);
  const rule = layoutSheet.insertRule(`#${id} {}`, layoutSheet.cssRules.length);
  const style = (layoutSheet.cssRules[rule] as CSSStyleRule).style;
  let target: HTMLElement | undefined,
    timer: ReturnType<typeof setTimeout>,
    leaveTimer: ReturnType<typeof setTimeout>;
  const recent = branchList === 'recent';
  const findTarget = (element: Element) =>
    element?.closest
      ? recent
        ? element.closest('.filter-menu-item')?.querySelector<HTMLElement>('.recent-label')
        : branchList
          ? element.closest('button.branch')?.querySelector<HTMLElement>('.branch-label')
          : element.closest<HTMLElement>(
              '.graph-jump, .refs, .subject-text:not([data-shared-hover])',
            )
      : undefined;
  const hide = () => {
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    target?.removeAttribute('aria-describedby');
    target = undefined;
    ui.hideHover(id);
  };
  const show = () => {
    if (!target?.isConnected || list.hidden) return hide();
    const anchorTarget = target;
    const jump = target.classList.contains('graph-jump');
    const refs = jump || branchList || target.classList.contains('refs');
    if ((!refs || branchList === true) && target.scrollWidth <= target.clientWidth) return hide();
    const names: string[] =
      !jump && refs
        ? branchList && !recent
          ? [target.closest<HTMLElement>('button.branch').dataset.fullName]
          : JSON.parse(target.dataset.references)
        : [];
    const font = getComputedStyle(target);
    style.font = font.font;
    style.color = target.dataset.referenceLabels ? '' : font.color;
    ui.showHover(id, {
      kind: jump ? 'jump' : refs ? 'refs' : 'message',
      names,
      references: target.dataset.referenceLabels
        ? JSON.parse(target.dataset.referenceLabels)
        : undefined,
      text: jump ? target.getAttribute('aria-label') : target.textContent,
      copy: (name) => send('copyReference', { text: name }),
      onMount(element) {
        if (target !== anchorTarget || !target?.isConnected) return hide();
        target.setAttribute('aria-describedby', id);
        const rect = target.getBoundingClientRect();
        style.maxWidth = `${Math.max(0, Math.min(jump ? 480 : Infinity, window.innerWidth - 16))}px`;
        style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
        let left = rect.left - (refs ? 4 : 5),
          top = refs ? rect.bottom + 3 : rect.top - 3;
        if (refs && !target.dataset.referenceLabels) {
          const anchor = recent
            ? (target.closest<HTMLElement>('[role="menu"]') || list).getBoundingClientRect()
            : rect;
          const gap = 6,
            width = element.offsetWidth;
          if (anchor.right + gap + width <= window.innerWidth - 8) {
            left = anchor.right + gap;
            top = rect.top;
          } else if (anchor.left - gap - width >= 8) {
            left = anchor.left - gap - width;
            top = rect.top;
          } else if (top + element.offsetHeight > window.innerHeight - 8)
            top = rect.top - element.offsetHeight - gap;
        }
        if (target.dataset.referenceLabels) {
          left = rect.left;
          top = rect.bottom + 8;
          const above = top + element.offsetHeight > window.innerHeight - 8;
          if (above) top = rect.top - element.offsetHeight - 8;
          element.dataset.placement = above ? 'above' : 'below';
        }
        style.left = `${Math.max(8, Math.min(left, window.innerWidth - element.offsetWidth - 8))}px`;
        style.top = `${Math.max(8, Math.min(top, window.innerHeight - element.offsetHeight - 8))}px`;
      },
    });
  };
  lifetime.listen(list, 'pointerover', (event: PointerEvent) => {
    clearTimeout(leaveTimer);
    const next = findTarget(event.target as Element);
    if (!next || next === target) return;
    hide();
    target = next;
    timer = setTimeout(show, 150);
  });
  lifetime.listen(list, 'focusin', (event: FocusEvent) => {
    const next = findTarget(event.target as Element);
    hide();
    if (next) {
      target = next;
      timer = setTimeout(show, 150);
    }
  });
  lifetime.listen(list, 'focusout', (event: FocusEvent) => {
    if (!popup.contains(event.relatedTarget as Node)) hide();
  });
  const leave = (event: PointerEvent) => {
    if (
      target?.contains(event.relatedTarget as Node) ||
      popup.contains(event.relatedTarget as Node)
    )
      return;
    clearTimeout(timer);
    leaveTimer = setTimeout(hide, 100);
  };
  lifetime.listen(popup, 'pointerenter', () => clearTimeout(leaveTimer));
  lifetime.listen(popup, 'pointerdown', (event: PointerEvent) => {
    if (popup.classList.contains('refs-hover')) {
      clearTimeout(leaveTimer);
      event.stopPropagation();
    }
  });
  lifetime.listen(list, 'pointerout', leave);
  lifetime.listen(popup, 'pointerout', leave);
  for (const type of ['click', 'contextmenu'])
    lifetime.listen(popup, type, (event: MouseEvent) => {
      if (!target || popup.classList.contains('refs-hover')) return;
      event.preventDefault();
      const anchor = target;
      hide();
      anchor.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          button: event.button,
        }),
      );
    });
  for (const type of ['pointerdown', 'scroll'])
    lifetime.listen(
      document,
      type,
      (event) => {
        if (!popup.contains(event.target as Node)) hide();
      },
      true,
    );
  lifetime.listen(document, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  });
  for (const type of ['blur', 'resize', 'vsCodeGitHidden']) lifetime.listen(window, type, hide);
  const resize = new ResizeObserver(hide);
  resize.observe(list);
  lifetime.add(() => resize.disconnect());
  const mutation = new MutationObserver(() => {
    if (target && (!target.isConnected || list.hidden)) hide();
  });
  mutation.observe(list, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  lifetime.add(() => mutation.disconnect());
  lifetime.add(() => {
    clearTimeout(timer);
    clearTimeout(leaveTimer);
  });
}
export function installGraphHover(ctx: LogContext, list: HTMLElement) {
  const { lifetime } = ctx,
    { window } = ctx.env;
  const update = (color?: number, arrow?: Element) => ctx.actions.graph.setHover(color, arrow);
  lifetime.listen(list, 'pointermove', (event: PointerEvent) => {
    const target = event.target as Element,
      arrow = target.closest('.graph-jump');
    if (arrow && list.contains(arrow)) {
      update(undefined, arrow);
      return;
    }
    const cell = target.closest<HTMLElement>('.graph-cell');
    if (!cell) {
      update();
      return;
    }
    const rect = cell.getBoundingClientRect();
    update(ctx.actions.graph.hitCell(cell, event.clientX - rect.left, event.clientY - rect.top));
  });
  lifetime.listen(list, 'pointerleave', () => update());
  lifetime.listen(list, 'focusin', (event: FocusEvent) =>
    update(undefined, (event.target as Element).closest('.graph-jump') || undefined),
  );
  lifetime.listen(list, 'focusout', () => update());
  lifetime.listen(list, 'scroll', () => update(), { passive: true });
  for (const type of ['blur', 'vsCodeGitHidden']) lifetime.listen(window, type, () => update());
}
export function createHoverController(ctx: LogContext) {
  function closeTransientUi() {
    ctx.actions.columns.cancelDrag();
    ctx.actions.filters.closeFilter();
    ctx.actions.toolbar.closeViewMenu();
    ctx.actions.toolbar.closeFilesMenu();
    ctx.actions.toolbar.hideOverflow();
    ctx.ui.closeContextMenu();
    ctx.env.window.dispatchEvent(new Event('vsCodeGitHidden'));
  }
  function start() {
    const { $ } = ctx.env;
    installCommitHover(ctx, $('commits'));
    installCommitHover(ctx, $('branches'), true);
    installCommitHover(ctx, $('filter-popup'), 'recent');
    installGraphHover(ctx, $('commits'));
    installToolbarTooltips(ctx);
    ctx.lifetime.listen(ctx.env.document, 'visibilitychange', () => {
      if (ctx.env.document.hidden) closeTransientUi();
    });
  }
  return { start, dispose() {}, closeTransientUi };
}
