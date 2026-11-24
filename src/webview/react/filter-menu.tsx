import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import type { FilterEntry } from '../../shared/filters';
export interface FilterRow extends HTMLDivElement {
  recentMenu?: boolean;
  submenuLabel?: string;
  submenuEntries?: FilterEntry[];
}
export interface FilterMenuProps {
  kind: string;
  activeIndex?: number;
  idPrefix?: string;
  expandedLabel?: string;
  entries: FilterEntry[];
  favorites: ReadonlySet<string>;
  register(index: number, row: FilterRow | null): void;
  favorite(ref: string): void;
  clearRecent(): void;
  removeRecent(entry: FilterEntry): void;
  run(row: FilterRow, entry: FilterEntry): void;
  enter(row: FilterRow, entry: FilterEntry, index: number): void;
  leave(row: FilterRow, relatedTarget: EventTarget | null): void;
  arrowEnter(row: FilterRow, entry: FilterEntry): void;
  arrowLeave(): void;
  clearEnter(): void;
  openSub(row: FilterRow, entry: FilterEntry): void;
}
export function FilterIcon({ name }: { name: string }) {
  return <span className={'rebased-icon rebased-' + name} aria-hidden="true" />;
}
function stopActivation(event: KeyboardEvent) {
  if (['Enter', ' '].includes(event.key)) event.stopPropagation();
}
function preventPointer(event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();
}
function ClearRecent({ kind, clearRecent, clearEnter }: FilterMenuProps) {
  return (
    <button
      type="button"
      className="filter-recent-clear"
      title="Clear Recent"
      aria-label={'Clear Recent ' + kind + ' filters'}
      onPointerEnter={clearEnter}
      onPointerDown={preventPointer}
      onKeyDown={stopActivation}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        clearRecent();
      }}
    >
      <FilterIcon name="gc" />
    </button>
  );
}
function HighlightedLabel({ entry }: { entry: FilterEntry }) {
  if (!entry.label || !entry.matches?.length) return <>{entry.label}</>;
  const hits = new Set(entry.matches),
    parts: React.ReactNode[] = [];
  let start = 0;
  for (let end = 1; end <= entry.label.length; end++) {
    if (end === entry.label.length || hits.has(end) !== hits.has(start)) {
      const text = entry.label.slice(start, end);
      parts.push(
        hits.has(start) ? <strong key={start}>{text}</strong> : <span key={start}>{text}</span>,
      );
      start = end;
    }
  }
  return <>{parts}</>;
}
function FilterMenuItem({
  entry,
  index,
  hasIcons,
  ...props
}: FilterMenuProps & {
  entry: FilterEntry;
  index: number;
  hasIcons: boolean;
}) {
  const rowRef = useRef<FilterRow>(null);
  const recentMenu = Boolean(entry.children?.every((item) => item.recent));
  const marked = entry.branch && props.favorites.has(entry.branch.ref);
  return (
    <div
      id={props.idPrefix ? props.idPrefix + index : undefined}
      className={'filter-menu-item' + (props.activeIndex === index ? ' is-search-selected' : '')}
      role="menuitem"
      tabIndex={-1}
      title={entry.recent ? undefined : entry.value?.join('\n') || entry.label}
      ref={(row) => {
        rowRef.current = row;
        if (row)
          Object.assign(row, {
            submenuLabel: undefined,
            submenuEntries: undefined,
            recentMenu: false,
          });
        if (row && entry.children)
          Object.assign(row, {
            submenuLabel: entry.label,
            submenuEntries: entry.children,
            recentMenu,
          });
        props.register(index, row);
      }}
      aria-haspopup={entry.children ? 'menu' : undefined}
      aria-expanded={entry.children ? props.expandedLabel === entry.label : undefined}
      onClick={(event) => props.run(event.currentTarget, entry)}
      onPointerEnter={(event) => props.enter(event.currentTarget, entry, index)}
      onPointerLeave={
        recentMenu ? (event) => props.leave(event.currentTarget, event.relatedTarget) : undefined
      }
      onKeyDown={(event) => {
        if (['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          props.run(event.currentTarget, entry);
        }
        if (event.key === 'ArrowRight' && entry.children) {
          event.preventDefault();
          event.stopPropagation();
          props.openSub(event.currentTarget, entry);
        }
      }}
    >
      {hasIcons && (
        <span
          className={'filter-menu-icon' + (marked ? ' is-favorite' : '')}
          role={entry.branch ? 'button' : undefined}
          aria-label={
            entry.branch ? (marked ? 'Unmark as Favorite' : 'Mark as Favorite') : undefined
          }
          onClick={
            entry.branch
              ? (event) => {
                  event.stopPropagation();
                  if (entry.branch) props.favorite(entry.branch.ref);
                }
              : undefined
          }
        >
          {entry.branch ? <FilterIcon name="star" /> : entry.checked ? '✓' : ''}
        </span>
      )}
      <span
        className={'filter-menu-label' + (entry.recent ? ' recent-label' : '')}
        data-references={
          entry.recent ? JSON.stringify(entry.displayValues || entry.value) : undefined
        }
      >
        <HighlightedLabel entry={entry} />
      </span>
      {entry.clearRecent && <ClearRecent {...props} />}
      {entry.recent && (
        <>
          {entry.checked && <span className="filter-menu-icon">✓</span>}
          <button
            type="button"
            className="filter-recent-remove"
            title="Remove from Recent"
            aria-label={'Remove ' + entry.label + ' from Recent'}
            onPointerDown={preventPointer}
            onKeyDown={stopActivation}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.removeRecent(entry);
            }}
          />
        </>
      )}
      {entry.children &&
        (recentMenu ? (
          <span
            className="filter-submenu-trigger"
            onPointerEnter={() => rowRef.current && props.arrowEnter(rowRef.current, entry)}
            onPointerLeave={props.arrowLeave}
          >
            <FilterIcon name="right" />
          </span>
        ) : (
          <FilterIcon name="right" />
        ))}
    </div>
  );
}
/** Menu rows are keyed by their source occurrence, preserving duplicate Recent/Favorite entries. */
export function FilterMenu(props: FilterMenuProps) {
  const hasIcons = props.entries.some(
    (entry) => entry.branch || (!entry.recent && entry.checked !== undefined),
  );
  let rowIndex = 0;
  return (
    <>
      {props.entries.map((entry, index) =>
        entry.separator || entry.heading ? (
          <div
            key={'heading-' + index}
            className={
              entry.heading
                ? 'filter-menu-heading' + (entry.clearRecent ? ' filter-recent-heading' : '')
                : 'filter-menu-separator'
            }
          >
            {entry.clearRecent ? (
              <>
                <span className="filter-menu-label">{entry.heading}</span>
                <ClearRecent {...props} />
              </>
            ) : (
              entry.heading
            )}
          </div>
        ) : (
          <FilterMenuItem
            key={'item-' + index}
            {...props}
            entry={entry}
            index={rowIndex++}
            hasIcons={hasIcons}
          />
        ),
      )}
      {!rowIndex && <div className="filter-empty">No matches</div>}
    </>
  );
}

export function FilterSearch({
  kind,
  query,
  activeId,
  register,
  search,
  clear,
}: {
  kind: string;
  query: string;
  activeId?: string;
  register(node: HTMLInputElement | null): void;
  search(query: string): void;
  clear(): void;
}) {
  return (
    <>
      <FilterIcon name="search" />
      <input
        ref={register}
        className="filter-speed-search"
        value={query}
        spellCheck={false}
        aria-label={'Search ' + kind}
        aria-controls="filter-results"
        aria-activedescendant={activeId}
        onChange={(event) => search(event.target.value)}
      />
      <button className="filter-search-clear" aria-label="Clear search" onClick={clear}>
        ×
      </button>
    </>
  );
}
