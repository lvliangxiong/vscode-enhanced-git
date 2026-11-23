import type { Memento } from 'vscode';
import { refs } from '../git/refs';
import { repositoryKey } from './events';

export function createRepositoryFavorites(state: Memento) {
  const snapshots = new Map<string, { favorites: string[] | null; favoriteVersion: number }>();
  const listeners = new Set<(root: string, snapshot: ReturnType<typeof get>) => void>();
  const queues = new Map<string, Promise<unknown>>();
  function get(root: string) {
    const key = repositoryKey(root);
    if (!snapshots.has(key))
      snapshots.set(key, {
        favorites: state.get<string[]>(`favorites:${root}`, null),
        favoriteVersion: 0,
      });
    return snapshots.get(key);
  }
  return {
    get,
    update(root: string, changes: { ref: string; marked: boolean }[]) {
      const key = repositoryKey(root);
      const pending = (queues.get(key) || Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const branches = await refs(root);
          const allowed = new Set(['HEAD', ...branches.map((branch) => branch.ref)]);
          if (
            !Array.isArray(changes) ||
            changes.some(
              (change) => !change || !allowed.has(change.ref) || typeof change.marked !== 'boolean',
            )
          )
            throw Error('Invalid favorite branch');
          const previous = get(root);
          const favorites = new Set(
            previous.favorites ??
              branches
                .filter((branch) => /^(master|main)$/.test(branch.name.split('/').pop()))
                .map((branch) => branch.ref),
          );
          for (const { ref, marked } of changes) {
            if (marked) favorites.add(ref);
            else favorites.delete(ref);
          }
          const next = { favorites: [...favorites], favoriteVersion: previous.favoriteVersion + 1 };
          await state.update(`favorites:${root}`, next.favorites);
          snapshots.set(key, next);
          for (const listener of listeners) listener(key, next);
          return next;
        });
      queues.set(key, pending);
      void pending
        .finally(() => {
          if (queues.get(key) === pending) queues.delete(key);
        })
        .catch(() => {});
      return pending;
    },
    subscribe(listener: (root: string, snapshot: ReturnType<typeof get>) => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}
