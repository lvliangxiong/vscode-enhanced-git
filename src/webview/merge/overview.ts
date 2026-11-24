import type { MergeChangeKind, MergeLayout } from './layout';
import type { editor } from 'monaco-editor';
import { boundaryTop } from './scroll';

export interface MergeOverviewMarker {
  line: number;
  endLine: number;
  kind: MergeChangeKind;
  change: number;
}

/** Overview markers include empty insertion/deletion points that have no line fill. */
export function mergeOverviewMarkers(
  layout: MergeLayout,
  side: number,
  aligned: boolean,
  lineCount: number,
): MergeOverviewMarker[] {
  const markers = new Map<string, MergeOverviewMarker>();
  const clamp = (line: number) => Math.max(1, Math.min(lineCount, line));
  layout.pairs.forEach((pairs, parent) => {
    if (side !== 1 && side !== (parent === 0 ? 0 : 2)) return;
    let group = 0;
    for (const pair of pairs) {
      while (group + 1 < layout.changes.length && layout.changes[group][1].end < pair.after.start)
        group++;
      const range = side === 1 ? pair.after : pair.before;
      const kind =
        aligned && range.start !== range.end ? (side === 1 ? 'inserted' : 'deleted') : pair.kind;
      const line = clamp(range.start + 1);
      const endLine = Math.max(line, clamp(range.end));
      markers.set(`${line}-${endLine}-${kind}-${group}`, { line, endLine, kind, change: group });
    }
  });
  return [...markers.values()].sort((a, b) => a.line - b.line || a.endLine - b.endLine);
}

/** Use real editor offsets, including Native Style view zones, when hit testing. */
export function nearestOverviewChange(
  markers: readonly MergeOverviewMarker[],
  offset: number,
  top: (line: number) => number,
): number | undefined {
  let nearest: number | undefined,
    distance = Infinity;
  for (const marker of markers) {
    const start = top(marker.line),
      end = top(marker.endLine + 1);
    const delta = Math.max(start - offset, offset - end, 0);
    if (delta < distance) {
      nearest = marker.change;
      distance = delta;
    }
  }
  return nearest;
}

/** Intercept only overview-canvas clicks, leaving scrollbar thumb dragging native.
 * Monaco delegates these pointer events to its scrollbar before onMouseDown.
 */
export function createMergeOverviewNavigation(
  container: HTMLElement,
  editor: editor.IStandaloneCodeEditor,
  markers: readonly MergeOverviewMarker[],
  lineHeight: () => number,
  reveal: (change: number) => void,
) {
  const pointer = (event: PointerEvent) => {
    const target = event.target as Element;
    if (
      event.button !== 0 ||
      target.closest?.('.slider') ||
      !target.closest?.('canvas.decorationsOverviewRuler, .scrollbar.vertical')
    )
      return;
    const ruler = editor.getLayoutInfo().overviewRuler;
    if (!ruler.height) return;
    const offset =
      ((event.clientY - container.getBoundingClientRect().top - ruler.top) / ruler.height) *
      editor.getScrollHeight();
    const change = nearestOverviewChange(markers, offset, (line) =>
      boundaryTop(editor, line - 1, lineHeight()),
    );
    if (change === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    reveal(change);
  };
  container.addEventListener('pointerdown', pointer, true);
  return { dispose: () => container.removeEventListener('pointerdown', pointer, true) };
}
