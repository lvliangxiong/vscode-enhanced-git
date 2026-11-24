import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Branch, Stash } from '../../shared/model';

/** A tree snapshot and its interaction boundary; repository state lives in the log session. */
export interface BranchTreeProps {
  branches: readonly Branch[];
  headLabel?: string;
  stashes?: readonly Stash[];
  selectedHashes?: ReadonlySet<string>;
  onStashActivate?(stash: Stash): void;
  favorites: ReadonlySet<string>;
  selectedRefs: ReadonlySet<string>;
  openGroups: ReadonlyMap<string, boolean>;
  query: string;
  onSelect(ref: string, event: MouseEvent, row: HTMLButtonElement): void;
  onActivate(ref: string, append: boolean, row: HTMLButtonElement): void;
  onContextMenu(branch: Branch, x: number, y: number, row: HTMLButtonElement): void;
  onKeyDown(event: KeyboardEvent, row: HTMLButtonElement): void;
  onToggle(key: string, open: boolean): void;
}

interface TreeBranch extends Branch {
  display: string;
}

const byName = (a: Branch, b: Branch) => a.name.localeCompare(b.name, undefined, { numeric: true });

function isCurrentReference(branch: Branch, model: BranchTreeProps) {
  return Boolean(
    branch.current ||
    (branch.group === 'Tags' &&
      model.headLabel === branch.name &&
      !model.branches.some((item) => item.group === 'Local' && item.current)),
  );
}

function BranchIcon({ kind }: { kind: string }) {
  return (
    <span className={`rebased-icon rebased-${kind} branch-icon icon-${kind}`} aria-hidden="true" />
  );
}

function BranchRow({
  branch,
  label,
  location,
  model,
}: {
  branch: Branch;
  label: string;
  location: string;
  model: BranchTreeProps;
}) {
  const selected = model.selectedRefs.has(branch.ref);
  const current = isCurrentReference(branch, model);
  const favorite = model.favorites.has(branch.ref);
  // Rebased GitBranchesTreeIconProvider: current+favorite, current, favorite, tag, branch.
  const kind = current
    ? favorite
      ? 'current-branch-favorite'
      : 'current-branch'
    : favorite
      ? 'star'
      : branch.group === 'Tags'
        ? 'tag'
        : 'branch';
  return (
    <button
      className={`${selected ? 'active ' : ''}branch${current ? ' current-branch' : ''}`}
      data-ref={branch.ref}
      data-location={location}
      data-full-name={branch.name}
      aria-label={branch.name}
      aria-pressed={selected}
      aria-current={current ? 'true' : undefined}
      onClick={(event) => model.onSelect(branch.ref, event.nativeEvent, event.currentTarget)}
      onDoubleClick={(event) => {
        event.preventDefault();
        model.onActivate(branch.ref, event.metaKey, event.currentTarget);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        model.onContextMenu(branch, event.clientX, event.clientY, event.currentTarget);
      }}
      onKeyDown={(event) => {
        const row = event.currentTarget;
        model.onKeyDown(event.nativeEvent, row);
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = row.getBoundingClientRect();
          model.onContextMenu(branch, rect.left, rect.bottom, row);
        }
      }}
    >
      <span className="branch-status-icon" aria-hidden="true">
        <BranchIcon kind={kind} />
      </span>
      <span className="branch-label">{label}</span>
      {Boolean(branch.behind) && (
        <span className="branch-count" title={`${branch.behind} incoming commits`}>
          ↙ {branch.behind! > 99 ? '99+' : branch.behind}
        </span>
      )}
      {Boolean(branch.ahead) && (
        <span className="branch-count" title={`${branch.ahead} outgoing commits`}>
          ↗ {branch.ahead! > 99 ? '99+' : branch.ahead}
        </span>
      )}
    </button>
  );
}

function BranchGroup({
  name,
  groupKey,
  folder = false,
  initial = false,
  model,
  children,
}: {
  name: string;
  groupKey: string;
  folder?: boolean;
  initial?: boolean;
  model: BranchTreeProps;
  children: ReactNode;
}) {
  // Search expands matching groups temporarily without changing their saved state.
  const searching = Boolean(model.query);
  const open = searching || (model.openGroups.get(groupKey) ?? initial);
  const element = useRef<HTMLDetailsElement>(null);
  // Native summary clicks can change `open` without a React render. Reapply the
  // snapshot on the next update even if its boolean matches the previous props.
  useLayoutEffect(() => {
    if (element.current && element.current.open !== open) element.current.open = open;
  });
  return (
    <details
      ref={element}
      className="branch-group"
      data-key={groupKey}
      open={open}
      onToggle={(event) => {
        if (!searching) model.onToggle(groupKey, event.currentTarget.open);
      }}
    >
      <summary>
        <span className="folder-chevron rebased-icon rebased-right" aria-hidden="true" />
        {folder && <BranchIcon kind="folder" />}
        <span>{name}</span>
      </summary>
      {children}
    </details>
  );
}

