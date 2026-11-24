import { memo, useLayoutEffect, useRef } from 'react';

/** Canvas owns only this isolated subtree; React never reconciles its pixels/hit targets. */
export const GraphTile = memo(
  function GraphTile({ graphKey, graph }: { graphKey: unknown; graph: () => HTMLElement }) {
    const host = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
      const element = host.current;
      if (!element) return;
      element.replaceChildren(graph());
      return () => element.replaceChildren();
    }, [graph, graphKey]);
    return <span ref={host} className="graph-mount" />;
  },
  (a, b) => a.graphKey === b.graphKey,
);
