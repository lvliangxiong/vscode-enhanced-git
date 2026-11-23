export type MergePaneWidths = [number, number, number];
export const equalPaneWidths: MergePaneWidths = [1 / 3, 1 / 3, 1 / 3];
export const mergeSashWidth = 28;
export const mergePaneMinimum = 120;

export function restorePaneWidths(value: unknown): MergePaneWidths {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((n) => Number.isFinite(n) && n > 0)
  )
    return [...equalPaneWidths];
  const total = value.reduce((sum, n) => sum + n, 0);
  return Number.isFinite(total)
    ? (value.map((n) => n / total) as MergePaneWidths)
    : [...equalPaneWidths];
}

/** Keep every pane usable, including when an editor group becomes very narrow. */
export function fitPaneWidths(widths: MergePaneWidths, available: number): MergePaneWidths {
  if (available <= 0) return widths;
  const minimum = Math.min(mergePaneMinimum / available, 1 / 3);
  const fitted = widths.map((width) => Math.max(minimum, width));
  const excess = fitted.reduce((sum, width) => sum + width, 0) - 1;
  const free = fitted.reduce((sum, width) => sum + width - minimum, 0);
  return fitted.map((width) =>
    free > 0 ? width - (excess * (width - minimum)) / free : 1 / 3,
  ) as MergePaneWidths;
}

/** Only the two panes beside a sash trade width; the other pane stays fixed. */
export function movePaneSash(
  widths: MergePaneWidths,
  side: 0 | 1,
  delta: number,
  available: number,
): MergePaneWidths {
  if (available <= 0) return widths;
  const minimum = Math.min(mergePaneMinimum / available, 1 / 3);
  const change = Math.max(
    minimum - widths[side],
    Math.min(widths[side + 1] - minimum, delta / available),
  );
  const next: MergePaneWidths = [...widths];
  next[side] += change;
  next[side + 1] -= change;
  return next;
}
