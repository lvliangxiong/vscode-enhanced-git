import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { BranchSummary } from './branch-summary';

export interface RepositoryTab {
  root: string;
  name: string;
}
export interface RepositoryStatus {
  status?: string;
  branchNames?: string[];
  count?: string;
  updates?: boolean;
}
export interface RepositoryHostState {
  repositories: RepositoryTab[];
  documents: ReadonlyMap<string, { html: string; name: string }>;
  statuses: ReadonlyMap<string, RepositoryStatus>;
  active?: string;
  closeVersion: number;
  emptyMessage: string;
}
export interface RepositoryHostProps {
  store: StoreApi<RepositoryHostState>;
  document: Document;
  window: Window;
  sheet: CSSStyleSheet;
  select(root: string): void;
  refresh(): void;
}

/** Repository tabs/footer are one reactive view; each mounted pane keeps its own store. */
export function RepositoryHost({
  store,
  document,
  window,
  sheet,
  select,
  refresh,
}: RepositoryHostProps) {
  const state = useStore(store);
  const status = state.statuses.get(state.active) || {};
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
      !state.repositories.length
    )
      return;
    event.preventDefault();
    const count = state.repositories.length;
    const index = state.repositories.findIndex((repo) => repo.root === state.active);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
    select(state.repositories[next].root);
    const button = event.currentTarget.children[next] as HTMLElement;
    button.focus();
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <>
      <div id="logs">
        {[...state.documents].map(([root, value]) => (
          <div
            key={root}
            className="log-pane"
            data-root={root}
            aria-label={`Git Log — ${value.name}`}
            hidden={root !== state.active}
          />
        ))}
      </div>
      <footer>
        <div id="repositories" role="group" aria-label="Repositories" onKeyDown={onKeyDown}>
          {state.repositories.map((repo) => (
            <button
              key={repo.root}
              type="button"
              title={repo.root}
              data-root={repo.root}
              aria-pressed={repo.root === state.active}
              onClick={() => select(repo.root)}
            >
              {repo.name}
            </button>
          ))}
        </div>
        <span id="status">
          <BranchSummary
            message={
              state.repositories.length
                ? status.status || 'Loading repository…'
                : state.emptyMessage
            }
            names={status.branchNames ?? null}
            document={document}
            window={window}
            sheet={sheet}
            closeVersion={state.closeVersion}
          />
        </span>
        <button id="updates" type="button" hidden={!status.updates} onClick={refresh}>
          Updates available · Refresh
        </button>
        <span id="count">{status.count || ''}</span>
      </footer>
    </>
  );
}
