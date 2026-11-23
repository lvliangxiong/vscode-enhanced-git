import { color as graphColor } from '../../shared/graph';
import type { Commit, GraphRow } from '../../shared/model';
import type { LogContext, LogEnvironment } from './context';

export interface GraphController {
  start(): void;
  dispose(): void;
  graphCell(
    row: GraphRow,
    navigate?: (hash: string, edge: { source: string; parent: string }) => void,
    rowHeight?: number,
    resolveCommit?: (hash: string) => Commit,
    laneHeight?: number,
  ): HTMLElement;
  rowGraphWidth(row: GraphRow, rowHeight: number): number;
  repaintGraphCanvases(list?: HTMLElement): void;
  setWidth(width: number): void;
  getWidth(): number;
  setHover(color?: number, arrow?: Element): void;
  hitCell(cell: Element, x: number, y: number): number | undefined;
}

/** Per-pane Canvas resources; pixels and hit tests stay outside React reconciliation. */
export function createGraphController(ctx: LogContext): GraphController {
  return createGraphRenderer(
    ctx.env,
    () => ctx.actions.columns.getRuleStyle(),
    () => ctx.env.$('commits'),
  );
}

/** The same Canvas tiles can be hosted by a log pane or a standalone sidebar. */
export function createGraphRenderer(
  env: Pick<LogEnvironment, 'document' | 'window' | 'el'>,
  ruleStyle: () => CSSStyleDeclaration,
  defaultList: () => HTMLElement,
): GraphController {
  const { document, window, el } = env;
  const getComputedStyle = window.getComputedStyle.bind(window);
  const Path2D = (window as Window & typeof globalThis).Path2D;
  function lightGraphTheme() {
    return Boolean(
      document.body?.classList.contains('vscode-light') ||
      document.body?.classList.contains('vscode-high-contrast-light'),
    );
  }
  // Only mounted row tiles own Canvas buffers. The invisible SVG overlay contains
  // accessible arrow hit targets and temporary jump feedback, never edge lines.
  let graphCanvasWidth = 20;
  let graphCanvasLeft = 0;
  let graphCanvasViewportWidth = 20;
  let graphHoverColor: number;
  let graphHoverArrow: Element;
  let graphHighlightColor = '#888888';
  const canvasGraphCells = new WeakMap<
    Element,
    { paint: () => void; hit: (x: number, y: number) => number }
  >();
  function rowGraphWidth(g: GraphRow, rowHeight: number) {
    // Fixed lane spacing; only the row's actual extent determines the text inset.
    return Math.ceil(((g.width * 16 + 2) * rowHeight) / 22);
  }
  function repaintGraphCanvases(list = defaultList()) {
    const first = list.querySelector('.graph-cell');
    if (!first) return;
    const bounds = first.getBoundingClientRect(),
      viewport = first.closest('.subject-content').getBoundingClientRect();
    // Very wide graphs still allocate only a viewport-sized bitmap per row.
    const left = Math.max(
      0,
      Math.min(graphCanvasWidth - 1, Math.floor(viewport.left - bounds.left)),
    );
    const width = Math.max(
      1,
      Math.min(
        graphCanvasWidth - left,
        Math.ceil(viewport.right - Math.max(bounds.left, viewport.left)),
      ),
    );
    const style = ruleStyle();
    if (left !== graphCanvasLeft) style.setProperty('--graph-canvas-left', `${left}px`);
    if (width !== graphCanvasViewportWidth) style.setProperty('--graph-canvas-width', `${width}px`);
    graphCanvasLeft = left;
    graphCanvasViewportWidth = width;
    graphHighlightColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-editor-foreground')
        .trim() || '#888888';
    for (const cell of list.querySelectorAll('.graph-cell')) canvasGraphCells.get(cell)?.paint();
  }
  function graphCell(
    g: GraphRow,
    navigate: (hash: string, edge: { source: string; parent: string }) => void = () => {},
    rowHeight = 24,
    resolveCommit: (hash: string) => Commit = () => undefined,
    laneHeight = rowHeight,
  ) {
    const cell = el('span', undefined, 'graph-cell');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const center = rowHeight / 2,
      laneWidth = (16 * laneHeight) / 22,
      radius = (4 * laneHeight) / 22;
    const ns = 'http://www.w3.org/2000/svg',
      svg = document.createElementNS(ns, 'svg');
    const light = lightGraphTheme();
    const color = (id) => graphColor(id, light),
      x = (lane) => (lane + 0.5) * laneWidth;
    svg.setAttribute('width', String(rowGraphWidth(g, laneHeight)));
    svg.setAttribute('height', String(rowHeight));
    svg.setAttribute('aria-hidden', 'false');
    const arrowPaints: { group: SVGGElement; path: Path2D; colorId: number }[] = [];
    for (const { edge, lane, down, y: relativeY } of g.arrows) {
      const target = down ? edge.hash : edge.source,
        y = relativeY * rowHeight;
      const segment = g.segments.find(
        (s) => s.edge === edge && s.startY <= relativeY && s.endY >= relativeY,
      );
      const slope = segment
        ? ((segment.to - segment.from) * laneWidth) / ((segment.endY - segment.startY) * rowHeight)
        : 0;
      const arrowX = segment
        ? x(segment.from) + slope * (relativeY - segment.startY) * rowHeight
        : x(lane);
      const back = (down ? -1 : 1) / Math.hypot(slope, 1),
        dx = slope * back,
        dy = back;
      const length = rowHeight * 0.3,
        cos = Math.sqrt(0.7),
        sin = Math.sqrt(0.3);
      const wing1 = [arrowX + length * (dx * cos - dy * sin), y + length * (dy * cos + dx * sin)];
      const wing2 = [arrowX + length * (dx * cos + dy * sin), y + length * (dy * cos - dx * sin)];
      const group = document.createElementNS(ns, 'g');
      group.setAttribute('data-graph-color', String(edge.colorId));
      group.setAttribute('class', 'graph-jump');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('data-edge-source', String(edge.source));
      group.setAttribute('data-edge-parent', String(edge.hash));
      group.setAttribute('data-target', String(target));
      const destination = resolveCommit(target);
      const label = destination
        ? `Jump to "${destination.subject}" by ${destination.author} on ${new Date(destination.authorDate || destination.date).toLocaleString()}`
        : `Jump to commit ${target.slice(0, 8)} (load and reveal)`;
      group.setAttribute('aria-label', String(label));
      const hit = document.createElementNS(ns, 'rect');
      hit.setAttribute('x', String(arrowX - 7));
      hit.setAttribute('y', String(y - 4));
      hit.setAttribute('width', String(14));
      hit.setAttribute('height', String(8));
      hit.setAttribute('fill', 'transparent');
      group.append(hit);
      const p = document.createElementNS(ns, 'path');
      p.setAttribute(
        'd',
        String(`M ${wing1[0]} ${wing1[1]} L ${arrowX} ${y} L ${wing2[0]} ${wing2[1]}`),
      );
      p.setAttribute('class', 'graph-arrow-shape');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', String(color(edge.colorId)));
      p.setAttribute('stroke-width', String((1.5 * laneHeight) / 22));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      group.append(p);
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate(target, { source: edge.source, parent: edge.hash });
      };
      group.onclick = activate;
      group.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      group.ondblclick = (event) => event.stopPropagation();
      group.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      };
      arrowPaints.push({ group, path: new Path2D(p.getAttribute('d')), colorId: edge.colorId });
      svg.append(group);
    }
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('data-graph-color', String(g.colorId));
    circle.setAttribute('class', 'graph-node');
    circle.setAttribute('cx', String(x(g.lane)));
    circle.setAttribute('cy', String(center));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', String(color(g.colorId)));
    svg.append(circle);
    cell.append(canvas, svg);
    const paint = () => {
      const width = graphCanvasViewportWidth,
        ratio = window.devicePixelRatio || 1;
      // Extra half-row above and below keeps diagonal arrow wings intact.
      const pixelWidth = Math.ceil(width * ratio),
        pixelHeight = Math.ceil(rowHeight * 2 * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, -graphCanvasLeft * ratio, (rowHeight / 2) * ratio);
      ctx.clearRect(graphCanvasLeft, -rowHeight / 2, width, rowHeight * 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const color = (id: number) => graphColor(id, lightGraphTheme());
      for (const segment of g.segments) {
        const { edge, from, to, startY, endY } = segment;
        ctx.strokeStyle = color(edge.colorId);
        ctx.lineWidth = ((graphHoverColor === edge.colorId ? 3 : 1.5) * laneHeight) / 22;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        if (edge.dashed) {
          const length =
            Math.hypot((to - from) * laneWidth, (endY - startY) * rowHeight) / (endY - startY);
          const gap = rowHeight / 2 - 2,
            dash = length / Math.max(1, Math.floor(length / rowHeight)) - gap;
          ctx.setLineDash([dash, gap]);
          ctx.lineDashOffset = dash / 2 + (startY - 0.5) * length;
        }
        ctx.beginPath();
        ctx.moveTo(x(from), startY * rowHeight);
        ctx.lineTo(x(to), endY * rowHeight);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      for (const arrow of arrowPaints) {
        if (arrow.group === graphHoverArrow) {
          ctx.lineWidth = (2.5 * laneHeight) / 22;
          ctx.strokeStyle = graphHighlightColor;
          ctx.stroke(arrow.path);
        }
        const stroke = color(arrow.colorId);
        ctx.lineWidth = (1.5 * laneHeight) / 22;
        ctx.strokeStyle = stroke;
        ctx.stroke(arrow.path);
        const shape = arrow.group.querySelector('.graph-arrow-shape');
        if (shape.getAttribute('stroke') !== stroke) shape.setAttribute('stroke', stroke);
      }
      ctx.beginPath();
      ctx.arc(x(g.lane), center, radius, 0, Math.PI * 2);
      ctx.fillStyle = color(g.colorId);
      ctx.fill();
      if (circle.getAttribute('fill') !== ctx.fillStyle) circle.setAttribute('fill', ctx.fillStyle);
      if (graphHoverColor === g.colorId) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = graphHighlightColor;
        ctx.stroke();
      }
    };
    const hit = (px: number, py: number) => {
      if (px < 0 || px >= cell.getBoundingClientRect().width) return undefined;
      if (Math.hypot(px - x(g.lane), py - center) <= radius + 2) return g.colorId;
      let closest = 4,
        colorId: number;
      for (const { edge, from, to, startY, endY } of g.segments) {
        const ax = x(from),
          ay = startY * rowHeight,
          dx = x(to) - ax,
          dy = (endY - startY) * rowHeight;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        const distance = Math.hypot(px - ax - t * dx, py - ay - t * dy);
        if (distance <= closest) {
          closest = distance;
          colorId = edge.colorId;
        }
      }
      return colorId;
    };
    canvasGraphCells.set(cell, { paint, hit });
    paint();
    return cell;
  }

  return {
    start() {},
    dispose() {
      graphHoverArrow = undefined;
      graphHoverColor = undefined;
    },
    graphCell,
    rowGraphWidth,
    repaintGraphCanvases,
    setWidth(width) {
      graphCanvasWidth = width;
    },
    getWidth: () => graphCanvasWidth,
    setHover(color, arrow) {
      if (graphHoverColor === color && graphHoverArrow === arrow) return;
      graphHoverColor = color;
      graphHoverArrow = arrow;
      repaintGraphCanvases();
    },
    hitCell: (cell, x, y) => canvasGraphCells.get(cell)?.hit(x, y),
  };
}
