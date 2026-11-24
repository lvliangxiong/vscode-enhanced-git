import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from 'react';
import {
  fitPaneWidths,
  mergePaneMinimum,
  mergeSashWidth,
  movePaneSash,
  restorePaneWidths,
  type MergePaneWidths,
} from '../merge/pane-widths';

export function MergePanes({
  children,
  initialWidths,
  onWidthsChange,
  sashWidth = mergeSashWidth,
}: {
  children: ReactNode[];
  initialWidths?: unknown;
  onWidthsChange?: (widths: MergePaneWidths) => void;
  sashWidth?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState(() => restorePaneWidths(initialWidths));
  const [available, setAvailable] = useState(0);
  const [dragging, setDragging] = useState<0 | 1 | null>(null);
  const drag = useRef<{
    pointer: number;
    side: 0 | 1;
    start: number;
    available: number;
    widths: MergePaneWidths;
    original: MergePaneWidths;
    current: MergePaneWidths;
  }>(null);
  const frame = useRef(0);
  const fitted = fitPaneWidths(widths, available);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () =>
      setAvailable(Math.max(0, element.getBoundingClientRect().width - sashWidth * 2));
    measure();
    const observer = new window.ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame.current);
    };
  }, [sashWidth]);
  const finish = useCallback(
    (cancel = false) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      window.cancelAnimationFrame(frame.current);
      setWidths(cancel ? current.original : current.current);
      setDragging(null);
      if (!cancel) onWidthsChange?.(current.current);
    },
    [onWidthsChange],
  );
  useEffect(() => {
    const stop = () => finish();
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, [finish]);
  const move = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    current.current = movePaneSash(
      current.widths,
      current.side,
      event.clientX - current.start,
      current.available,
    );
    window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => setWidths(current.current));
  };
  const commit = (next: MergePaneWidths) => {
    setWidths(next);
    onWidthsChange?.(next);
  };
  return (
    <div
      className={`merge-panes${dragging !== null ? ' merge-panes-resizing' : ''}`}
      ref={root}
      style={{
        gridTemplateColumns: fitted
          .map((width) => `minmax(0, ${width}fr)`)
          .join(` ${sashWidth}px `),
      }}
    >
      {children.map((child, index) => (
        <Fragment key={index}>
          {child}
          {index < 2 && (
            <div
              className={`merge-sash${dragging === index ? ' dragging' : ''}`}
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label={
                index === 0
                  ? 'Resize Parent 1 and Merge Result'
                  : 'Resize Merge Result and Parent 2'
              }
              aria-valuenow={Math.round(fitted[index] * 100)}
              aria-valuemin={
                available ? Math.round(Math.min(mergePaneMinimum / available, 1 / 3) * 100) : 0
              }
              aria-valuemax={Math.round(
                (fitted[index] +
                  fitted[index + 1] -
                  (available ? Math.min(mergePaneMinimum / available, 1 / 3) : 0)) *
                  100,
              )}
              title="Drag to resize · Double-click to balance"
              onPointerDown={(event) => {
                if (event.button !== 0 || drag.current) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  pointer: event.pointerId,
                  side: index as 0 | 1,
                  start: event.clientX,
                  available,
                  widths: fitted,
                  original: widths,
                  current: fitted,
                };
                setDragging(index as 0 | 1);
              }}
              onPointerMove={move}
              onPointerUp={(event) => {
                if (event.pointerId === drag.current?.pointer) {
                  move(event);
                  finish();
                }
              }}
              onPointerCancel={() => finish(true)}
              onLostPointerCapture={() => finish()}
              onDoubleClick={() => {
                const next: MergePaneWidths = [...fitted];
                next[index] = next[index + 1] = (fitted[index] + fitted[index + 1]) / 2;
                commit(next);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && drag.current) {
                  event.preventDefault();
                  finish(true);
                  return;
                }
                if (drag.current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                  return;
                event.preventDefault();
                const delta =
                  event.key === 'Home'
                    ? -available
                    : event.key === 'End'
                      ? available
                      : (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 64 : 16);
                commit(movePaneSash(fitted, index as 0 | 1, delta, available));
              }}
            />
          )}
        </Fragment>
      ))}
      <svg className="merge-connectors" aria-hidden="true" />
    </div>
  );
}
