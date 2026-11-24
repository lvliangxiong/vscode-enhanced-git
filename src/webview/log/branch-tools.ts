import type { Branch } from '../../shared/model';
import type { LogContext } from './context';

export interface BranchToolsController {
  start(): void;
  dispose(): void;
  branchToolTargets(): Branch[];
  branchTreeExpanded(): boolean;
  branchToolState(): Record<string, boolean>;
  runBranchTool(action: string): void;
  toggleBranchFavorites(refs: string[]): void;
}
export function createBranchToolsController(ctx: LogContext): BranchToolsController {
  const state = ctx.store.getState;
  const branchToolTargets = () => ctx.actions.branches.branchTargets();
  function branchTreeExpanded() {
    const snapshot = state(),
      query = snapshot.branchSearch.toLowerCase().trim();
    const groups = (['Local', 'Remote', 'Tags', 'Stashes'] as const).filter((group) =>
      group === 'Stashes'
        ? snapshot.stashes.some((stash) =>
            `${stash.ref} ${stash.subject}`.toLowerCase().includes(query),
          )
        : snapshot.branches.some(
            (branch) =>
              branch.group === group && (!query || branch.name.toLowerCase().includes(query)),
          ),
    );
    return groups.some((group) => query || (snapshot.treeOpen.get(group) ?? group !== 'Tags'));
  }
  function branchToolState() {
    const targets = branchToolTargets();
    const refsOnly = targets.length > 0 && targets.every((branch) => branch.ref !== 'HEAD');
    return {
      new: targets.length === 1 && targets[0].group !== 'Tags',
      // List metadata can be stale. Read tracking configuration at execution time,
      // and allow fetching even when no incoming commits are currently known.
      update:
        targets.length > 0 &&
        targets.every(
          (branch) =>
            branch.group === 'Local' &&
            (branch.ref !== 'HEAD' || state().branches.some((candidate) => candidate.current)),
        ),
      delete: refsOnly && targets.every((branch) => !branch.current),
      compare:
        refsOnly &&
        state().branches.some((branch) => branch.current) &&
        targets.some((branch) => !branch.current),
      fetch: state().repositoryRemotes.length > 0,
      favorite: refsOnly,
      expansion: state().branches.length > 0 || state().stashes.length > 0,
    };
  }
  function toggleBranchFavorites(refs: string[]) {
    ctx.env.send('favorites', ctx.branchState.toggle(refs));
  }
  function runBranchTool(action: string) {
    if (state().branchToolsBusy || !branchToolState()[action]) return;
    const targets = branchToolTargets();
    if (action === 'favorite') return toggleBranchFavorites(targets.map((branch) => branch.ref));
    if (action === 'expansion') {
      const open = !branchTreeExpanded();
      const treeOpen = new Map(state().treeOpen);
      for (const group of ctx.env.$('branches').querySelectorAll<HTMLDetailsElement>('details'))
        treeOpen.set(group.dataset.key!, open);
      ctx.store.setState({ treeOpen });
      return;
    }
    if (action === 'compare') {
      ctx.env.send('branchCompareCurrent', {
        refs: targets.filter((branch) => !branch.current).map((branch) => branch.ref),
      });
      return;
    }
    ctx.store.setState({ branchToolsBusy: true });
    if (action === 'update' || action === 'delete') {
      const refs = targets.map((branch) =>
        action === 'update' && branch.ref === 'HEAD'
          ? state().branches.find((candidate) => candidate.current)!.ref
          : branch.ref,
      );
      ctx.env.send('branchBatchAction', { action, refs: [...new Set(refs)], toolbar: true });
    } else ctx.env.send('branchTool', { action, ref: targets[0]?.ref, toolbar: true });
  }
  return {
    start() {},
    dispose() {},
    branchToolTargets,
    branchTreeExpanded,
    branchToolState,
    runBranchTool,
    toggleBranchFavorites,
  };
}
