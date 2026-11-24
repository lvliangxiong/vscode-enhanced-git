import type { RecentGroups, RecentKind } from '../../shared/model';
import type { Memento } from 'vscode';
const path = require('node:path');
import { repositoryKey } from './events';
import { remember, forget } from '../../shared/filters';
// Global legacy recents cannot be attributed to a repository safely.
function createRepositoryRecents(workspaceState: Memento) {
  const cache = new Map<string, RecentGroups>(),
    listeners = new Set<(root: string, groups: RecentGroups) => void>();
  let writes = Promise.resolve();
  const key = (root) => `filterRecents:${repositoryKey(root)}`;
  function get(root) {
    const id = key(root);
    if (!cache.has(id)) {
      const saved = workspaceState.get<RecentGroups>(id, {});
      cache.set(id, {
        ...saved,
        paths: (saved.paths || []).map((group) => group.map((value) => path.resolve(root, value))),
      });
    }
    return cache.get(id)!;
  }
  return {
    get,
    async update(root: string, kind: RecentKind, values: string[], action: string) {
      const id = key(root),
        previous = get(root);
      const next = {
        ...previous,
        [kind]:
          action === 'clear'
            ? []
            : (action === 'forget' ? forget : remember)(previous[kind] || [], values),
      };
      cache.set(id, next);
      writes = writes.catch(() => {}).then(() => workspaceState.update(id, next));
      await writes;
      for (const listener of listeners) listener(repositoryKey(root), get(root));
    },
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}
export { createRepositoryRecents };
