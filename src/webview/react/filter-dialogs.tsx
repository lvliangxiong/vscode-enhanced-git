import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FilterIcon } from './filter-menu';
import type { FilterPeriod, FilterPath } from '../filter-types';
export type { FilterPath } from '../filter-types';
const localDate = (value: string) => {
  const date = value ? new Date(value.length === 10 ? value + 'T00:00:00' : value) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
export function FilterDateDialog({
  since,
  until,
  apply,
  close,
}: {
  since?: string;
  until?: string;
  apply(value: FilterPeriod): void;
  close(): void;
}) {
  const [fields, setFields] = useState({
    since: { enabled: Boolean(since), value: localDate(since) },
    until: { enabled: Boolean(until), value: localDate(until) },
  });
  const inputs = useRef<Record<string, HTMLInputElement>>({});
  const [error, setError] = useState('');
  const submit = () => {
    const value: FilterPeriod = { since: '', until: '', sinceHours: 0 };
    for (const key of ['since', 'until'] as const) {
      if (fields[key].enabled) {
        if (!fields[key].value || !inputs.current[key].checkValidity()) {
          setError('Enter a valid date.');
          return;
        }
        value[key] = new Date(fields[key].value + 'T00:00:00').toISOString();
      }
    }
    if (value.since && value.until && value.since > value.until) {
      setError('After must precede Before.');
      return;
    }
    if (!value.since && !value.until) close();
    else apply(value);
  };
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div className="filter-date-fields">
        {(['since', 'until'] as const).map((key) => {
          const label = key === 'since' ? 'After' : 'Before';
          return (
            <label key={key}>
              <input
                type="checkbox"
                aria-label={label}
                checked={fields[key].enabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setFields((previous) => ({ ...previous, [key]: { ...previous[key], enabled } }));
                  if (enabled) queueMicrotask(() => inputs.current[key]?.focus());
                }}
              />
              <span>{label}</span>
              <input
                ref={(node) => {
                  inputs.current[key] = node;
                }}
                type="date"
                aria-label={label + ' date'}
                disabled={!fields[key].enabled}
                value={fields[key].value}
                onChange={(event) =>
                  setFields((previous) => ({
                    ...previous,
                    [key]: { ...previous[key], value: event.target.value },
                  }))
                }
              />
            </label>
          );
        })}
      </div>
      <p className="popup-error" role="alert">
        {error}
      </p>
      <div className="filter-dialog-actions">
        <button className="popup-apply" onClick={submit}>
          OK
        </button>
      </div>
    </div>
  );
}
interface PathState {
  items?: FilterPath[];
  loading?: boolean;
  failed?: boolean;
}
interface PathDialogProps {
  root: string;
  paths: string[];
  pathChildren(path: string): Promise<FilterPath[]>;
  fileIcon(node: HTMLElement, path: string): void;
  apply(paths: string[]): void;
  close(): void;
}
function covered(chosen: ReadonlySet<string>, path: string) {
  return [...chosen].some(
    (parent) => path === parent || (parent.endsWith('/') && path.startsWith(parent)),
  );
}
function FileIcon({ path, set }: { path: string; set(node: HTMLElement, path: string): void }) {
  const ref = useRef<HTMLSpanElement>(null);
  // The theme service owns the attributes in this isolated leaf. Register after
  // commit so rendering stays pure and later theme messages retain their classes.
  useLayoutEffect(() => {
    set(ref.current, path);
  }, [path, set]);
  return <span ref={ref} />;
}

