import type { editor } from 'monaco-editor';
import type { MergeLayout } from './layout';

export interface MergeGap {
  /** Monaco inserts the gap after this one-based line; zero means before the first line. */
  afterLineNumber: number;
  lines: number;
}

/** Merge two parent/result alignments in result coordinates. Shared context always
 * stays aligned, even when a large change in one parent overlaps smaller changes
 * in the other. Work is proportional to hunks and gaps, never to total file lines.
 */
export function mergeAlignment(layout: MergeLayout, counts: number[]): MergeGap[][] {
  const resultGaps = new Map<number, number>();
  for (const pair of layout.pairs)
    for (const { before, after } of pair) {
      const deleted = before.end - before.start - (after.end - after.start);
      if (deleted > 0) resultGaps.set(after.end, Math.max(resultGaps.get(after.end) || 0, deleted));
    }
  const result = [...resultGaps].sort((a, b) => a[0] - b[0]);
  const prefix = [0];
  result.forEach(([, lines]) => prefix.push(prefix.at(-1) + lines));
  const indexAt = (line: number, include = true) => {
    let low = 0,
      high = result.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (result[middle][0] < line || (include && result[middle][0] === line)) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const parent = (side: 0 | 2) => {
    const gaps = new Map<number, number>();
    let padding = 0,
      source = 0,
      target = 0;
    const add = (boundary: number, lines: number) => {
      if (lines <= 0) return;
      gaps.set(boundary, (gaps.get(boundary) || 0) + lines);
      padding += lines;
    };
    const segment = (start: number, length: number, at: number, deleted = false) => {
      if (!length) return;
      const index = indexAt(at, !deleted);
      add(start, at + prefix[index] - start - padding);
      if (!deleted) {
        for (let i = index; i < result.length && result[i][0] < at + length; i++)
          add(start + result[i][0] - at, result[i][1]);
      }
    };
    for (const { before, after } of layout.pairs[side === 0 ? 0 : 1]) {
      segment(source, before.start - source, target);
      const shared = Math.min(before.end - before.start, after.end - after.start);
      segment(before.start, shared, after.start);
      segment(before.start + shared, before.end - before.start - shared, after.end, true);
      source = before.end;
      target = after.end;
    }
    segment(source, counts[side] - source, target);
    add(counts[side], counts[1] + prefix.at(-1) - counts[side] - padding);
    return [...gaps].map(([afterLineNumber, lines]) => ({ afterLineNumber, lines }));
  };
  const gaps = [
    parent(0),
    result.map(([afterLineNumber, lines]) => ({ afterLineNumber, lines })),
    parent(2),
  ];
  // Monaco represents an empty file and a trailing EOL with a real empty line.
  const heights = counts.map(
    (count, side) => count + gaps[side].reduce((sum, gap) => sum + gap.lines, 0),
  );
  const height = Math.max(...heights);
  gaps.forEach((side, i) => {
    if (heights[i] < height) {
      const end = side.find((gap) => gap.afterLineNumber === counts[i]);
      if (end) end.lines += height - heights[i];
      else side.push({ afterLineNumber: counts[i], lines: height - heights[i] });
    }
  });
  return gaps;
}

/** Rebuild only zone heights when fonts change; Monaco keeps source text and selection intact. */
export function createMergeAlignment(editors: editor.IStandaloneCodeEditor[], layout: MergeLayout) {
  const plan = mergeAlignment(
    layout,
    editors.map((source) => source.getModel().getLineCount()),
  );
  const zones = editors.map(() => [] as string[]);
  let height = 0;
  const replace = (lineHeight: number) => {
    if (height === lineHeight) return;
    height = lineHeight;
    editors.forEach((source, side) =>
      source.changeViewZones((accessor) => {
        zones[side].forEach((id) => accessor.removeZone(id));
        zones[side] = lineHeight
          ? plan[side].map((gap) => {
              const node = document.createElement('div');
              node.className = 'merge-alignment-gap';
              node.setAttribute('aria-hidden', 'true');
              return accessor.addZone({
                afterLineNumber: gap.afterLineNumber,
                heightInPx: gap.lines * lineHeight,
                domNode: node,
                suppressMouseDown: true,
                showInHiddenAreas: true,
              });
            })
          : [];
      }),
    );
  };
  return { update: replace, dispose: () => replace(0) };
}
