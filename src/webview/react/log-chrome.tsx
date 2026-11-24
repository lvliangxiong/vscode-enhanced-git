import { comparisonLabels } from '../../shared/comparison-labels';
import { useLayoutEffect, type ReactNode } from 'react';
import type { LogContext } from '../log/context';
import type { LogState } from '../state/log';
import { branchValueLabel } from '../../shared/filters';
import type { ChromeButton, SessionSlots } from './session-types';
import { useUi, useSession, useSessionState } from './session-context';
function sessionButton(
  id: string,
  ctx: LogContext | null,
  state: LogState | undefined,
): ChromeButton | undefined {
  if (!ctx || !state) return;
  if (id === 'details-toggle' || id === 'details-expand')
    return {
      label: state.detailsCollapsed
        ? 'Show Files and Commit Details'
        : 'Hide Files and Commit Details',
      icon: state.detailsCollapsed ? 'left' : 'right',
      expanded: !state.detailsCollapsed,
      onClick: ctx.actions.layout.toggleDetails,
    };
  if (id === 'branches-toggle')
    return {
      label: state.branchesCollapsed ? 'Show Git Branches' : 'Hide Git Branches',
      icon: state.branchesCollapsed ? 'right' : 'left',
      expanded: !state.branchesCollapsed,
      onClick: ctx.actions.layout.toggleBranches,
    };
  if (id === 'branches-clear')
    return {
      hidden: !state.branchSearch,
      onClick: () => {
        ctx.store.setState({ branchSearch: '' });
        ctx.env.$('branchesSearch').focus();
      },
    };
  if (id === 'search-clear')
    return { hidden: !state.search, onClick: ctx.actions.history.clearSearch };
  if (id === 'graph-options') {
    const modified =
      state.graphSettings.sort !== 'date' || state.graphSettings.firstParent || state.hideMerges;
    return { label: modified ? 'Graph Options (modified)' : 'Graph Options', modified };
  }
  if (id === 'refresh')
    return {
      label: state.updatesAvailable ? 'Refresh (repository updates available)' : 'Refresh',
      outdated: state.updatesAvailable,
    };
  if (id === 'regex' || id === 'match-case')
    return {
      pressed: state.filterState[id === 'regex' ? 'regex' : 'matchCase'],
      onClick: () => ctx.actions.history.toggleSearchMode(id === 'regex' ? 'regex' : 'matchCase'),
    };
  if (id.startsWith('clear-'))
    return {
      hidden: !filterValue(id.slice(6), state),
      onClick: () => ctx.actions.filters.clearFilter(id.slice(6)),
    };
  if (id === 'branch-locate')
    return {
      disabled: !ctx.actions.branches.selectedBranchDestination(),
      onClick: ctx.actions.branches.navigateSelectedBranch,
    };
  if (id.startsWith('branch-')) {
    const action = id.slice(7),
      targets = ctx.actions.branchTools.branchToolTargets();
    const enabled = ctx.actions.branchTools.branchToolState()[action];
    if (enabled === undefined) return;
    const options: ChromeButton = {
      disabled: state.branchToolsBusy || !enabled,
      onClick: () => ctx.actions.branchTools.runBranchTool(action),
    };
    if (action === 'favorite') {
      const all = targets.length > 0 && targets.every((branch) => state.favorites.has(branch.ref));
      const any = targets.some((branch) => state.favorites.has(branch.ref));
      return {
        ...options,
        label: all ? 'Unmark as Favorite' : any ? 'Mark/Unmark as Favorite' : 'Mark as Favorite',
        active: all,
      };
    }
    if (action === 'expansion') {
      const expanded = ctx.actions.branchTools.branchTreeExpanded();
      return {
        ...options,
        label: expanded ? 'Collapse All' : 'Expand All',
        icon: expanded ? 'collapse' : 'expand',
      };
    }
    return options;
  }
}
function filterValue(kind: string, state: LogState | undefined) {
  if (!state) return '';
  const filters = state.filterState;
  if (kind === 'branch')
    return (Array.isArray(state.ref) ? state.ref : state.ref ? [state.ref] : [])
      .map((value) => branchValueLabel(value, state.branches))
      .join('|');
  if (kind === 'user') return filters.authors.join('|');
  if (kind === 'paths')
    return filters.paths[0]
      ? filters.paths[0] + (filters.paths.length > 1 ? ` +${filters.paths.length - 1}` : '')
      : '';
  if (kind === 'date')
    return filters.sinceHours
      ? filters.sinceHours === 24
        ? 'Last 24 hours'
        : 'Last 7 days'
      : [
          filters.since && `Since ${new Date(filters.since).toLocaleDateString()}`,
          filters.until && `Until ${new Date(filters.until).toLocaleDateString()}`,
        ]
          .filter(Boolean)
          .join(' · ');
  return '';
}
export function SearchInput({ branch = false }: { branch?: boolean }) {
  const ctx = useSession(),
    state = useSessionState(branch ? ['branchSearch'] : ['search']);
  return (
    <input
      id={branch ? 'branchesSearch' : 'search'}
      placeholder={branch ? 'Branch, tag or stash' : 'Text or hash'}
      aria-label={branch ? 'Search branches, tags or stashes' : 'Search commits'}
      value={branch ? (state?.branchSearch ?? '') : (state?.search ?? '')}
      onInput={(event) => {
        if (!ctx) return;
        const value = event.currentTarget.value;
        if (branch) ctx.store.setState({ branchSearch: value });
        else ctx.actions.history.setSearch(value);
      }}
      onChange={() => {}}
    />
  );
}
export function HeadBranch() {
  const ctx = useSession(),
    state = useSessionState(['branches', 'selectedBranchRefs', 'headLabel']);
  const current = state?.branches.find((branch) => branch.current);
  const label = current?.name || state?.headLabel;
  return (
    <button
      id="all"
      className={state?.selectedBranchRefs.has('HEAD') ? 'active' : ''}
      data-ref="HEAD"
      data-location="HEAD"
      title={label ? `HEAD (${label})` : 'HEAD'}
      aria-pressed={state?.selectedBranchRefs.has('HEAD')}
      onClick={(event) =>
        ctx?.actions.branches.selectBranch('HEAD', event.nativeEvent, event.currentTarget)
      }
      onDoubleClick={(event) =>
        ctx?.actions.branches.filterBranchFromTree(
          'HEAD',
          event.metaKey || event.ctrlKey,
          event.currentTarget,
        )
      }
      onContextMenu={(event) => {
        if (!ctx) return;
        event.preventDefault();
        ctx.actions.branches.openBranchMenu(
          { ...current, ref: 'HEAD', name: 'HEAD', group: 'Local', current: true },
          event.clientX,
          event.clientY,
          event.currentTarget,
        );
      }}
      onKeyDown={(event) => ctx?.actions.branches.branchKey(event.nativeEvent, event.currentTarget)}
    >
      HEAD (Current Branch)
    </button>
  );
}
export function MoreCommits() {
  const ctx = useSession(),
    state = useSessionState(['historyLoading', 'hasMoreHistory']);
  return (
    <button
      id="more"
      hidden={state?.hasMoreHistory === false}
      disabled={state?.historyLoading || state?.hasMoreHistory === false}
      onClick={() => {
        if (ctx) {
          ctx.store.setState({ autoLoadBlocked: false });
          ctx.actions.history.loadMore();
        }
      }}
    >
      Load more commits
    </button>
  );
}
export function Icon({ name }: { name: string }) {
  // Microsoft Codicons diff-multiple; see THIRD_PARTY_NOTICES.md.
  if (name === 'fileDiff')
    return (
      <svg className="file-diff-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M13 12V4.414C13 4.014 12.844 3.637 12.561 3.353L9.64602 0.439C9.36302 0.156 8.98602 0 8.58502 0H3.99902C2.89602 0 1.99902 0.897 1.99902 2V12C1.99902 13.103 2.89602 14 3.99902 14H10.999C12.102 14 12.999 13.103 12.999 12H13ZM3.00002 12V2C3.00002 1.449 3.44902 1 4.00002 1H8.58602C8.71702 1 8.84602 1.053 8.94002 1.146L11.854 4.06C11.947 4.153 12 4.282 12 4.414V12C12 12.551 11.551 13 11 13H4.00002C3.44902 13 3.00002 12.551 3.00002 12ZM15 6.41V12C15 14.21 13.21 16 11 16H6.00002C5.26002 16 4.62002 15.6 4.27002 15H11C12.65 15 14 13.65 14 12V4.79L14.56 5.35C14.84 5.64 15 6.01 15 6.41ZM10 5.499C10 5.775 9.77602 5.999 9.50002 5.999H8.00002V7.499C8.00002 7.775 7.77602 7.999 7.50002 7.999C7.22402 7.999 7.00002 7.775 7.00002 7.499V5.999H5.50002C5.22402 5.999 5.00002 5.775 5.00002 5.499C5.00002 5.223 5.22402 4.999 5.50002 4.999H7.00002V3.499C7.00002 3.223 7.22402 2.999 7.50002 2.999C7.77602 2.999 8.00002 3.223 8.00002 3.499V4.999H9.50002C9.77602 4.999 10 5.223 10 5.499ZM10 10.499C10 10.775 9.77602 10.999 9.50002 10.999H5.50002C5.22402 10.999 5.00002 10.775 5.00002 10.499C5.00002 10.223 5.22402 9.999 5.50002 9.999H9.50002C9.77602 9.999 10 10.223 10 10.499Z" />
      </svg>
    );
  return <span className={`rebased-icon rebased-${name}`} aria-hidden="true" />;
}
function buttonFields(id: string): readonly (keyof LogState)[] {
  if (id === 'details-toggle' || id === 'details-expand') return ['detailsCollapsed'];
  if (id.startsWith('branch-') || id === 'branches-toggle')
    return [
      'branches',
      'stashes',
      'selectedBranchRefs',
      'favorites',
      'treeOpen',
      'branchSearch',
      'branchToolsBusy',
      'repositoryRemotes',
      'branchesCollapsed',
    ];
  if (id === 'branches-clear') return ['branchSearch'];
  if (id === 'search-clear') return ['search'];
  if (id === 'graph-options') return ['graphSettings', 'hideMerges'];
  if (id === 'refresh') return ['updatesAvailable'];
  if (id === 'regex' || id === 'match-case') return ['filterState'];
  if (id.startsWith('clear-')) return ['ref', 'branches', 'filterState'];
  return [];
}
export function Button({
  id,
  label,
  icon,
  className = 'toolbar-icon',
  children,
  ...attributes
}: {
  id: string;
  label?: string;
  icon?: string;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  inert?: boolean;
  'aria-haspopup'?: 'menu' | 'dialog';
  'aria-controls'?: string;
  title?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
}) {
  const configured = useUi((snapshot) => snapshot.chrome.buttons[id]);
  const menuExpanded = useUi((snapshot) => {
    const menu =
      id === 'files-options'
        ? 'files-menu'
        : ['view-options', 'graph-options'].includes(id)
          ? 'view-menu'
          : null;
    return menu ? snapshot.menus[menu]?.anchor?.id === id : undefined;
  });
  const ctx = useSession(),
    session = useSessionState(buttonFields(id));
  const state = { ...configured, ...sessionButton(id, ctx, session) };
  const buttonIcon = state?.icon ?? icon;
  const title = state?.label ?? label ?? attributes.title;
  return (
    <button
      id={id}
      className={
        className +
        (state?.active ? ' is-favorite' : '') +
        (state?.modified ? ' has-modified-options' : '') +
        (state?.outdated ? ' history-outdated' : '')
      }
      {...attributes}
      title={title}
      aria-label={title}
      disabled={state?.disabled ?? attributes.disabled}
      hidden={state?.hidden ?? attributes.hidden}
      aria-expanded={menuExpanded ?? state?.expanded}
      aria-pressed={state?.pressed}
      onClick={state?.onClick ?? attributes.onClick}
    >
      {buttonIcon && <Icon name={buttonIcon} />}
      {children}
    </button>
  );
}
function FilterChip({ kind, label, inert }: { kind: string; label: string; inert?: boolean }) {
  const ctx = useSession(),
    state = useSessionState(['ref', 'branches', 'filterState']);
  const value = filterValue(kind, state);
  return (
    <div className="filter-chip" inert={inert}>
      <Button
        id={`filter-${kind}`}
        className={'filter-trigger' + (value ? ' filter-active' : '')}
        title={
          kind === 'paths'
            ? state?.filterState.paths.join('\n')
            : kind === 'user'
              ? state?.filterState.authors.join('\n')
              : kind === 'branch'
                ? (Array.isArray(state?.ref) ? state.ref : state?.ref ? [state.ref] : [])
                    .map((ref) => branchValueLabel(ref, state?.branches ?? []))
                    .join('\n')
                : value
        }
        aria-haspopup="menu"
        onClick={(event) => ctx?.actions.filters.openFilter(kind, event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            ctx?.actions.filters.openFilter(kind, event.currentTarget);
          }
        }}
      >
        <span>{label}</span>
        <span className="filter-value">{value ? `: ${value}` : ''}</span>
        <span className="chevron rebased-icon rebased-down" aria-hidden="true" />
      </Button>
      <Button id={`clear-${kind}`} className="filter-clear" label={`Clear ${label} filter`} hidden>
        ×
      </Button>
    </div>
  );
}
export function BranchRail() {
  return (
    <div className="branch-rail">
      <Button
        id="branches-toggle"
        className=""
        label="Hide Git Branches"
        icon="left"
        aria-controls="branch-content"
      >
        <span className="branch-stripe-label" aria-hidden="true">
          Branches
        </span>
      </Button>
      {(
        [
          ['new', 'New Branch…', 'add'],
          ['update', 'Update Selected', 'checkOut'],
          ['delete', 'Delete Branch', 'gc'],
          ['compare', comparisonLabels.historyWithCurrent, 'diff'],
          ['fetch', 'Fetch', 'fetch'],
          ['favorite', 'Mark as Favorite', 'star'],
          ['locate', 'Navigate Log to Selected Branch Head', 'locate'],
        ] as const
      ).map(([id, label, icon]) => (
        <Button key={id} id={`branch-${id}`} className="" label={label} icon={icon} disabled />
      ))}
      <div className="branch-rail-separator" role="separator" />
      <Button
        id="branch-expansion"
        className=""
        label="Collapse All"
        icon="collapse"
        aria-controls="branches"
        disabled
      />
    </div>
  );
}
export function HistoryToolbar() {
  const overflow = useUi((state) => state.chrome.overflow);
  const ctx = useSession();
  useLayoutEffect(() => {
    if (overflow.expanded && ctx) {
      ctx.actions.toolbar.positionOverflow();
      if (overflow.focusFirst)
        ctx.env.$('filter-strip').querySelector<HTMLElement>('button')?.focus();
    }
  }, [ctx, overflow.expanded, overflow.focusFirst]);
  const inert = (index: number) => !overflow.expanded && index >= overflow.visibleCount;
  return (
    <div className={'filters' + (overflow.collapsed ? ' filters-collapsed' : '')}>
      <div className="search-box commit-search">
        <span className="search-icon rebased-icon rebased-search" aria-hidden="true" />
        <SearchInput />
        <Button id="search-clear" className="search-clear" label="Clear search" hidden />
        <Button id="regex" className="search-option" label="Regex">
          .*
        </Button>
        <Button id="match-case" className="search-option" label="Match case">
          Cc
        </Button>
      </div>
      <div className="filter-viewport" id="filter-viewport" data-visible={overflow.visibleCount}>
        <div
          className={'filter-controls' + (overflow.expanded ? ' is-floating is-expanded' : '')}
          id="filter-strip"
        >
          <FilterChip kind="branch" label="Branch" inert={inert(0)} />
          <FilterChip kind="user" label="User" inert={inert(1)} />
          <FilterChip kind="date" label="Date" inert={inert(2)} />
          <FilterChip kind="paths" label="Paths" inert={inert(3)} />
          <Button
            id="graph-options"
            label="Graph Options"
            icon="graph"
            aria-haspopup="menu"
            inert={inert(4)}
          />
          <span className="toolbar-separator" inert={inert(5)} />
          <Button id="new-log-tab" label="Open Another Log Tab" icon="new-tab" inert={inert(6)} />
        </div>
      </div>
      <Button
        id="filter-overflow"
        className="toolbar-icon filter-overflow"
        label="More filters"
        icon="right"
        aria-controls="filter-strip"
        hidden={!overflow.collapsed}
      />
      <div className="log-actions">
        <Button id="refresh" label="Refresh" icon="refresh" />
        <Button id="cherry-pick" label="Cherry-pick selected commits" icon="cherry" />
        <Button id="view-options" label="View Options" icon="show" aria-haspopup="menu" />
        <Button id="go-to-ref" label="Go to Hash / Branch / Tag" icon="search" />
      </div>
    </div>
  );
}
export function Slot({ name }: { name: keyof SessionSlots }) {
  return useUi((state) => state.slots[name]) ?? null;
}
export function Footer() {
  const ctx = useSession(),
    state = useSessionState([
      'roots',
      'root',
      'commits',
      'selected',
      'historyLoading',
      'updatesAvailable',
    ]);
  const roots = state?.roots ?? [],
    repository = state?.root ?? '';
  const count = state
    ? `${state.commits.length} commits · ${state.selected.size} selected${state.historyLoading ? ' · Loading…' : ''}`
    : '';
  return (
    <footer>
      <select
        id="repo"
        aria-label="Repository"
        hidden={roots.length < 2}
        value={repository}
        title={repository}
        onChange={(event) => ctx?.actions.history.changeRepository(event.currentTarget.value)}
      >
        {roots.map((root) => (
          <option key={root} value={root} title={root}>
            {root.split(/[\\/]/).pop()}
          </option>
        ))}
      </select>
      <span id="status">
        <Slot name="status" />
        {ctx ? null : 'Loading repository…'}
      </span>
      <button
        className="history-updates"
        title="Repository history changed. Refresh while keeping filters and selection."
        hidden={!state?.updatesAvailable}
        onClick={() => ctx?.actions.history.load({ refresh: true })}
      >
        Updates available · Refresh
      </button>
      <span id="count">{count}</span>
    </footer>
  );
}
