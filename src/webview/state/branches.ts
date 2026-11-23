import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Branch, Stash } from '../../shared/model';

export interface FavoriteChange {
  ref: string;
  marked: boolean;
}
export interface BranchSnapshot {
  headLabel?: string;
  branches?: Branch[];
  stashes?: Stash[];
  repositoryVersion?: number;
  branchSnapshotKey?: string;
  favorites?: string[] | null;
  favoriteVersion?: number;
  favoriteAck?: number;
}
export interface BranchState {
  headLabel?: string;
  branches: Branch[];
  stashes: Stash[];
  favorites: ReadonlySet<string>;
  repositoryVersion: number;
  snapshotKey?: string;
}
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((value) => b.has(value));

/** One per Log session. Host revisions synchronize persisted favorites across views. */
export function createBranchState(parent?: StoreApi<BranchState>) {
  const store =
    parent ??
    createStore<BranchState>(() => ({
      branches: [],
      stashes: [],
      favorites: new Set(),
      repositoryVersion: -1,
    }));
  let favoriteVersion = -1,
    nextRequest = 0;
  let saved: ReadonlySet<string> | undefined;
  const pending = new Map<number, FavoriteChange[]>();
  function favorites(data: BranchSnapshot, branches: Branch[]) {
    if ('favorites' in data && (data.favoriteVersion ?? 0) >= favoriteVersion) {
      favoriteVersion = data.favoriteVersion ?? 0;
      saved = new Set(
        data.favorites ??
          branches
            .filter((branch) => /^(master|main)$/.test(branch.name.split('/').pop()!))
            .map((branch) => branch.ref),
      );
    }
    if (data.favoriteAck !== undefined)
      for (const request of pending.keys())
        if (request <= data.favoriteAck) pending.delete(request);
    const next = new Set(saved ?? store.getState().favorites);
    for (const changes of pending.values())
      for (const { ref, marked } of changes) {
        if (marked) next.add(ref);
        else next.delete(ref);
      }
    return sameSet(next, store.getState().favorites) ? store.getState().favorites : next;
  }
  return {
    ...store,
    applyFavorites(data: BranchSnapshot) {
      const current = store.getState();
      const next = favorites(data, current.branches);
      if (next === current.favorites) return false;
      store.setState({ favorites: next });
      return true;
    },
    applySnapshot(data: BranchSnapshot) {
      const current = store.getState();
      const version = data.repositoryVersion ?? 0;
      if (version < current.repositoryVersion) return false;
      const branches =
        data.branches === undefined ||
        JSON.stringify(data.branches) === JSON.stringify(current.branches)
          ? current.branches
          : data.branches;
      const stashes =
        data.stashes === undefined ||
        JSON.stringify(data.stashes) === JSON.stringify(current.stashes)
          ? current.stashes
          : data.stashes;
      const nextFavorites = favorites(data, branches);
      const headLabel = data.headLabel ?? current.headLabel;
      const changed =
        branches !== current.branches ||
        stashes !== current.stashes ||
        nextFavorites !== current.favorites ||
        headLabel !== current.headLabel;
      store.setState({
        headLabel,
        branches,
        stashes,
        favorites: nextFavorites,
        repositoryVersion: version,
        snapshotKey: data.branchSnapshotKey,
      });
      return changed;
    },
    toggle(refs: string[]) {
      const current = store.getState();
      saved ??= current.favorites;
      const changes = [...new Set(refs)].map((ref) => ({
        ref,
        marked: !current.favorites.has(ref),
      }));
      const favoriteRequest = ++nextRequest;
      pending.set(favoriteRequest, changes);
      const next = favorites({}, current.branches);
      if (next !== current.favorites) store.setState({ favorites: next });
      return { changes, favoriteRequest };
    },
    /** A new init handshake invalidates only the history revision guard. */
    invalidateSnapshot() {
      store.setState({ repositoryVersion: -1 });
    },
    /** A repository switch isolates both saved and pending UI state until its reply. */
    reset() {
      favoriteVersion = -1;
      saved = undefined;
      pending.clear();
      store.setState({
        branches: [],
        stashes: [],
        favorites: new Set(),
        repositoryVersion: -1,
        snapshotKey: undefined,
      });
    },
  };
}
