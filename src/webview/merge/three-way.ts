import type { MergeDiffData } from '../../shared/merge-diff';
import type { MergeChangeKind, MergeLayout, MergeLineRange } from './layout';

/** Rebased's MERGE_RESULT mode: classify one shared fragment, rather than
 * assigning independent two-way colors to each parent/result comparison.
 * See ComparisonMergeUtil and MergeRangeUtil in THIRD_PARTY_NOTICES.md.
 */
export function mergeResultLayout(data: MergeDiffData, source: MergeLayout): MergeLayout {
  const lines = data.contents.map((text) => text.split('\n'));
  const pairs: MergeLayout['pairs'] = [[], []];
  const sides: MergeLayout['sides'] = [[], [], []];
  for (const ranges of source.changes) {
    const empty = (side: number) => ranges[side].start === ranges[side].end;
    const equal = (a: number, b: number) => {
      const left = ranges[a],
        right = ranges[b];
      const count = left.end - left.start;
      if (count !== right.end - right.start) return false;
      for (let i = 0; i < count; i++)
        if (lines[a][left.start + i] !== lines[b][right.start + i]) return false;
      return true;
    };
    const changed = [!equal(0, 1), !equal(2, 1)];
    let kind: MergeChangeKind;
    if (empty(1)) {
      kind = empty(0) || empty(2) || equal(0, 2) ? 'deleted' : 'conflict';
    } else if (empty(0) && empty(2)) {
      kind = 'inserted';
    } else if (!changed[0]) {
      kind = empty(2) ? 'inserted' : 'modified';
    } else if (!changed[1]) {
      kind = empty(0) ? 'inserted' : 'modified';
    } else {
      kind = equal(0, 2) ? 'modified' : 'conflict';
    }
    const shade = (side: number, range: MergeLineRange) => {
      if (range.start !== range.end) sides[side].push({ ...range, kind });
    };
    if (!changed.some(Boolean)) continue;
    shade(1, ranges[1]);
    changed.forEach((value, parent) => {
      if (!value) return;
      const side = parent === 0 ? 0 : 2;
      pairs[parent].push({ before: ranges[side], after: ranges[1], kind });
      shade(side, ranges[side]);
    });
  }
  // Keep the exact pairwise anchors for scrolling and Native Style alignment.
  return { ...source, pairs, sides };
}
