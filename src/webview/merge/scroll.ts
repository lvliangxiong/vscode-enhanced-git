import type { editor, IDisposable } from 'monaco-editor';
import { transferLine, type MergeLayout } from './layout';

/** Paint and scroll use the same real line boundaries, including the end of a model. */
export function boundaryTop(
  editor: editor.IStandaloneCodeEditor,
  line: number,
  lineHeight: number,
) {
  const count = editor.getModel().getLineCount();
  return line >= count
    ? editor.getTopForLineNumber(count) + (line - count + 1) * lineHeight
    : editor.getTopForLineNumber(Math.max(0, line) + 1);
}

export function createMergeScroll(
  editors: editor.IStandaloneCodeEditor[],
  layout: MergeLayout,
  lineHeight: () => number,
  repaint: () => void,
  aligned = false,
) {
  let syncing = false,
    active = 1,
    currentChange = -1;
  let navigationTop: number[] | undefined;
  const subscriptions: IDisposable[] = [];
  // Monaco may deliver a programmatic scroll event after setScrollTop returns.
  // Remember the applied (clamped/rounded) position, not just a synchronous guard.
  const driven = new Map<number, number>();
  const setTop = (side: number, top: number) => {
    const target = editors[side];
    if (Math.abs(target.getScrollTop() - top) < 0.5) return;
    driven.set(side, top);
    target.setScrollTop(top);
    driven.set(side, target.getScrollTop());
  };
  const syncFrom = (side: number) => {
    const source = editors[side],
      height = lineHeight();
    if (aligned) {
      editors.forEach((_, target) => {
        if (target !== side) setTop(target, source.getScrollTop());
      });
      return;
    }
    const shift = source.getLayoutInfo().height / 3;
    const position = Math.max(
      0,
      (source.getScrollTop() + shift - source.getTopForLineNumber(1)) / height,
    );
    const resultLine =
      side === 1 ? position : transferLine(layout.anchors[side === 0 ? 0 : 1], position, 0);
    editors.forEach((_, target) => {
      if (target === side) return;
      // Map the fractional line itself. Adding the source's pixel remainder after
      // clamping would make a stationary insertion point bounce once per line.
      const mapped =
        target === 1
          ? resultLine
          : transferLine(layout.anchors[target === 0 ? 0 : 1], resultLine, 1);
      const whole = Math.floor(mapped);
      setTop(
        target,
        Math.max(
          0,
          boundaryTop(editors[target], whole, height) + (mapped - whole) * height - shift,
        ),
      );
    });
  };
  const revealChange = (index: number, side = active) => {
    if (!layout.changes[index]) return;
    active = side;
    currentChange = index;
    const height = lineHeight(),
      ranges = layout.changes[index];
    const sharedTop = aligned
      ? Math.min(...ranges.map((range, pane) => boundaryTop(editors[pane], range.start, height)))
      : 0;
    syncing = true;
    try {
      ranges.forEach((range, pane) =>
        setTop(
          pane,
          Math.max(
            0,
            (aligned ? sharedTop : boundaryTop(editors[pane], range.start, height)) - 3 * height,
          ),
        ),
      );
    } finally {
      syncing = false;
    }
    navigationTop = editors.map((editor) => editor.getScrollTop());
    repaint();
    editors[active].focus();
  };
  editors.forEach((editor, side) => {
    subscriptions.push(
      editor.onDidFocusEditorText(() => {
        active = side;
      }),
    );
    subscriptions.push(
      editor.onDidScrollChange((event) => {
        repaint();
        if (syncing || !event.scrollTopChanged || event.scrollHeightChanged || event.heightChanged)
          return;
        const top = editor.getScrollTop();
        if (event.scrollTop !== undefined && Math.abs(event.scrollTop - top) >= 0.5) return;
        if (driven.has(side) && Math.abs(driven.get(side) - top) < 0.5) return;
        driven.delete(side);
        syncing = true;
        try {
          syncFrom(side);
        } finally {
          syncing = false;
        }
      }),
    );
  });
  return {
    revealChange,
    dispose() {
      subscriptions.forEach((subscription) => subscription.dispose());
      driven.clear();
    },
    navigate(direction: -1 | 1) {
      if (!layout.changes.length) return;
      const height = lineHeight();
      const current = aligned
        ? editors[active].getScrollTop()
        : (editors[active].getScrollTop() - editors[active].getTopForLineNumber(1)) / height;
      const position = (ranges: MergeLayout['changes'][number]) =>
        aligned
          ? Math.min(
              ...ranges.map((range, side) => boundaryTop(editors[side], range.start, height)),
            )
          : ranges[active].start;
      const tolerance = aligned ? height : 1;
      const atCurrent =
        currentChange >= 0 &&
        navigationTop?.every((top, side) => Math.abs(editors[side].getScrollTop() - top) < 1);
      if (atCurrent)
        currentChange = (currentChange + direction + layout.changes.length) % layout.changes.length;
      else if (direction === 1) {
        const next = layout.changes.findIndex((ranges) => position(ranges) > current + tolerance);
        currentChange = next < 0 ? 0 : next;
      } else {
        const previous = layout.changes.findLastIndex(
          (ranges) => position(ranges) < current - tolerance,
        );
        currentChange = previous < 0 ? layout.changes.length - 1 : previous;
      }
      revealChange(currentChange);
    },
  };
}
