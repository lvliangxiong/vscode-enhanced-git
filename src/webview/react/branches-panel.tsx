import { Component, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { BranchTree } from './branch-tree';
import type { LogContext } from '../log/context';

interface FocusSnapshot {
  active: HTMLElement;
  ref?: string;
  location?: string;
  scroll: number;
  scrollLeft: number;
}

/** Preserve focus and scroll when marking a branch moves it into or out of a folder. */
class PreserveBranchFocus extends Component<
  { ctx: LogContext; children: ReactNode },
  {},
  FocusSnapshot
> {
  getSnapshotBeforeUpdate(): FocusSnapshot {
    const { document, $ } = this.props.ctx.env;
    const active = document.activeElement as HTMLElement;
    return {
      active,
      ref: active?.dataset.ref,
      location: active?.dataset.location,
      scroll: $('branches').scrollTop,
      scrollLeft: $('branches').scrollLeft,
    };
  }
  componentDidUpdate(_props: unknown, _state: unknown, snapshot: FocusSnapshot) {
    const { ctx } = this.props;
    if (
      ctx.store.getState().visible &&
      !ctx.env.document.hidden &&
      snapshot.ref &&
      !snapshot.active.isConnected
    ) {
      const rows = ctx.actions.branches.branchRows();
      const row =
        rows.find(
          (row) => row.dataset.ref === snapshot.ref && row.dataset.location === snapshot.location,
        ) || rows.find((row) => row.dataset.ref === snapshot.ref);
      row?.focus({ preventScroll: true });
    }
    ctx.env.$('branches').scrollTop = snapshot.scroll;
    ctx.env.$('branches').scrollLeft = snapshot.scrollLeft;
  }
  render() {
    return this.props.children;
  }
}

/** Selection, filtering and favorites are projections of the same session store. */
export function BranchesContent({ ctx }: { ctx: LogContext }) {
  const model = useStore(
    ctx.store,
    useShallow((state) => ({
      branches: state.branches,
      headLabel: state.headLabel,
      stashes: state.stashes,
      selectedHashes: state.selected,
      favorites: state.favorites,
      selectedRefs: state.selectedBranchRefs,
      openGroups: state.treeOpen,
      query: state.branchSearch.toLowerCase().trim(),
    })),
  );
  const callbacks = useMemo(
    () => ({
      onSelect: ctx.actions.branches.selectBranch,
      onStashActivate: ctx.actions.branches.navigateStash,
      onActivate: ctx.actions.branches.filterBranchFromTree,
      onContextMenu: ctx.actions.branches.openBranchMenu,
      onKeyDown: ctx.actions.branches.branchKey,
      onToggle(key: string, open: boolean) {
        const current = ctx.store.getState().treeOpen;
        if (current.get(key) === open) return;
        ctx.store.setState({ treeOpen: new Map(current).set(key, open) });
      },
    }),
    [ctx],
  );
  return (
    <PreserveBranchFocus ctx={ctx}>
      <BranchTree {...model} {...callbacks} />
    </PreserveBranchFocus>
  );
}
