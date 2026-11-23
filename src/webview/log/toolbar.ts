import { comparisonLabels } from '../../shared/comparison-labels';
import type { LogContext } from './context';
import type { ActionMenuItem } from '../react/session-ui';

/** Pure packing policy, shared by the toolbar's measured layout and tests. */
export function visibleFilterCount(widths: number[], budget: number, gap = 2) {
  let used = 2,
    count = 0;
  for (const width of widths) {
    const next = used + (count ? gap : 0) + width;
    if (next > budget) break;
    used = next;
    count++;
  }
  return { count, width: count ? used : 0 };
}

export function createToolbarController(ctx: LogContext) {
  const { $, document, window, layoutSheet, send, api } = ctx.env;
  const { lifetime, store, ui } = ctx;
  let filtersCollapsed = false,
    filtersExpanded = false;
  let visibleFilterControls = Infinity;
  let overflowFocus = false;
  function publishOverflow() {
    ui.patchChrome({
      overflow: {
        collapsed: filtersCollapsed,
        expanded: filtersExpanded,
        visibleCount: visibleFilterControls,
        focusFirst: overflowFocus,
      },
      buttons: {
        'filter-overflow': { ...baseButtons['filter-overflow'], expanded: filtersExpanded },
      },
    });
  }
  let overflowTimer: ReturnType<typeof setTimeout>;
  let strip: HTMLElement,
    toolbar: HTMLElement,
    viewport: HTMLElement,
    overflow: HTMLElement,
    rightTools: HTMLElement;
  const rule = (selector: string) => {
    const index = layoutSheet.insertRule(`${selector} {}`, layoutSheet.cssRules.length);
    return (layoutSheet.cssRules[index] as CSSStyleRule).style;
  };
  const overflowStyle = rule('#filter-strip.is-floating'),
    viewportStyle = rule('#filter-viewport');
  const closeViewMenu = (restore = false) => {
    ui.closeMenu('view-menu', restore);
  };
  const closeFilesMenu = (restore = false) => {
    ui.closeMenu('files-menu', restore);
  };
  function changeView(key: string) {
    const state = store.getState();
    store.setState({ viewSettings: { ...state.viewSettings, [key]: !state.viewSettings[key] } });
    ctx.actions.columns.saveView();
    if (key === 'notPicked' || key === 'signature') ctx.actions.history.load();
  }
  const viewOption = (key: string, label: string): ActionMenuItem => ({
    label,
    role: 'menuitemcheckbox',
    checked: Boolean(store.getState().viewSettings[key]),
    keepOpen: true,
    action: () => {
      changeView(key);
      if (ui.isMenuOpen('view-menu', $('view-options'))) renderViewMenu();
    },
  });
  function renderViewMenu() {
    ui.openMenu('view-menu', {
      label: 'View Options',
      anchor: $('view-options'),
      variant: 'view',
      items: [
        { heading: 'Show' },
        ...[
          ['compactRefs', 'Compact References View'],
          ['show-tags', 'Tag Names'],
          ['longEdges', 'Long Edges'],
          ['commitTimestamp', 'Commit Timestamp'],
          ['refsLeft', 'References on the Left'],
        ].map(([key, label]) => viewOption(key, label)),
        {
          label: 'Columns',
          children: Object.entries({
            author: 'Author',
            hash: 'Hash',
            date: 'Date',
            signature: 'GPG Signature',
          }).map(([key, label]) => viewOption(key, label)),
        },
        { heading: 'Highlight' },
        ...[
          ['highlight-me', 'My Commits'],
          ['highlight-merges', 'Merge Commits'],
          ['highlight-head', 'Current Branch'],
        ].map(([key, label]) => viewOption(key, label)),
        viewOption('notPicked', 'Not Cherry-Picked Commits'),
      ],
    });
  }
  function openViewMenu() {
    if (ui.isMenuOpen('view-menu', $('view-options'))) return closeViewMenu(true);
    ctx.actions.filters.closeFilter();
    ui.closeContextMenu();
    closeFilesMenu();
    renderViewMenu();
  }
  function openGraphOptions() {
    if (ui.isMenuOpen('view-menu', $('graph-options'))) return closeViewMenu(true);
    closeViewMenu();
    closeFilesMenu();
    ctx.actions.filters.closeFilter();
    ui.closeContextMenu();
    const state = store.getState();
    const option = (
      label: string,
      checked: boolean,
      role: ActionMenuItem['role'],
      action: () => void,
    ): ActionMenuItem => ({
      label,
      checked,
      role,
      action: () => {
        action();
        ctx.actions.history.saveGraphSettings();
        closeViewMenu(true);
        ctx.actions.history.applyFilters();
      },
    });
    ui.openMenu('view-menu', {
      label: 'Graph Options',
      anchor: $('graph-options'),
      variant: 'view',
      items: [
        { heading: 'Sort' },
        option('By Commit Date', state.graphSettings.sort === 'date', 'menuitemradio', () =>
          store.setState({ graphSettings: { ...store.getState().graphSettings, sort: 'date' } }),
        ),
        option('Topologically', state.graphSettings.sort === 'topological', 'menuitemradio', () =>
          store.setState({
            graphSettings: { ...store.getState().graphSettings, sort: 'topological' },
          }),
        ),
        { heading: 'Options' },
        option('First Parent', state.graphSettings.firstParent, 'menuitemcheckbox', () =>
          store.setState({
            graphSettings: {
              ...store.getState().graphSettings,
              firstParent: !store.getState().graphSettings.firstParent,
            },
          }),
        ),
        option('No Merges', state.hideMerges, 'menuitemcheckbox', () =>
          store.setState({ hideMerges: !store.getState().hideMerges }),
        ),
      ],
    });
  }
  function openFilesMenu() {
    if (ui.isMenuOpen('files-menu')) return closeFilesMenu(true);
    ctx.actions.filters.closeFilter();
    closeViewMenu();
    ui.closeContextMenu();
    const state = store.getState(),
      detail = ctx.actions.files.store.getState();
    const option = (label: string, checked: boolean, action: () => void): ActionMenuItem => ({
      label,
      checked,
      role: 'menuitemcheckbox',
      action: () => {
        action();
        closeFilesMenu(true);
      },
    });
    const items: ActionMenuItem[] = [
      { heading: 'Group By' },
      option('Directory', detail.directoryView, ctx.actions.files.toggleDirectory),
      option(
        'Show Changes to Parents',
        detail.showParentChanges,
        ctx.actions.files.toggleParentChanges,
      ),
      { heading: 'Layout' },
      option('Show Details', state.showDetails, () =>
        store.setState({ showDetails: !store.getState().showDetails }),
      ),
      option('Show Diff Preview', state.showPreview, () =>
        store.setState({ showPreview: !store.getState().showPreview }),
      ),
    ];
    if (state.showPreview)
      items.push({
        label: 'Diff Preview Location',
        children: (['bottom', 'right'] as const).map((key) => ({
          label: key === 'bottom' ? 'Bottom' : 'Right',
          checked: state.previewLocation === key,
          role: 'menuitemradio',
          action: () => {
            store.setState({ previewLocation: key });
            closeFilesMenu(true);
          },
        })),
      });
    ui.openMenu('files-menu', {
      label: 'File View Options',
      anchor: $('files-options'),
      variant: 'view',
      items,
    });
  }
  const baseButtons = {
    'view-options': { label: 'View Options', icon: 'show', onClick: openViewMenu },
    'files-options': { label: 'File View Options', icon: 'show', onClick: openFilesMenu },
    'graph-options': { label: 'Graph Options', icon: 'graph', onClick: openGraphOptions },
    'new-log-tab': {
      label: 'Open Another Log Tab',
      icon: 'new-tab',
      onClick: () => send('newTab'),
    },
    refresh: {
      label: 'Refresh',
      icon: 'refresh',
      onClick: () => ctx.actions.history.load({ refresh: true }),
    },
    'go-to-ref': {
      label: 'Go to Hash / Branch / Tag',
      icon: 'search',
      onClick: () => send('goTo', { requestId: store.getState().historyRequest }),
    },
    'files-expansion': {
      label: 'Collapse All',
      icon: 'collapse',
      onClick: () => {
        const state = ctx.actions.files.expansionState();
        if (state.enabled) ctx.actions.files.expandFileFolders(!state.expanded);
      },
    },
    'files-history': {
      label: 'History Up To Here',
      icon: 'history',
      onClick: () => ctx.actions.files.showHistory(),
    },
    'files-sidebar': {
      label: comparisonLabels.files,
      icon: 'fileDiff',
      onClick: () => ctx.actions.files.showInSidebar(),
    },
    'filter-overflow': { label: 'More filters', icon: 'right', onClick: () => showOverflow(true) },
  };
  function updateButtons() {
    const state = store.getState(),
      expansion = ctx.actions.files.expansionState();
    ui.patchChrome({
      buttons: {
        'files-history': {
          ...baseButtons['files-history'],
          disabled: !ctx.actions.files.canShowHistory(),
        },
        'files-sidebar': {
          ...baseButtons['files-sidebar'],
          disabled: !ctx.actions.files.canShowInSidebar(),
        },
        'cherry-pick': {
          label: state.cherryPickInProgress
            ? 'Continue / Skip / Abort Cherry-pick…'
            : 'Cherry-pick selected commits',
          icon: 'cherry',
          disabled: !ctx.actions.branches.canCherryPick(),
          onClick: ctx.actions.branches.startCherryPick,
        },
        'files-expansion': {
          ...baseButtons['files-expansion'],
          label: expansion.expanded ? 'Collapse All' : 'Expand All',
          icon: expansion.expanded ? 'collapse' : 'expand',
          disabled: !expansion.enabled,
        },
      },
    });
  }
  function positionOverflow() {
    if (!filtersCollapsed) return;
    const search = document.querySelector<HTMLElement>('.commit-search').getBoundingClientRect();
    overflowStyle.left = `${Math.max(8, Math.min(search.right + 4, window.innerWidth - strip.offsetWidth - 8))}px`;
    overflowStyle.top = `${search.top}px`;
    overflowStyle.height = `${search.height}px`;
    ctx.actions.filters.positionFilter();
  }
  function collapseOverflow() {
    clearTimeout(overflowTimer);
    filtersExpanded = false;
    overflowFocus = false;
    publishOverflow();
  }
  function hideOverflow(restore = false) {
    if (!strip) return;
    collapseOverflow();
    layoutFilterOverflow();
    if (restore) overflow.focus();
  }
  function showOverflow(focus = false) {
    if (!filtersCollapsed) return;
    clearTimeout(overflowTimer);
    filtersExpanded = true;
    overflowFocus = focus;
    publishOverflow();
  }
  function queueOverflowClose() {
    clearTimeout(overflowTimer);
    overflowTimer = setTimeout(() => {
      if (
        !$('filter-popup').hidden ||
        strip.matches(':hover') ||
        overflow.matches(':hover') ||
        strip.contains(document.activeElement)
      )
        return;
      hideOverflow();
    }, 220);
  }
  function layoutFilterOverflow() {
    if (!toolbar || toolbar.clientWidth <= 0) return;
    const toolbarStyle = getComputedStyle(toolbar),
      searchStyle = getComputedStyle(document.querySelector<HTMLElement>('.commit-search'));
    const gap = parseFloat(toolbarStyle.columnGap) || 0;
    const available =
      toolbar.clientWidth -
      parseFloat(toolbarStyle.paddingLeft) -
      parseFloat(toolbarStyle.paddingRight);
    const minSearch = parseFloat(searchStyle.minWidth) || 202;
    const controls = [...strip.children].filter(
      (node: HTMLElement) => !node.hidden,
    ) as HTMLElement[];
    const widths = controls.map((node) => {
      const style = getComputedStyle(node);
      return (
        node.getBoundingClientRect().width +
        (parseFloat(style.marginLeft) || 0) +
        (parseFloat(style.marginRight) || 0)
      );
    });
    if (
      !Number.isFinite(available) ||
      available <= 0 ||
      widths.some((width) => !Number.isFinite(width) || width <= 0)
    )
      return;
    const fullWidth = widths.reduce((a, b) => a + b, 2) + Math.max(0, widths.length - 1) * 2;
    const collapse = available < minSearch + fullWidth + rightTools.offsetWidth + gap * 2;
    const budget =
      available - minSearch - rightTools.offsetWidth - (collapse ? 22 + gap * 3 : gap * 2);
    let visible = visibleFilterCount(widths, budget);
    if (visible.count && controls[visible.count - 1].classList.contains('toolbar-separator'))
      visible = visibleFilterCount(widths.slice(0, visible.count - 1), budget);
    if (filtersCollapsed !== collapse || visibleFilterControls !== visible.count) {
      ctx.actions.filters.closeFilter();
      if (filtersExpanded) collapseOverflow();
    }
    const changed = filtersCollapsed !== collapse || visibleFilterControls !== visible.count;
    filtersCollapsed = collapse;
    visibleFilterControls = visible.count;
    viewportStyle.width = `${collapse ? visible.width : fullWidth}px`;
    if (changed) publishOverflow();
    if (filtersExpanded) positionOverflow();
  }
  function start() {
    toolbar = document.querySelector('.filters');
    strip = $('filter-strip');
    viewport = $('filter-viewport');
    overflow = $('filter-overflow');
    rightTools = document.querySelector('.log-actions');
    ui.patchChrome({ buttons: baseButtons });
    updateButtons();
    lifetime.add(
      store.subscribe((next, prev) => {
        if (
          next.selected !== prev.selected ||
          next.commits !== prev.commits ||
          next.cherryPickBusy !== prev.cherryPickBusy ||
          next.cherryPickInProgress !== prev.cherryPickInProgress
        )
          updateButtons();
        if (
          next.showDetails !== prev.showDetails ||
          next.showPreview !== prev.showPreview ||
          next.previewLocation !== prev.previewLocation
        )
          api.setState({
            ...api.getState(),
            showDetails: next.showDetails,
            showPreview: next.showPreview,
            previewLocation: next.previewLocation,
          });
      }),
    );
    lifetime.add(ctx.actions.files.store.subscribe(updateButtons));
    lifetime.listen(overflow, 'pointerenter', () => showOverflow());
    lifetime.listen(overflow, 'keydown', (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        showOverflow(true);
      }
    });
    for (const target of [overflow, strip, $('filter-popup')]) {
      lifetime.listen(target, 'pointerenter', () => clearTimeout(overflowTimer));
      lifetime.listen(target, 'pointerleave', queueOverflowClose);
      lifetime.listen(target, 'focusout', queueOverflowClose);
    }
    lifetime.listen(document, 'pointerdown', (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!$('branch-menu').contains(target)) ui.closeContextMenu();
      if (
        !$('view-menu').contains(target) &&
        !$('view-options').contains(target) &&
        !$('graph-options').contains(target)
      )
        closeViewMenu();
      if (!$('files-menu').contains(target) && !$('files-options').contains(target))
        closeFilesMenu();
      if (
        filtersExpanded &&
        !strip.contains(target) &&
        !overflow.contains(target) &&
        !$('filter-popup').contains(target)
      ) {
        ctx.actions.filters.closeFilter();
        hideOverflow();
      }
    });
    lifetime.listen(document, 'keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      ui.closeContextMenu();
      if (filtersExpanded && $('filter-popup').hidden) hideOverflow(true);
    });
    const observer = new ResizeObserver(() => {
      layoutFilterOverflow();
      ctx.actions.filters.positionFilter();
    });
    observer.observe(toolbar);
    observer.observe(strip);
    observer.observe($('history'));
    for (const control of strip.children) observer.observe(control);
    lifetime.add(() => observer.disconnect());
    lifetime.listen(document, 'visibilitychange', () => {
      if (!document.hidden) layoutFilterOverflow();
    });
    for (const event of ['resize', 'focus']) lifetime.listen(window, event, layoutFilterOverflow);
    lifetime.listen(window, 'resize', () => {
      closeViewMenu();
      closeFilesMenu();
    });
    document.fonts?.ready.then(() => {
      if (!lifetime.disposed) layoutFilterOverflow();
    });
    layoutFilterOverflow();
  }
  function dispose() {
    clearTimeout(overflowTimer);
  }
  return {
    start,
    dispose,
    closeViewMenu,
    closeFilesMenu,
    openGraphOptions,
    layoutFilterOverflow,
    syncFilterOverflow: layoutFilterOverflow,
    positionOverflow,
    hideOverflow,
  };
}
