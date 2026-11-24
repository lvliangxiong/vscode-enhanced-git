// Reference sizing follows JetBrains / Rebased LabelPainter and GraphCommitCellRenderer.
// Copyright JetBrains s.r.o. and contributors, Apache-2.0; see THIRD_PARTY_NOTICES.md.
import type { ReferenceGroup, ReferenceLabel } from './reference-labels';

// LabelIcon.SIZE is 6.25; its `2` offset is multiplied by height / SIZE.
// At our 16px icon height, adjacent tags move 5.12px, not 2px.
export const referenceIconStep = (16 / 6.25) * 2;
export const referenceIconGap = Math.SQRT2;

export function referenceIconWidth(refs: readonly ReferenceLabel[]) {
  const counts = new Map<string, number>();
  for (const ref of refs) counts.set(ref.kind, Math.min(2, (counts.get(ref.kind) ?? 0) + 1));
  const count = [...counts.values()].reduce((total, value) => total + value, 0);
  return Math.round(16 + Math.max(0, count - 1) * referenceIconStep);
}

export function referenceWidthBudget(
  available: number,
  subject: number,
  compact: boolean,
  left: boolean,
) {
  const width = Math.max(0, available);
  const free = left ? width : width - subject;
  return Math.max(0, compact ? Math.min(free, width / 3) : Math.max(free, width / 2, width - 80));
}

/** Rebased LabelPainter preserves short names and a 22-character floor for long names. */
export function shortenReferenceName(
  name: string,
  width: number,
  measure: (text: string) => number,
) {
  if (name.length <= 22 || measure(name) <= width) return name;
  const slash = name.indexOf('/');
  const shortened = slash > 2 ? '..' + name.slice(slash) : name;
  if (measure(shortened) <= width) return shortened;
  for (let length = shortened.length - 1; length >= 22; length--) {
    const text = shortened.slice(0, length - 1) + '…';
    if (measure(text) <= width || length === 22) return text;
  }
  return shortened;
}

/** Allocate labels sequentially; overflow references retain their stacked icon and full hover data. */
export function layoutReferenceGroups(
  groups: ReferenceGroup[],
  width: number,
  compact: boolean,
  measure: (text: string) => number,
): ReferenceGroup[] {
  const result: ReferenceGroup[] = [];
  const gap = compact ? 6 : 12;
  const available = Math.max(0, width - 8);
  let used = 0;
  for (const [index, group] of groups.entries()) {
    const rest = groups.slice(index + 1).flatMap((item) => item.refs);
    const reserved = !compact && rest.length ? referenceIconWidth(rest) : 0;
    const icon = referenceIconWidth(group.refs);
    const spacing = rest.length ? gap : 0;
    const name = shortenReferenceName(
      group.name,
      available - used - icon - 3 - spacing - reserved,
      measure,
    );
    const size = icon + (name ? 3 + measure(name) : 0) + spacing;
    if (!compact && used + size + reserved > available) {
      result.push({
        name: result.length ? '' : name,
        refs: groups.slice(index).flatMap((item) => item.refs),
      });
      break;
    }
    result.push({ ...group, name });
    used += size;
  }
  return result;
}
