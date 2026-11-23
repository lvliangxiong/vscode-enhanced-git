import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WebviewApi } from '../api';
import type {
  FileHistoryEntry,
  FileHistoryViewOptions,
  FileHistoryGraphEntry,
} from '../../shared/file-history';
import { CommitList, type CommitRowModel } from './commit-list';
import { CommitDetails, type CommitStats } from './commit-details';
import { useHistoryGraph } from './history-graph';

export function FileHistory({ api }: { api: WebviewApi }) {
  const [stats, setStats] = useState<Record<string, CommitStats>>({});
  const [entries, setEntries] = useState<FileHistoryEntry[]>([]);
  const [graph, setGraph] = useState<FileHistoryGraphEntry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [selected, setSelected] = useState<string[]>([]);
  const selectedRef = useRef(selected);
  const refreshSelection = useRef<string[]>([]);
  const [loading, setLoading] = useState(true),
    [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('');
  const [path, setPath] = useState('');
  const [capabilities, setCapabilities] = useState({ affected: false, locate: false });
  const [view, setView] = useState<FileHistoryViewOptions>(() => ({
    author: true,
    date: true,
    hash: true,
    details: false,
    ...api.getState()?.historyView,
  }));
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const generation = useRef(0),
    request = useRef(0),
    requestKey = useRef('');
  const anchor = useRef(''),
    list = useRef<HTMLDivElement>(null);
  const rowHeight = 24;
  const key = () => `${generation.current}:${selectedRef.current.join(',')}:${++request.current}`;
  const sendSelection = (type: string) =>
    api.postMessage({ type, hashes: selectedRef.current, generation: generation.current });
  function openDiff(type = 'historyDiff') {
    if (!selectedRef.current.length || selectedRef.current.length > 2) return;
    const value = key();
    requestKey.current = value;
    setStatus('Opening native diff…');
    api.postMessage({
      type,
      hashes: selectedRef.current,
      key: value,
      generation: generation.current,
    });
  }
  function select(hashes: string[], open = true) {
    selectedRef.current = hashes;
    setSelected(hashes);
    setStatus(hashes.length > 2 ? 'Select one or two commits to compare.' : '');
    if (open && hashes.length && hashes.length <= 2) openDiff();
  }
  function loadMore() {
    setLoading(true);
    api.postMessage({ type: 'historyMore', generation: generation.current });
  }
  useEffect(() => {
    const receive = ({ data }: MessageEvent) => {
      if (data.type === 'historyAction' && data.generation === generation.current) {
        if (data.action === 'refresh') {
          setLoading(true);
          setStatus('');
          api.postMessage({ type: 'historyRefresh', generation: generation.current });
        } else if (data.action === 'compareLocal') openDiff('historyCompareLocal');
        else if (data.action === 'affected') sendSelection('historyAffected');
        else if (data.action === 'locate') sendSelection('historyLocate');
      }
      if (data.type === 'historyDetails' && data.generation === generation.current) {
        setStats((value) => ({
          ...value,
          ...Object.fromEntries(data.items.map((item) => [item.hash, item.stats])),
        }));
      }
      if (data.type === 'historyViewOptions') {
        setView(data.view);
        api.setState({ ...api.getState(), historyView: data.view });
      }
      if (data.type === 'historyStart' || data.type === 'historyEmpty') {
        generation.current = data.generation ?? 0;
        requestKey.current = '';
        refreshSelection.current = data.refresh ? selectedRef.current : [];
        entriesRef.current = [];
        setEntries([]);
        setGraph([]);
        setStats({});
        select([], false);
        setHasMore(false);
        setLoading(data.type === 'historyStart');
        setPath(data.path || '');
        setCapabilities({ affected: false, locate: false });
        if (list.current) list.current.scrollTop = 0;
        setViewport((value) => ({ ...value, top: 0 }));
      }
      if (data.type === 'historyPage') {
        if ((data.generation ?? 0) < generation.current) return;
        generation.current = data.generation ?? 0;
        const next = data.reset ? data.entries : [...entriesRef.current, ...data.entries];
        if (data.graph?.length) {
          const order = new Map<string, number>(
            data.graph.map((entry, index) => [entry.hash, index]),
          );
          next.sort((a, b) => (order.get(a.hash) ?? Infinity) - (order.get(b.hash) ?? Infinity));
        }
        entriesRef.current = next;
        setEntries(next);
        setGraph(data.graph || []);
        setHasMore(data.hasMore);
        setLoading(false);
        setPath(data.path);
        setCapabilities(data.capabilities ?? { affected: false, locate: false });
        if (data.reset || !selectedRef.current.length) {
          const retained = data.reset
            ? (refreshSelection.current.length
                ? refreshSelection.current
                : selectedRef.current
              ).filter((hash) => next.some((entry) => entry.hash === hash))
            : [];
          const chosen = retained.length ? retained : next[0] ? [next[0].hash] : [];
          refreshSelection.current = [];
          anchor.current = chosen[0] || '';
          select(chosen);
        }
      }
      if (
        data.type === 'historyDiffReady' &&
        data.key === requestKey.current &&
        data.generation === generation.current
      ) {
        setStatus('Native diff is open in the editor.');
      }
      if (data.type === 'historyError') {
        if (data.generation !== undefined && data.generation !== generation.current) return;
        if (data.key && data.key !== requestKey.current) return;
        setStatus(data.message);
        setLoading(false);
      }
    };
    window.addEventListener('message', receive);
    api.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', receive);
  }, [api]);
  useLayoutEffect(() => {
    const element = list.current;
    const observer = new window.ResizeObserver(() => {
      const height = element.clientHeight;
      // A newly opened details pane or a smaller sidebar must not hide the selection.
      const index = entriesRef.current.findIndex(
        (entry) => entry.hash === selectedRef.current.at(-1),
      );
      if (height > 0 && index >= 0) {
        const top = index * rowHeight;
        if (top < element.scrollTop) element.scrollTop = top;
        else if (top + rowHeight > element.scrollTop + height)
          element.scrollTop = top + rowHeight - height;
      }
      const top = element.scrollTop;
      setViewport((value) =>
        value.height === height && value.top === top ? value : { height, top },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    api.postMessage({
      type: 'historyToolbarState',
      generation: generation.current,
      state: {
        loading,
        selected: selected.length,
        affected: capabilities.affected,
        locate: capabilities.locate,
        view,
      },
    });
  }, [api, loading, selected, capabilities, view, path]);
  useEffect(() => {
    if (view.details && selected.length > 0 && selected.length <= 2)
      api.postMessage({ type: 'historyDetails', hashes: selected, generation: generation.current });
  }, [api, selected, view.details]);
  const current = entries.find((entry) => entry.hash === selected[0]);
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 5);
  const end = Math.min(entries.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 5);
  const historyGraph = useHistoryGraph(entries, graph, rowHeight, list, start, end);
  const byHash = useMemo(() => new Map(entries.map((entry) => [entry.hash, entry])), [entries]);
  function navigateGraph(hash: string) {
    const target = entriesRef.current.findIndex((entry) => entry.hash === hash);
    if (target >= 0) {
      list.current.scrollTop = target * rowHeight;
      setViewport((value) => ({ ...value, top: target * rowHeight }));
      anchor.current = hash;
      select([hash]);
    } else if (hasMore && !loading) loadMore();
  }
  const navigateRef = useRef(navigateGraph);
  navigateRef.current = navigateGraph;
  return (
    <main className="file-history">
      <section className="history-list" aria-label="File modification history">
        <div
          className="history-commits commit-table"
          style={{
            gridTemplateColumns: `minmax(120px, 1fr) ${view.author ? 'minmax(65px, 16%)' : ''} ${view.date ? '90px' : ''} ${view.hash ? '68px' : ''}`,
          }}
          ref={list}
          tabIndex={0}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Commits"
          onScroll={(event) => {
            // React clears currentTarget after dispatch; queued updaters must use a value snapshot.
            const top = event.currentTarget.scrollTop;
            setViewport((value) => (value.top === top ? value : { ...value, top }));
          }}
          onKeyDown={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key) ||
              !entries.length
            )
              return;
            event.preventDefault();
            if (event.key === 'Enter') {
              openDiff();
              return;
            }
            const index = entries.findIndex((entry) => entry.hash === selected.at(-1));
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? entries.length - 1
                  : Math.max(
                      0,
                      Math.min(entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                    );
            const hashes = event.shiftKey
              ? entries
                  .slice(Math.min(index, next), Math.max(index, next) + 1)
                  .map((entry) => entry.hash)
              : [entries[next].hash];
            select(hashes);
            anchor.current = entries[next].hash;
            if (next * rowHeight < list.current.scrollTop)
              list.current.scrollTop = next * rowHeight;
            else if ((next + 1) * rowHeight > list.current.scrollTop + list.current.clientHeight)
              list.current.scrollTop = (next + 1) * rowHeight - list.current.clientHeight;
          }}
        >
          <CommitList
            spacerTop={start * rowHeight}
            spacerBottom={(entries.length - end) * rowHeight}
            rowId={(commit) => `history-${commit.hash}`}
            rows={entries.slice(start, end).map((entry, offset): CommitRowModel => {
              const row = historyGraph.index?.get(start + offset);
              return {
                commit: entry,
                contentKey: JSON.stringify([entry, view]),
                graphKey: row,
                graphWidth: row ? historyGraph.renderer.rowGraphWidth(row, rowHeight) : 0,
                selected: selected.includes(entry.hash),
                highlight: false,
                mergeMuted: false,
                headHighlight: false,
                cherryMuted: false,
                isMe: false,
                index: start + offset,
                total: entries.length,
                decorations: '',
                refsLeft: false,
                compactRefs: true,
                columns: [
                  'subject',
                  ...(view.author ? ['author'] : []),
                  ...(view.date ? ['date'] : []),
                  ...(view.hash ? ['hash'] : []),
                ],
                values: {
                  author: entry.author,
                  date: new Date(entry.date).toLocaleDateString(),
                  hash: entry.hash.slice(0, 8),
                },
                titles: {
                  subject: `${entry.author} <${entry.email}>\n${new Date(entry.date).toLocaleString()}\n${entry.hash}\n\n${entry.message}\n\n${entry.path}`,
                  author: `${entry.author} <${entry.email}>`,
                  date: new Date(entry.date).toLocaleString(),
                  hash: entry.hash,
                },
                graph: () => {
                  if (!row) return document.createElement('span');
                  const cell = historyGraph.renderer.graphCell(
                    row,
                    (hash) => navigateRef.current(hash),
                    rowHeight,
                    (hash) => byHash.get(hash),
                  );
                  for (const arrow of cell.querySelectorAll('.graph-jump')) {
                    if (!byHash.has(arrow.getAttribute('data-target')))
                      arrow.setAttribute('aria-label', 'Load more file history');
                  }
                  return cell;
                },
              };
            })}
            select={(entry, event) => {
              let hashes = [entry.hash];
              if (event.shiftKey && anchor.current) {
                const a = entries.findIndex((item) => item.hash === anchor.current);
                const b = entries.findIndex((item) => item.hash === entry.hash);
                hashes = entries.slice(Math.min(a, b), Math.max(a, b) + 1).map((item) => item.hash);
              } else if (event.metaKey || event.ctrlKey) {
                hashes = selected.includes(entry.hash)
                  ? selected.filter((hash) => hash !== entry.hash)
                  : [...selected, entry.hash];
                anchor.current = entry.hash;
              } else anchor.current = entry.hash;
              select(hashes);
            }}
            context={() => {}}
            onKeyDown={() => {}}
            drag={() => {}}
            resize={() => {}}
          />
          {!entries.length && !loading && (
            <div className="history-placeholder sidebar-welcome">
              <p>
                {path
                  ? 'No history up to this revision.'
                  : 'Select a file in Git Log, then choose “History Up To Here” in the files toolbar to view its history up to the selected commit.'}
              </p>
              <button
                className="open-git-log"
                onClick={() => api.postMessage({ type: 'openGitLog' })}
              >
                Open Git Log
              </button>
            </div>
          )}
        </div>
        {view.details && current && (
          <section className="history-commit-details" aria-label="Commit details">
            <CommitDetails
              items={entries
                .filter((entry) => selected.includes(entry.hash))
                .map((commit) => ({ commit, message: commit.message, stats: stats[commit.hash] }))}
              onOpenLink={(url) =>
                api.postMessage({ type: 'historyOpenLink', url, generation: generation.current })
              }
              onCopy={(hash) =>
                api.postMessage({
                  type: 'historyCopy',
                  hashes: [hash],
                  generation: generation.current,
                })
              }
              onShowChanges={(hash) =>
                api.postMessage({
                  type: 'historyAffected',
                  hashes: [hash],
                  generation: generation.current,
                })
              }
            />
          </section>
        )}
        {(entries.length > 0 || loading) && (
          <footer>
            <span>
              {entries.length} commits{selected.length > 1 ? ` · ${selected.length} selected` : ''}
            </span>
            {(hasMore || loading) && (
              <button disabled={loading} onClick={loadMore}>
                {loading ? 'Loading…' : 'Load more commits'}
              </button>
            )}
          </footer>
        )}
        {status && (
          <div className="history-status" role="status">
            {status}
          </div>
        )}
      </section>
    </main>
  );
}
