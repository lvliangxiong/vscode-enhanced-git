import type { LogContext } from './context';

/** One themed, accessible tooltip surface is shared by the log toolbars. */
export function installToolbarTooltips(ctx: LogContext) {
  const { $, document, window, layoutSheet } = ctx.env;
  const { ui, lifetime } = ctx;
  const selector =
    '.branch-rail button, .branch-toolbar button, .filters button:not(.filter-trigger), #filter-strip button:not(.filter-trigger), .detail-toolbar button';
  const roots = document.querySelectorAll(
    '.branch-rail, .branch-toolbar, .filters, #filter-strip, .detail-toolbar',
  );
  const popup = $('toolbar-tooltip');
  const rule = layoutSheet.insertRule('#toolbar-tooltip {}', layoutSheet.cssRules.length);
  const style = (layoutSheet.cssRules[rule] as CSSStyleRule).style;
  let target: HTMLElement | undefined, timer: ReturnType<typeof setTimeout>;
  function label(button: HTMLElement) {
    const title = button.getAttribute('title');
    if (title !== null) {
      button.dataset.toolbarTooltip = title;
      button.removeAttribute('title');
    }
    return button.getAttribute('aria-label') || button.dataset.toolbarTooltip || '';
  }
  function hide() {
    clearTimeout(timer);
    if (target) {
      const ids = (target.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== popup.id);
      if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
      else target.removeAttribute('aria-describedby');
    }
    target = undefined;
    ui.hideHover('toolbar-tooltip');
  }
  function show() {
    if (!target?.isConnected || !target.getClientRects().length || document.hidden) return hide();
    const text = label(target);
    if (!text) return hide();
    const anchor = target;
    ui.showHover('toolbar-tooltip', {
      kind: 'toolbar',
      text,
      onMount(element) {
        if (target !== anchor || !target?.isConnected) return hide();
        const ids = new Set(
          (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
        );
        ids.add(popup.id);
        target.setAttribute('aria-describedby', [...ids].join(' '));
        const rect = target.getBoundingClientRect(),
          rail = target.closest('.branch-rail'),
          gap = 6;
        let left = rail ? rect.right + gap : rect.left,
          top = rail ? rect.top : rect.bottom + gap;
        if (rail && left + element.offsetWidth > window.innerWidth - 8)
          left = rect.left - element.offsetWidth - gap;
        if (!rail && top + element.offsetHeight > window.innerHeight - 8)
          top = rect.top - element.offsetHeight - gap;
        style.left = `${Math.max(8, Math.min(left, window.innerWidth - element.offsetWidth - 8))}px`;
        style.top = `${Math.max(8, Math.min(top, window.innerHeight - element.offsetHeight - 8))}px`;
      },
    });
  }
  function find(element: EventTarget | null) {
    const button = (element as Element)?.closest?.<HTMLElement>(selector);
    return button && !button.closest('[inert]') ? button : undefined;
  }
  function schedule(button: HTMLElement | undefined) {
    if (button === target) return;
    hide();
    if (!button || !label(button)) return;
    target = button;
    timer = setTimeout(show, 350);
  }
  lifetime.listen(
    document,
    'pointerover',
    (event: PointerEvent) => schedule(find(event.target)),
    true,
  );
  lifetime.listen(
    document,
    'pointerout',
    (event: PointerEvent) => {
      if (target && find(event.relatedTarget) !== target) hide();
    },
    true,
  );
  lifetime.listen(document, 'focusin', (event: FocusEvent) => {
    const button = find(event.target);
    if (button?.matches(':focus-visible')) schedule(button);
  });
  lifetime.listen(document, 'focusout', hide);
  for (const type of ['pointerdown', 'scroll']) lifetime.listen(document, type, hide, true);
  lifetime.listen(document, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  });
  lifetime.listen(document, 'visibilitychange', hide);
  for (const type of ['blur', 'resize', 'vsgitHidden']) lifetime.listen(window, type, hide);
  const sync = () => {
    for (const root of roots)
      for (const button of root.querySelectorAll<HTMLElement>('button'))
        if (button.matches(selector)) label(button);
    if (target && (!target.isConnected || !target.getClientRects().length)) hide();
    else if (target && !popup.hidden) show();
  };
  sync();
  const observer = new MutationObserver(sync);
  for (const root of roots)
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'hidden'],
    });
  lifetime.add(() => {
    observer.disconnect();
    clearTimeout(timer);
  });
}
