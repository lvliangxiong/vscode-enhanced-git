import type { editor } from 'monaco-editor';
import type { MergeLayout, MergeLineRange } from './layout';
import { boundaryTop } from './scroll';

const namespace = 'http://www.w3.org/2000/svg';
export function connectorPath(left: number, right: number, a: MergeLineRange, b: MergeLineRange) {
  const middle = (left + right) / 2;
  return `M${left},${a.start} C${middle},${a.start} ${middle},${b.start} ${right},${b.start} L${right},${b.end} C${middle},${b.end} ${middle},${a.end} ${left},${a.end} Z`;
}

/** Stroke only the two curved boundaries, not the polygon's vertical closing edges. */
export function connectorBorders(
  left: number,
  right: number,
  a: MergeLineRange,
  b: MergeLineRange,
) {
  const middle = (left + right) / 2;
  return `M${left},${a.start} C${middle},${a.start} ${middle},${b.start} ${right},${b.start} M${right},${b.end} C${middle},${b.end} ${middle},${a.end} ${left},${a.end}`;
}

/** One viewport SVG paints only visible intervals; paths are reused while scrolling. */
export function createMergeConnectors(
  containers: HTMLElement[],
  editors: editor.IStandaloneCodeEditor[],
  layout: MergeLayout,
  lineHeight: () => number,
) {
  const root = containers[0].closest<HTMLElement>('.merge-panes');
  const svg = root.querySelector<SVGSVGElement>('.merge-connectors');
  const paths = new Map<string, SVGPathElement>();
  let frame = 0,
    disposed = false;
  const clips = editors.map((_, side) => {
    const clip = document.createElementNS(namespace, 'clipPath'),
      rect = document.createElementNS(namespace, 'rect');
    clip.id = `merge-clip-${side}`;
    clip.append(rect);
    svg.append(clip);
    return rect;
  });
  const groups = clips.map((clip) => {
    const group = document.createElementNS(namespace, 'g');
    group.setAttribute('clip-path', `url(#${clip.parentElement.id})`);
    svg.append(group);
    return group;
  });
  const paint = () => {
    frame = 0;
    if (disposed || !root.isConnected) return;
    const bounds = root.getBoundingClientRect(),
      height = lineHeight();
    const boxes = containers.map((container, side) => {
      const rect = container.getBoundingClientRect();
      return {
        left: rect.left - bounds.left,
        right: rect.right - bounds.left,
        top: rect.top - bounds.top,
        bottom: rect.bottom - bounds.top - editors[side].getLayoutInfo().horizontalScrollbarHeight,
      };
    });
    // A clip spans an editor body plus the next channel, so endpoint strokes cannot enter a header.
    boxes.forEach((box, side) => {
      const clip = clips[side];
      clip.setAttribute('x', String(box.left));
      clip.setAttribute('y', String(box.top));
      clip.setAttribute('width', String((boxes[side + 1]?.left ?? box.right) - box.left));
      clip.setAttribute('height', String(Math.max(0, box.bottom - box.top)));
    });
    const visible = new Set<string>();
    const path = (key: string, side: number, d: string, classes: string) => {
      visible.add(key);
      let element = paths.get(key);
      if (!element) {
        element = document.createElementNS(namespace, 'path');
        paths.set(key, element);
        groups[side].append(element);
      }
      element.setAttribute('d', d);
      element.setAttribute('class', classes);
      element.removeAttribute('display');
    };
    const rangeY = (side: number, range: MergeLineRange) => ({
      start:
        boxes[side].top +
        boundaryTop(editors[side], range.start, height) -
        editors[side].getScrollTop(),
      end:
        boxes[side].top +
        boundaryTop(editors[side], range.end, height) -
        editors[side].getScrollTop(),
    });
    layout.pairs.forEach((changes, pair) => {
      const parent = pair === 0 ? 0 : 2;
      const aSide = pair === 0 ? 0 : 1,
        bSide = pair === 0 ? 1 : 2;
      const visibleStart = [parent, 1].map(
        (side) => (editors[side].getScrollTop() - editors[side].getTopForLineNumber(1)) / height,
      );
      let low = 0,
        high = changes.length;
      while (low < high) {
        const middle = (low + high) >>> 1,
          change = changes[middle];
        if (change.before.end < visibleStart[0] && change.after.end < visibleStart[1])
          low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < changes.length; index++) {
        const change = changes[index],
          before = rangeY(parent, change.before),
          after = rangeY(1, change.after);
        if (before.start > boxes[parent].bottom && after.start > boxes[1].bottom) break;
        if (before.end < boxes[parent].top && after.end < boxes[1].top) continue;
        const a = pair === 0 ? before : after,
          b = pair === 0 ? after : before;
        path(
          `${pair}-${index}-link`,
          aSide,
          connectorPath(boxes[aSide].right, boxes[bSide].left, a, b),
          `merge-connector merge-${change.kind}-connector`,
        );
        path(
          `${pair}-${index}-border`,
          aSide,
          connectorBorders(boxes[aSide].right, boxes[bSide].left, a, b),
          `merge-connector-border merge-${change.kind}-edge`,
        );
        for (const [side, y] of [
          [parent, before],
          [1, after],
        ] as const) {
          // Empty ranges become a thin boundary, not a synthetic block of whitespace.
          const d =
            `M${boxes[side].left},${y.start} H${boxes[side].right}` +
            (y.end === y.start ? '' : ` M${boxes[side].left},${y.end} H${boxes[side].right}`);
          path(
            // Both parent links share the result boundary. Paint it once so
            // its opacity stays the same as the adjoining curved outlines.
            side === 1
              ? `result-${change.after.start}-${change.after.end}-${change.kind}-edge`
              : `${pair}-${index}-${side}-edge`,
            side,
            d,
            `merge-change-edge merge-${change.kind}-edge`,
          );
        }
      }
    });
    paths.forEach((element, key) => {
      if (!visible.has(key)) {
        element.remove();
        paths.delete(key);
      }
    });
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(paint);
  };
  const subscriptions = editors.map((editor) => editor.onDidLayoutChange(schedule));
  const dividers = [...root.querySelectorAll<HTMLElement>('.merge-sash')];
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const scale =
      event.deltaMode === 1
        ? lineHeight()
        : event.deltaMode === 2
          ? editors[1].getLayoutInfo().height
          : 1;
    const editor = editors[1];
    if (event.shiftKey)
      editor.setScrollLeft(editor.getScrollLeft() + (event.deltaY || event.deltaX) * scale);
    else {
      editor.setScrollTop(editor.getScrollTop() + event.deltaY * scale);
      editor.setScrollLeft(editor.getScrollLeft() + event.deltaX * scale);
    }
  };
  dividers.forEach((divider) => divider.addEventListener('wheel', wheel, { passive: false }));
  schedule();
  return {
    schedule,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      subscriptions.forEach((subscription) => subscription.dispose());
      dividers.forEach((divider) => divider.removeEventListener('wheel', wheel));
      paths.clear();
      svg.replaceChildren();
    },
  };
}
