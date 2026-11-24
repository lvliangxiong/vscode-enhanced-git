import { comparisonLabels } from '../../shared/comparison-labels';
import { flushSync } from 'react-dom';
import { remember } from '../../shared/filters';
import type { Branch, Commit, Stash } from '../../shared/model';
import type { LogContext } from './context';
import type { ActionMenuItem } from '../react/session-ui';
export interface BranchesController {
  start(): void;
  dispose(): void;
  selectedBranchDestination(): string | undefined;
  navigateSelectedBranch(): void;
  navigateStash(stash: Stash): void;
  branchRows(): HTMLElement[];
  selectBranch(value: string, event?: Partial<MouseEvent>, row?: HTMLElement): void;
  filterBranchFromTree(value: string, append?: boolean, row?: HTMLElement): void;
  copyBranchNames(targets?: Branch[]): void;
  branchKey(event: KeyboardEvent, button: HTMLElement): void;
  branchTargets(): Branch[];
  openBranchMenu(branch: Branch, x: number, y: number, row?: HTMLElement): void;
  openCommitMenu(commit: Commit, x: number, y: number): void;
  commitNeighbors(commit: Commit, parent: boolean): string[];
  navigateCommit(commit: Commit, parent: boolean, x: number, y: number): void;
  openCommitRefDialog(kind: 'branch' | 'tag', hash: string): void;
  requestDetails(): void;
  canCherryPick(): boolean;
  startCherryPick(): void;
}
export function createBranchesController(ctx: LogContext): BranchesController {
  const { store } = ctx;
  const state = store.getState;
  const { $, send } = ctx.env;
  function selectedBranchDestination(): string | undefined {
    if (state().selectedBranchRefs.size !== 1) return undefined;
    const value = [...state().selectedBranchRefs][0] as string;
    return value === 'HEAD' || state().branches.some((branch) => branch.ref === value)
      ? value
      : undefined;
  }
  function navigateSelectedBranch() {
    const destination = selectedBranchDestination();
    if (destination) ctx.actions.commits.navigateBranchHead(destination);
  }
  function branchRows() {
    return [
      $('all'),
      ...$('branches').querySelectorAll<HTMLElement>('button.branch:not(.stash-row)'),
    ].filter((row) => row.getClientRects().length);
  }
  function selectBranch(value, event: Partial<MouseEvent> = {}, row?: HTMLElement) {
    const rows = branchRows(),
      target = row || rows.find((item) => item.dataset.ref === value),
      chosen = new Set(state().selectedBranchRefs);
    const anchorRow =
      rows.find(
        (item) =>
          item.dataset.ref === state().branchAnchor &&
          item.dataset.location === state().branchAnchorLocation,
      ) || rows.find((item) => item.dataset.ref === state().branchAnchor);
    if (event.shiftKey && anchorRow && target) {
      if (!event.metaKey && !event.ctrlKey) chosen.clear();
      const a = rows.indexOf(anchorRow),
        b = rows.indexOf(target);
      rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((item) => {
        if (item.dataset.ref) chosen.add(item.dataset.ref);
      });
    } else if (event.metaKey || event.ctrlKey) {
      if (!chosen.delete(value)) chosen.add(value);
      store.setState({ branchAnchor: value });
      store.setState({ branchAnchorLocation: target?.dataset.location });
    } else {
      chosen.clear();
      chosen.add(value);
      store.setState({ branchAnchor: value });
      store.setState({ branchAnchorLocation: target?.dataset.location });
    }
    flushSync(() => store.setState({ selectedBranchRefs: chosen }));
    target?.focus();
  }
  function filterBranchFromTree(value, append = false, row) {
    if (value !== 'HEAD' && !state().branches.some((branch) => branch.ref === value)) return;
    selectBranch(value, {}, row);
    store.setState({
      ref: append
        ? [
            ...new Set([
              ...ctx.actions.history
                .refValues()
                .map(
                  (item) => state().branches.find((branch) => branch.name === item)?.ref || item,
                ),
              value,
            ]),
          ]
        : [value],
    });
    store.setState({
      filterRecents: {
        ...state().filterRecents,
        branch: remember(state().filterRecents.branch || [], state().ref as string[]),
      },
    });
    send('filterRecent', { kind: 'branch', values: state().ref });
    ctx.actions.filters.closeFilter();
    ctx.actions.history.applyFilters();
  }
  function copyBranchNames(targets = branchTargets()) {
    const names = targets.map((branch) =>
      branch.ref === 'HEAD'
        ? state().branches.find((item) => item.current)?.name || 'HEAD'
        : branch.name,
    );
    if (names.length) send('copyReference', { text: [...new Set(names)].join('\n') });
  }
  function branchKey(event, button) {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      ['KeyC', 'c', 'C'].includes(event.code || event.key) &&
      state().selectedBranchRefs.size
    ) {
      event.preventDefault();
      event.stopPropagation();
      copyBranchNames();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
      event.preventDefault();
      selectBranch(button.dataset.ref, event, button);
      return;
    }
    if ((event.metaKey && event.key === 'Backspace') || event.key === 'Delete') {
      event.preventDefault();
      const targets = branchTargets();
      if (
        targets.length &&
        !targets.some((b) => b.current || b.ref === 'HEAD' || b.group === 'Tags')
      )
        send('branchBatchAction', { refs: targets.map((b) => b.ref), action: 'delete' });
      return;
    }
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
    )
      return;
    event.preventDefault();
    const rows = branchRows(),
      i = rows.indexOf(button),
      next =
        rows[
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : Math.max(0, Math.min(rows.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))
        ];
    if (event.ctrlKey || event.metaKey) next?.focus();
    else if (next) selectBranch(next.dataset.ref, event, next);
  }
  function branchTargets() {
    return [...state().selectedBranchRefs]
      .map((value) =>
        value === 'HEAD'
          ? {
              ...state().branches.find((b) => b.current),
              ref: 'HEAD',
              name: 'HEAD',
              current: true,
              group: 'Local' as const,
            }
          : state().branches.find((b) => b.ref === value),
      )
      .filter((branch) => branch !== undefined);
  }
  function openBranchMenu(branch, x, y, row?: HTMLElement) {
    ctx.actions.toolbar.closeViewMenu();
    ctx.actions.filters.closeFilter();
    if (!state().selectedBranchRefs.has(branch.ref)) {
      store.setState({ selectedBranchRefs: new Set([branch.ref]) });
      store.setState({ branchAnchor: branch.ref });
      store.setState({ branchAnchorLocation: row?.dataset.location });
    }
    const targets = branchTargets();
    const items: ActionMenuItem[] = [];
    const canUpdate = ctx.actions.branchTools.branchToolState().update;
    function item(
      label: string,
      action: () => void,
      disabled = false,
      icon?: string,
      shortcut?: string,
    ) {
      items.push({ label, action, disabled, icon, shortcut });
    }
    if (targets.length > 1) {
      if (targets.length === 2) {
        const same =
          targets.some((b) => b.ref === 'HEAD') &&
          targets.some((b) => b.current && b.ref !== 'HEAD');
        item(
          comparisonLabels.history,
          () => send('branchCompare', { refs: targets.map((b) => b.ref) }),
          same,
          'diff',
        );
        item(
          comparisonLabels.files,
          () => send('branchFiles', { refs: targets.map((b) => b.ref) }),
          same,
          'fileDiff',
        );
      }
      item(
        'Update Selected',
        () => send('branchBatchAction', { refs: targets.map((b) => b.ref), action: 'update' }),
        !canUpdate,
        'checkOut',
      );
      item(
        'Delete Branches',
        () => send('branchBatchAction', { refs: targets.map((b) => b.ref), action: 'delete' }),
        targets.some((b) => b.current || b.group === 'Tags'),
        'gc',
        /Mac/.test(navigator.platform) ? '⌘⌫' : 'Delete',
      );
    } else {
      if (branch.ref === 'HEAD') branch = state().branches.find((b) => b.current) || branch;
      const actions =
        branch.group === 'Local'
          ? ['checkout', 'update', 'push', 'rename', 'delete']
          : branch.group === 'Tags'
            ? ['checkout', 'push', 'delete']
            : ['checkout', 'delete'];
      for (const action of actions)
        item(
          action[0].toUpperCase() + action.slice(1),
          () => send('branchAction', { ref: branch.ref, action }),
          (action === 'delete' && branch.current) || (action === 'update' && !canUpdate),
          action === 'delete' ? 'gc' : action === 'update' ? 'checkOut' : undefined,
        );
    }
    const kind = targets.every((target) => target.group === 'Tags') ? 'Tag' : 'Branch';
    item(
      `Copy ${kind} Name${targets.length > 1 ? 's' : ''}`,
      () => copyBranchNames(targets),
      !targets.length,
      'copy',
      /Mac/.test(navigator.platform) ? '⌘C' : 'Ctrl+C',
    );
    ctx.ui.openContextMenu({ items, point: { x, y } });
  }
  function openCommitMenu(commit, x, y) {
    ctx.actions.toolbar.closeViewMenu();
    ctx.actions.filters.closeFilter();
    if (!state().selected.has(commit.hash)) ctx.actions.commits.select(commit);
    const items: ActionMenuItem[] = [];
    const hashes = state()
      .commits.filter((c) => state().selected.has(c.hash))
      .map((c) => c.hash);
    const mac = /Mac/.test(navigator.platform),
      single = hashes.length === 1;
    function item(
      label: string,
      action: () => void,
      disabled = false,
      icon?: string,
      shortcut?: string,
    ) {
      items.push({ label, action, disabled, icon, shortcut });
    }
    const separator = () => items.push({ separator: true });
    item(
      'Copy Revision Number',
      () => send('commitAction', { action: 'copy', hashes }),
      false,
      'copy',
      mac ? '⌥⇧⌘C' : 'Ctrl+Alt+Shift+C',
    );
    item('Create Patch…', () => send('commitAction', { action: 'patch', hashes }), false, 'patch');
    item(
      state().cherryPickInProgress ? 'Continue / Skip / Abort Cherry-pick…' : 'Cherry-pick',
      startCherryPick,
      !canCherryPick(),
      'cherry',
    );
    if (hashes.length === 2) {
      separator();
      item(comparisonLabels.history, () => send('commitCompare', { hashes }), false, 'diff');
      // Rebased compares the lower selected row to the upper selected row.
      item(
        comparisonLabels.files,
        () => send('commitFiles', { hashes: [...hashes].reverse() }),
        false,
        'fileDiff',
      );
    }
    separator();
    item(
      comparisonLabels.filesWithWorkingTree,
      () => send('commitLocal', { hash: hashes[0] }),
      !single,
      'fileDiff',
    );
    separator();
    item(
      'New Branch…',
      () => openCommitRefDialog('branch', hashes[0]),
      !single,
      undefined,
      mac ? '⌥⌘N' : undefined,
    );
    item('New Tag…', () => openCommitRefDialog('tag', hashes[0]), !single);
    separator();
    item(
      'Go to Child Commit',
      () => navigateCommit(commit, false, x, y),
      !single || !commitNeighbors(commit, false).length,
      undefined,
      '←',
    );
    item(
      'Go to Parent Commit',
      () => navigateCommit(commit, true, x, y),
      !single || !commitNeighbors(commit, true).length,
      undefined,
      '→',
    );
    ctx.ui.openContextMenu({ items, point: { x, y } });
  }
  function commitNeighbors(commit, parent) {
    const parents = (c) => [
      ...new Set([...(c.graphParents ?? c.parents ?? []), ...(c.graphUnloadedParents || [])]),
    ];
    // Rebased navigates adjacent rows in the visible graph (including projected
    // ancestry when filters hide commits), with a chooser for multiple targets.
    return parent
      ? parents(commit).sort((a, b) => {
          const ai = state().commits.findIndex((c) => c.hash === a),
            bi = state().commits.findIndex((c) => c.hash === b);
          return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
        })
      : state()
          .commits.filter((c) => parents(c).includes(commit.hash))
          .map((c) => c.hash);
  }
  function navigateCommit(commit, parent, x, y) {
    const targets = commitNeighbors(commit, parent);
    const jump = (hash) =>
      ctx.actions.commits.jumpToCommit(
        hash,
        parent ? { source: commit.hash, parent: hash } : { source: hash, parent: commit.hash },
      );
    if (targets.length === 1) {
      jump(targets[0]);
      return;
    }
    if (!targets.length) return;
    const items: ActionMenuItem[] = targets.map((hash) => {
      const commit = state().commits.find((c) => c.hash === hash);
      const label = hash.slice(0, 8) + (commit ? ' ' + commit.subject + ' · ' + commit.author : '');
      return { label, title: label, action: () => jump(hash) };
    });
    ctx.ui.openContextMenu({
      items,
      point: { x, y },
      heading: parent ? 'Select Parent Commit' : 'Select Child Commit',
    });
  }
  function canCherryPick() {
    if (state().cherryPickBusy) return false;
    if (state().cherryPickInProgress) return true;
    const chosen = state().commits.filter((commit) => state().selected.has(commit.hash));
    return chosen.length > 0 && chosen.every((commit) => (commit.parents || []).length < 2);
  }
  function startCherryPick() {
    if (!canCherryPick()) return;
    store.setState({ cherryPickBusy: true });
    send('commitAction', {
      action: 'cherry-pick',
      hashes: state()
        .commits.filter((commit) => state().selected.has(commit.hash))
        .map((commit) => commit.hash),
    });
  }

  function openCommitRefDialog(kind: 'branch' | 'tag', hash: string) {
    ctx.ui.openRefDialog({
      kind,
      hash,
      onSubmit: (value) => send('commitAction', { action: kind, hashes: [hash], ...value }),
      onClose: () =>
        $('commits')
          .querySelector<HTMLElement>('.commit[aria-selected="true"]')
          ?.focus({ preventScroll: true }),
    });
  }
  function requestDetails() {
    ctx.actions.files.resetDetails();
    send('select', {
      hashes: state()
        .commits.filter((c) => state().selected.has(c.hash))
        .map((c) => c.hash),
      key: [...state().selected].join(','),
    });
  }
  return {
    start() {},
    dispose() {},
    selectedBranchDestination,
    navigateSelectedBranch,
    navigateStash(stash) {
      if (!state().stashes.some((item) => item.ref === stash.ref && item.hash === stash.hash))
        return;
      store.setState({
        selectedBranchRefs: new Set(),
        branchAnchor: undefined,
        branchAnchorLocation: undefined,
      });
      ctx.actions.commits.navigateToRevision(stash.hash);
    },
    branchRows,
    selectBranch,
    filterBranchFromTree,
    copyBranchNames,
    branchKey,
    branchTargets,
    openBranchMenu,
    openCommitMenu,
    commitNeighbors,
    navigateCommit,
    canCherryPick,
    startCherryPick,
    openCommitRefDialog,
    requestDetails,
  };
}