function BranchDirectory({
  items,
  location,
  prefix = '',
  model,
}: {
  items: readonly TreeBranch[];
  location: string;
  prefix?: string;
  model: BranchTreeProps;
}) {
  const pinned = items
    .filter((branch) => isCurrentReference(branch, model) || model.favorites.has(branch.ref))
    .sort(
      (a, b) =>
        Number(isCurrentReference(b, model)) - Number(isCurrentReference(a, model)) || byName(a, b),
    );
  const folders = new Map<string, TreeBranch[]>();
  const plain: TreeBranch[] = [];
  for (const branch of items) {
    if (isCurrentReference(branch, model) || model.favorites.has(branch.ref)) continue;
    const rest = branch.display.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) plain.push(branch);
    else {
      const folder = rest.slice(0, slash);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder)!.push(branch);
    }
  }
  const row = (branch: TreeBranch) => (
    <BranchRow
      key={branch.ref}
      branch={branch}
      label={branch.display.slice(prefix.length)}
      location={location}
      model={model}
    />
  );
  return (
    <>
      {pinned.map(row)}
      {[...folders]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, children]) => (
          <BranchGroup
            key={folder}
            name={folder}
            groupKey={`${location}/${folder}`}
            folder
            model={model}
          >
            <BranchDirectory
              items={children}
              location={`${location}/${folder}`}
              prefix={`${prefix}${folder}/`}
              model={model}
            />
          </BranchGroup>
        ))}
      {plain.sort(byName).map(row)}
    </>
  );
}

export function BranchTree(model: BranchTreeProps) {
  let hasMatches = false;
  const groups = (['Local', 'Remote', 'Tags'] as const).map((group) => {
    const items = model.branches.filter(
      (branch) => branch.group === group && branch.name.toLowerCase().includes(model.query),
    );
    hasMatches ||= items.length > 0;
    if (!items.length) return null;
    const remotes = [
      ...new Set(items.map((branch) => branch.remote || branch.name.split('/')[0])),
    ].sort();
    return (
      <BranchGroup
        key={group}
        name={group}
        groupKey={group}
        initial={group !== 'Tags'}
        model={model}
      >
        {group === 'Remote' ? (
          remotes.map((remote) => (
            <BranchGroup
              key={remote}
              name={remote}
              groupKey={`Remote/${remote}`}
              folder
              initial
              model={model}
            >
              <BranchDirectory
                items={items
                  .filter((branch) => (branch.remote || branch.name.split('/')[0]) === remote)
                  .map((branch) => ({ ...branch, display: branch.name.slice(remote.length + 1) }))}
                location={`Remote/${remote}`}
                model={model}
              />
            </BranchGroup>
          ))
        ) : (
          <BranchDirectory
            items={items.map((branch) => ({ ...branch, display: branch.name }))}
            location={group}
            model={model}
          />
        )}
      </BranchGroup>
    );
  });
  const stashes = (model.stashes || []).filter((stash) =>
    `${stash.ref} ${stash.subject}`.toLowerCase().includes(model.query),
  );
  hasMatches ||= stashes.length > 0;
  return (
    <>
      {groups}
      {stashes.length > 0 && (
        <BranchGroup name="Stashes" groupKey="Stashes" initial model={model}>
          {stashes.map((stash) => (
            <button
              key={`${stash.ref}:${stash.hash}`}
              className={`branch stash-row${model.selectedHashes?.has(stash.hash) ? ' active' : ''}`}
              data-stash-hash={stash.hash}
              data-full-name={`${stash.ref}: ${stash.subject}`}
              title={`${stash.ref}: ${stash.subject}\n${stash.hash}`}
              aria-label={`${stash.ref}: ${stash.subject}`}
              aria-pressed={model.selectedHashes?.has(stash.hash) || false}
              onClick={() => model.onStashActivate?.(stash)}
              onKeyDown={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey ||
                  !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                )
                  return;
                event.preventDefault();
                const rows = [
                  ...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                    '.stash-row',
                  ),
                ];
                const index = rows.indexOf(event.currentTarget);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? rows.length - 1
                      : Math.max(
                          0,
                          Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                        );
                rows[next]?.focus();
              }}
            >
              <span className="branch-status-icon" aria-hidden="true">
                <BranchIcon kind="stash" />
              </span>
              <span className="branch-label">
                {stash.ref}: {stash.subject}
              </span>
            </button>
          ))}
        </BranchGroup>
      )}
      {model.query && !hasMatches && <p className="empty">No matching branches, tags or stashes</p>}
    </>
  );
}
