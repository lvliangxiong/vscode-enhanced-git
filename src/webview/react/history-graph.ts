import { useEffect, useLayoutEffect, useMemo, type RefObject } from 'react';
import { createRows } from '../../shared/graph';
import type { FileHistoryEntry, FileHistoryGraphEntry } from '../../shared/file-history';
import { createGraphRenderer } from '../log/graph-render';

/** File history supplies filtered topology; rendering and row caching are shared with Git Log. */
export function useHistoryGraph(
  entries: FileHistoryEntry[],
  graph: FileHistoryGraphEntry[],
  rowHeight: number,
  list: RefObject<HTMLDivElement>,
  start: number,
  end: number,
) {
  const renderer = useMemo(
    () =>
      createGraphRenderer(
        {
          document,
          window,
          el(tag, text, cls) {
            const element = document.createElement(tag);
            if (text !== undefined) element.textContent = String(text);
            if (cls) element.className = cls;
            return element;
          },
        },
        () => list.current.style,
        () => list.current,
      ),
    [list],
  );
  const index = useMemo(() => {
    if (!graph.length) return undefined;
    const metadata = new Map(graph.map((entry) => [entry.hash, entry]));
    return createRows(entries.map((entry) => ({ ...entry, ...metadata.get(entry.hash) })));
  }, [entries, graph, rowHeight]);
  useLayoutEffect(() => {
    if (!index) return;
    renderer.setWidth(Math.ceil(((index.maxWidth * 16 + 2) * 24) / 22));
    renderer.repaintGraphCanvases(list.current);
  }, [renderer, index, rowHeight, start, end]);
  useEffect(() => {
    const repaint = () => renderer.repaintGraphCanvases(list.current);
    const observer = new MutationObserver(repaint);
    const resize = new window.ResizeObserver(repaint);
    resize.observe(list.current);
    window.addEventListener('resize', repaint);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-vscode-theme-id'],
    });
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', repaint);
      renderer.dispose();
    };
  }, [renderer]);
  return { renderer, index };
}
