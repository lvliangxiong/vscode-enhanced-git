import type { MergeDiffData } from '../../shared/merge-diff';

/** Zero-based, half-open source line boundaries. Empty ranges are insertion points. */
export interface MergeLineRange {
  start: number;
  end: number;
}
export type MergeChangeKind = 'inserted' | 'deleted' | 'modified' | 'conflict';
export interface MergePairChange {
  before: MergeLineRange;
  after: MergeLineRange;
  kind: MergeChangeKind;
}
export interface MergeShade extends MergeLineRange {
  kind: MergeChangeKind;
}
export type MergeAnchor = [number, number];
export interface MergeLayout {
  pairs: [MergePairChange[], MergePairChange[]];
  anchors: [MergeAnchor[], MergeAnchor[]];
  sides: [MergeShade[], MergeShade[], MergeShade[]];
  changes: [MergeLineRange, MergeLineRange, MergeLineRange][];
}

function parseChanges(patch: string): MergePairChange[] {
  return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => {
    const beforeCount = match[2] === undefined ? 1 : Number(match[2]);
    const afterCount = match[4] === undefined ? 1 : Number(match[4]);
    const before = Number(match[1]) - (beforeCount ? 1 : 0);
    const after = Number(match[3]) - (afterCount ? 1 : 0);
    return {
      before: { start: before, end: before + beforeCount },
      after: { start: after, end: after + afterCount },
      kind: !beforeCount ? 'inserted' : !afterCount ? 'deleted' : 'modified',
    };
  });
}

/** Rebased maps equal context by offset and clamps positions inside unequal changes. */
export function transferLine(anchors: readonly MergeAnchor[], line: number, from: 0 | 1): number {
  const to = 1 - from;
  let low = 0,
    high = anchors.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle][from] < line) low = middle + 1;
    else high = middle;
  }
  const end = anchors[low],
    start = anchors[Math.max(0, low - 1)];
  if (line === end[from]) return end[to];
  if (line > end[from]) return end[to] + line - end[from];
  return Math.min(start[to] + line - start[from], end[to]);
}

/** Overlapping parent changes shade the result once, with modifications taking priority. */
function shades(ranges: MergeShade[]): MergeShade[] {
  const events = new Map<number, Map<MergeChangeKind, number>>();
  for (const { start, end, kind } of ranges) {
    if (start === end) continue;
    for (const [position, delta] of [
      [start, 1],
      [end, -1],
    ]) {
      const event = events.get(position) || new Map<MergeChangeKind, number>();
      event.set(kind, (event.get(kind) || 0) + delta);
      events.set(position, event);
    }
  }
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  const active = new Map<MergeChangeKind, number>(),
    result: MergeShade[] = [];
  sorted.forEach(([start, changes], index) => {
    changes.forEach((delta, kind) => active.set(kind, (active.get(kind) || 0) + delta));
    const end = sorted[index + 1]?.[0];
    const kind = (['conflict', 'modified', 'inserted', 'deleted'] as const).find(
      (key) => (active.get(key) ?? 0) > 0,
    );
    if (end === undefined || !kind) return;
    const last = result.at(-1);
    if (last?.kind === kind && last.end === start) last.end = end;
    else result.push({ start, end, kind });
  });
  return result;
}

export function mergeLayout(data: MergeDiffData): MergeLayout {
  const pairs = data.patches.map(parseChanges) as MergeLayout['pairs'];
  const counts = data.contents.map((text) => text.split('\n').length);
  const anchors = pairs.map((changes, parent) => [
    [0, 0],
    ...changes.flatMap(({ before, after }) => [
      [before.start, after.start],
      [before.end, after.end],
    ]),
    [counts[parent === 0 ? 0 : 2], counts[1]],
  ]) as MergeLayout['anchors'];
  const groups: {
    after: MergeLineRange;
    members: { parent: number; change: MergePairChange }[];
  }[] = [];
  pairs
    .flatMap((changes, parent) => changes.map((change) => ({ parent, change })))
    .sort(
      (a, b) =>
        a.change.after.start - b.change.after.start || a.change.after.end - b.change.after.end,
    )
    .forEach((entry) => {
      const last = groups.at(-1),
        range = entry.change.after;
      if (last && range.start <= last.after.end) {
        last.after.end = Math.max(last.after.end, range.end);
        last.members.push(entry);
      } else groups.push({ after: { ...range }, members: [entry] });
    });
  const changes = groups.map(({ after, members }) => {
    const parentRange = (parent: 0 | 1): MergeLineRange => {
      let start = transferLine(anchors[parent], after.start, 1);
      let end = transferLine(anchors[parent], after.end, 1);
      for (const entry of members) {
        if (entry.parent !== parent) continue;
        start = Math.min(start, entry.change.before.start);
        end = Math.max(end, entry.change.before.end);
      }
      return { start, end };
    };
    return [parentRange(0), after, parentRange(1)] as MergeLayout['changes'][number];
  });
  return {
    pairs,
    anchors,
    changes,
    sides: [
      shades(pairs[0].map((change) => ({ ...change.before, kind: change.kind }))),
      shades(
        pairs.flatMap((changes) =>
          changes.map((change) => ({ ...change.after, kind: change.kind })),
        ),
      ),
      shades(pairs[1].map((change) => ({ ...change.before, kind: change.kind }))),
    ],
  };
}
