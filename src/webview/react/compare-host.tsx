import { useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

export interface ComparisonHostState {
  split: number;
  dragging: boolean;
}
export function CompareHost({
  store,
  sheet,
  window,
  resize,
  save,
}: {
  store: StoreApi<ComparisonHostState>;
  sheet: CSSStyleSheet;
  window: Window;
  resize(value: number): void;
  save(force?: boolean): void;
}) {
  const split = useStore(store, (state) => state.split);
  const dragging = useStore(store, (state) => state.dragging);
  const style = useRef<CSSStyleDeclaration>(null);
  useLayoutEffect(() => {
    style.current ??= (
      sheet.cssRules[sheet.insertRule('#host-app {}', sheet.cssRules.length)] as CSSStyleRule
    ).style;
    style.current.gridTemplateRows = `minmax(0,${split}fr) 4px minmax(0,${1 - split}fr)`;
  }, [sheet, split]);
  return (
    <>
      <div className="log-pane" data-pane="0" aria-label="First comparison unique commits" />
      <div
        id="sash"
        role="separator"
        aria-label="Comparison logs height"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(split * 100)}
        aria-valuemin={15}
        aria-valuemax={85}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          store.setState({ dragging: true });
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (dragging) resize(event.clientY / window.innerHeight);
        }}
        onPointerUp={() => save()}
        onPointerCancel={() => save()}
        onLostPointerCapture={() => save()}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
          event.preventDefault();
          resize(event.key === 'Home' ? 0.5 : split + (event.key === 'ArrowDown' ? 0.02 : -0.02));
          save(true);
        }}
      />
      <div className="log-pane" data-pane="1" aria-label="Second comparison unique commits" />
    </>
  );
}