function PathCheckbox({
  checked,
  indeterminate,
  path,
  toggle,
}: {
  checked: boolean;
  indeterminate: boolean;
  path: string;
  toggle(path: string, checked: boolean): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={path}
      checked={checked}
      onChange={(event) => toggle(path, event.target.checked)}
    />
  );
}
/** Lazy children and selection are independent: expanding a directory never clears chosen paths. */
export function FilterPathDialog({
  root,
  paths,
  pathChildren,
  fileIcon,
  apply,
  close,
}: PathDialogProps) {
  const [chosen, setChosen] = useState(
    () =>
      new Set(
        paths.map((path) => (path.startsWith(root + '/') ? path.slice(root.length + 1) : path)),
      ),
  );
  const [cache, setCache] = useState(() => new Map<string, PathState>());
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [error, setError] = useState('');
  const tree = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    requests = useRef(new Set<string>());
  const speedSearch = useRef({ query: '', typedAt: 0 });
  const load = async (path: string) => {
    if (requests.current.has(path)) return;
    requests.current.add(path);
    setCache((previous) => new Map(previous).set(path, { loading: true }));
    try {
      const items = await pathChildren(path);
      if (!alive.current) return;
      setCache((previous) => new Map(previous).set(path, { items }));
      setChosen((previous) => {
        const next = new Set(previous);
        for (const item of items)
          if (item.directory && next.delete(item.path.slice(0, -1))) next.add(item.path);
        return next;
      });
    } catch (error) {
      if (!alive.current) return;
      setCache((previous) => new Map(previous).set(path, { failed: true }));
      setError(error.message);
    }
  };
  useEffect(() => {
    alive.current = true;
    void load('');
    tree.current.focus();
    return () => {
      alive.current = false;
    };
  }, []);
  const toggle = (path: string, on: boolean) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (on) {
        for (const parent of next)
          if (path.endsWith('/') && parent.startsWith(path)) next.delete(parent);
        next.add(path);
      } else
        for (const parent of previous) {
          if (parent === path || (path.endsWith('/') && parent.startsWith(path)))
            next.delete(parent);
          else if (parent.endsWith('/') && path.startsWith(parent)) {
            next.delete(parent);
            let dir = parent;
            while (dir !== path) {
              const children = cache.get(dir)?.items || [];
              for (const child of children)
                if (
                  child.path !== path &&
                  !path.startsWith(child.path.endsWith('/') ? child.path : child.path + '/')
                )
                  next.add(child.path);
              const child = children.find((item) => item.directory && path.startsWith(item.path));
              if (!child) break;
              dir = child.path;
            }
          }
        }
      return next;
    });
  const expand = (item: FilterPath) => {
    if (!item.directory) return;
    const open = !expanded.has(item.path);
    setExpanded((previous) => {
      const next = new Set(previous);
      open ? next.add(item.path) : next.delete(item.path);
      return next;
    });
    if (open) void load(item.path);
  };
  const renderChildren = (path: string) => {
    const state = cache.get(path);
    if (!state || state.loading) return <>Loading…</>;
    if (state.failed) return null;
    if (!state.items.length) return <div className="filter-empty">Empty folder</div>;
    return state.items.map((item) => {
      const open = expanded.has(item.path),
        checked = covered(chosen, item.path);
      return (
        <div key={item.path} className="filter-path-node">
          <div
            className="filter-path-row"
            role="treeitem"
            tabIndex={-1}
            title={item.path}
            aria-expanded={item.directory ? open : undefined}
            onClick={(event) => {
              if ((event.target as HTMLElement).tagName !== 'INPUT') event.currentTarget.focus();
            }}
            onDoubleClick={() => expand(item)}
            onKeyDown={(event) => {
              if (event.key === ' ') {
                event.preventDefault();
                toggle(item.path, !checked);
              }
              if ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open)) {
                event.preventDefault();
                expand(item);
              }
            }}
          >
            <button
              className="filter-path-expander"
              disabled={!item.directory}
              aria-label={(open ? 'Collapse ' : 'Expand ') + item.name}
              onClick={(event) => {
                event.stopPropagation();
                expand(item);
              }}
            >
              {item.directory && <FilterIcon name={open ? 'down' : 'right'} />}
            </button>
            <PathCheckbox
              path={item.path}
              checked={checked}
              toggle={toggle}
              indeterminate={
                !checked && item.directory && [...chosen].some((path) => path.startsWith(item.path))
              }
            />
            {!item.directory && <FileIcon path={item.path} set={fileIcon} />}
            <span>{item.name}</span>
          </div>
          <div className="filter-path-children" role="group" hidden={!open}>
            {cache.has(item.path) && renderChildren(item.path)}
          </div>
        </div>
      );
    });
  };
  return (
    <>
      <div
        ref={tree}
        className="filter-path-tree"
        role="tree"
        tabIndex={0}
        aria-label="Repository paths"
        onKeyDown={(event) => {
          const visible = [...tree.current.querySelectorAll<HTMLElement>('[role=treeitem]')].filter(
            (row) => row.getClientRects().length,
          );
          let index = -1;
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            index =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? visible.length - 1
                  : (visible.indexOf(
                      (tree.current.getRootNode() as Document | ShadowRoot)
                        .activeElement as HTMLElement,
                    ) +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      visible.length) %
                    visible.length;
          } else if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            event.key.length === 1 &&
            event.key !== ' '
          ) {
            event.preventDefault();
            const now = Date.now(),
              search = speedSearch.current;
            search.query =
              (now - search.typedAt < 1000 ? search.query : '') + event.key.toLowerCase();
            search.typedAt = now;
            index = visible.findIndex((row) => row.title.toLowerCase().includes(search.query));
          }
          if (index >= 0) {
            visible[index]?.focus();
            visible[index]?.scrollIntoView({ block: 'nearest' });
          }
        }}
      >
        {renderChildren('')}
      </div>
      <p className="popup-error" role="alert">
        {error}
      </p>
      <div className="filter-dialog-actions">
        <button className="filter-cancel" onClick={close}>
          Cancel
        </button>
        <button className="popup-apply" disabled={!chosen.size} onClick={() => apply([...chosen])}>
          OK
        </button>
      </div>
    </>
  );
}
