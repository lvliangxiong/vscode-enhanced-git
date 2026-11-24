import type { Commit, GraphRow, GraphEdge } from './model';
/* Graph layout and visible-row ordering adapted from IntelliJ / Rebased.
 * Copyright 2000-2024 JetBrains s.r.o. and contributors, Apache-2.0.
 * See THIRD_PARTY_NOTICES.md for sources and modifications. */
// NaturalComparator uses character order for punctuation, not locale collation
// (notably feature-foo must sort before feature_bar).
function compareNames(a: string, b: string, ignoreCase = true) {
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (/[0-9]/.test(a[i]) && /[0-9]/.test(b[j])) {
      const aa = a.slice(i).match(/^\d+/)![0],
        bb = b.slice(j).match(/^\d+/)![0];
      const an = aa.replace(/^0+/, ''),
        bn = bb.replace(/^0+/, '');
      const difference =
        an.length - bn.length || (an < bn ? -1 : an > bn ? 1 : 0) || aa.length - bb.length;
      if (difference) return difference;
      i += aa.length;
      j += bb.length;
    } else {
      const ac = ignoreCase ? a[i].toUpperCase().toLowerCase() : a[i],
        bc = ignoreCase ? b[j].toUpperCase().toLowerCase() : b[j];
      if (ac !== bc) return ac < bc ? -1 : 1;
      i++;
      j++;
    }
  }
  return a.length - i - (b.length - j) || (ignoreCase ? compareNames(a, b, false) : 0);
}
function references(commit: Commit) {
  return (commit.decorations || '')
    .split(', ')
    .filter(Boolean)
    .flatMap((value) => value.split(' -> '))
    .map((value) => {
      const tag = value.startsWith('tag: ');
      value = value.replace(/^tag: /, '');
      const remote = value.startsWith('refs/remotes/');
      const local = value.startsWith('refs/heads/');
      const name = value.replace(/^refs\/(heads|remotes|tags)\//, '');
      const priority = remote
        ? /^origin\/(master|main)$/.test(name)
          ? 0
          : 1
        : local
          ? /^(master|main)$/.test(name)
            ? 2
            : 3
          : tag
            ? 4
            : name === 'HEAD'
              ? 6
              : 7;
      return { name, priority, branch: remote || local || name === 'HEAD' };
    })
    .sort((a, b) => a.priority - b.priority || compareNames(a.name, b.name));
}
function stringHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  return hash;
}
function layout(items: Commit[]) {
  const indices = new Map(items.map((c, i) => [c.hash, i]));
  const parents = items.map((c) =>
    [...new Set(c.parents)].map((p) => indices.get(p)).filter((p) => p !== undefined),
  );
  const hasChild = new Set(parents.flat()),
    refs = items.map(references);
  const heads = items
    .map((_, i) => i)
    .filter((i) => !hasChild.has(i) || refs[i].some((r) => r.branch));
  heads.sort((a, b) => {
    const ra = refs[a][0],
      rb = refs[b][0];
    return ra && rb
      ? ra.priority - rb.priority || compareNames(ra.name, rb.name) || a - b
      : ra
        ? -1
        : rb
          ? 1
          : a - b;
  });
  const ranks = new Uint32Array(items.length),
    colors = new Int32Array(items.length);
  let rank = 1;
  for (const head of heads) {
    if (ranks[head]) continue;
    const headRank = rank,
      headColor = refs[head][0] ? stringHash(refs[head][0].name) : rank;
    const stack = [head];
    while (stack.length) {
      const index = stack[stack.length - 1],
        first = !ranks[index];
      if (first) {
        ranks[index] = rank;
        colors[index] = rank === headRank ? headColor : rank;
      }
      const parent = parents[index].find((p) => !ranks[p]);
      if (parent === undefined) {
        if (first) rank++;
        stack.pop();
      } else stack.push(parent);
    }
  }
  return new Map(items.map((c, i) => [c.hash, { graphLayout: ranks[i], graphColor: colors[i] }]));
}
function color(colorId: number, light = false) {
  // Rebased DefaultColorGenerator, with the New UI theme's saturation/brightness.
  const rgb = [200, 130, 90].map(
    (factor, i) =>
      (Math.abs(((Math.imul(colorId, factor) + [30, 50, 100][i]) | 0) % 100) + 70) / 255,
  );
  const max = Math.max(...rgb),
    min = Math.min(...rgb),
    delta = max - min;
  let hue = 0;
  if (delta) {
    const [r, g, b] = rgb;
    hue =
      (max === r
        ? (g - b) / delta + (g < b ? 6 : 0)
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4) / 6;
  }
  const value = light ? 0.7 : 0.6,
    saturation = 0.6;
  const h = hue * 6,
    i = Math.floor(h),
    f = h - i,
    p = value * (1 - saturation),
    q = value * (1 - f * saturation),
    t = value * (1 - (1 - f) * saturation);
  return (
    '#' +
    [
      [value, t, p],
      [q, value, p],
      [p, value, t],
      [p, q, value],
      [t, p, value],
      [value, p, q],
    ][i % 6]
      .map((n) =>
        Math.round(n * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
/** A bounded LRU: scrolling never retains geometry for the entire history. */
class RowCache<T> {
  private values = new Map<number, T>();
  constructor(private capacity: number) {}
  get(key: number, create: () => T): T {
    let value = this.values.get(key);
    if (value !== undefined) this.values.delete(key);
    else value = create();
    this.values.set(key, value);
    if (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value);
    return value;
  }
  get size() {
    return this.values.size;
  }
}

/** Index edge intervals once; generate positions/segments only for requested rows.
 * Segment-tree buckets avoid scanning every edge or walking a long hidden span.
 * Updating the history creates a new index, invalidating unloaded-parent geometry.
 */
function createRows(items: Commit[], showLongEdges = false, capacity = 512) {
  capacity = Math.max(3, Math.floor(capacity));
  const count = items.length;
  const indices = new Map(items.map((c, i) => [c.hash, i]));
  const fallback = items.some((c) => c.graphLayout === undefined || c.graphColor === undefined)
    ? layout(items)
    : null;
  const ranks = items.map((c) => c.graphLayout ?? fallback!.get(c.hash)!.graphLayout);
  const colors = items.map((c) => c.graphColor ?? fallback!.get(c.hash)!.graphColor);
  const nodes = items.map((c, node) => ({ node, hash: c.hash }));
  const edges: GraphEdge[] = [];
  const buckets = new Map<number, number[]>();
  const size = 2 ** Math.ceil(Math.log2(Math.max(1, count)));
  const widthChanges = new Int32Array(count + 1);
  const longSize = showLongEdges ? 1000 : 30,
    part = showLongEdges ? 250 : 1;
  function interval(from: number, to: number, id: number) {
    for (let l = from + size, r = to + size; l <= r; l = Math.floor(l / 2), r = Math.floor(r / 2)) {
      const add = (key: number) => {
        const bucket = buckets.get(key);
        if (bucket) bucket.push(id);
        else buckets.set(key, [id]);
      };
      if (l % 2) add(l++);
      if (!(r % 2)) add(r--);
    }
    // Endpoints use the row's existing commit node, not another lane.
    const edge = edges[id],
      first = Math.max(from, edge.start + 1),
      last = Math.min(to, edge.end - 1);
    if (first <= last) {
      widthChanges[first]++;
      widthChanges[last + 1]--;
    }
  }
  items.forEach((commit, start) => {
    for (const hash of new Set([
      ...(commit.graphParents || commit.parents),
      ...(commit.graphUnloadedParents || []),
    ])) {
      const loadedEnd = indices.get(hash),
        unloaded = loadedEnd === undefined;
      const end = unloaded ? count : loadedEnd;
      if (end <= start) continue;
      const edge: GraphEdge = {
        start,
        end,
        unloaded,
        source: commit.hash,
        hash,
        dashed: !commit.parents.includes(hash),
        colorId: unloaded || ranks[start] >= ranks[end] ? colors[start] : colors[end],
        collapsed: end - start >= longSize,
      };
      const id = edges.push(edge) - 1;
      if (unloaded) interval(start, Math.min(start + 1, count - 1), id);
      else if (edge.collapsed) {
        interval(start, start + part, id);
        interval(end - part, end, id);
      } else interval(start, end, id);
    }
  });
  let active = 0,
    maxWidth = 1;
  for (let i = 0; i < count; i++) {
    active += widthChanges[i];
    maxWidth = Math.max(maxWidth, active + 1);
  }
  function edgesAt(index: number) {
    const ids: number[] = [];
    for (let key = index + size; key >= 1; key = Math.floor(key / 2)) {
      const bucket = buckets.get(key);
      if (bucket) for (const id of bucket) ids.push(id);
    }
    return ids.sort((a, b) => a - b).map((id) => edges[id]);
  }
  const edgeNode = (edge, node) =>
    Math.max(ranks[edge.start], ranks[edge.end] ?? ranks[edge.start]) - ranks[node] ||
    edge.start - node;
  function compare(a, b) {
    if (a.node !== undefined) return b.node !== undefined ? 0 : -edgeNode(b, a.node);
    if (b.node !== undefined) return edgeNode(a, b.node);
    if (a.start === b.start && (a.unloaded || b.unloaded))
      return Number(a.unloaded) - Number(b.unloaded) || a.hash.localeCompare(b.hash);
    if (a.start === b.start) return a.end < b.end ? -edgeNode(b, a.end) : edgeNode(a, b.end);
    return a.start < b.start ? edgeNode(a, b.start) : -edgeNode(b, a.start);
  }
  const positionCache = new RowCache<{
    elements: GraphRow['elements'];
    positions: Map<GraphRow['elements'][number], number>;
    lane: number;
    edges: GraphEdge[];
  }>(capacity);
  const rowCache = new RowCache<GraphRow>(capacity);
  function positions(index: number) {
    return positionCache.get(index, () => {
      const edges = edgesAt(index);
      const elements: GraphRow['elements'] = [
        nodes[index],
        ...edges.filter((e) => index > e.start && index < e.end),
      ];
      elements.sort(compare);
      return {
        elements,
        positions: new Map(elements.map((e, lane) => [e, lane])),
        lane: elements.indexOf(nodes[index]),
        edges,
      };
    });
  }
  function laneAt(edge: GraphEdge, index: number) {
    if (index < 0 || index >= count) return undefined;
    const row = positions(index);
    return index === edge.start || index === edge.end ? row.lane : row.positions.get(edge);
  }
  function get(index: number): GraphRow {
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new RangeError('Graph row outside history');
    return rowCache.get(index, () => {
      const current = positions(index);
      const row: GraphRow = {
        hash: items[index].hash,
        index,
        elements: current.elements,
        lane: current.lane,
        colorId: colors[index],
        segments: [],
        arrows: [],
      };
      for (const edge of current.edges) {
        if (edge.unloaded) {
          const start = edge.start,
            next = Math.min(start + 1, count - 1);
          const from = laneAt(edge, start),
            to = laneAt(edge, next),
            y = next === start ? 0.8 : 0.25;
          if (from === undefined || to === undefined) continue;
          if (next === start) row.segments.push({ edge, from, to, startY: 0.5, endY: y });
          else {
            const boundary = from + ((to - from) * 0.5) / 0.75;
            row.segments.push(
              index === start
                ? { edge, from, to: boundary, startY: 0.5, endY: 1 }
                : { edge, from: boundary, to, startY: 0, endY: y },
            );
          }
          if (index === next) row.arrows.push({ edge, lane: to, down: true, y });
          continue;
        }
        const yAt = (i: number) =>
          edge.collapsed && i === edge.start + part
            ? 0.25
            : edge.collapsed && i === edge.end - part
              ? 0.75
              : 0.5;
        for (const i of [index - 1, index]) {
          if (i < edge.start || i >= edge.end) continue;
          const from = laneAt(edge, i),
            to = laneAt(edge, i + 1);
          if (from === undefined || to === undefined) continue;
          const startY = yAt(i),
            endY = yAt(i + 1);
          const boundary = from + ((to - from) * (1 - startY)) / (1 + endY - startY);
          row.segments.push(
            i === index
              ? { edge, from, to: boundary, startY, endY: 1 }
              : { edge, from: boundary, to, startY: 0, endY },
          );
        }
        if (edge.collapsed || (showLongEdges && edge.end - edge.start >= 30)) {
          const offset = edge.collapsed ? part : 1;
          const lane = laneAt(edge, index);
          if (lane === undefined) continue;
          if (index === edge.start + offset) row.arrows.push({ edge, lane, down: true, y: 0.25 });
          if (index === edge.end - offset) row.arrows.push({ edge, lane, down: false, y: 0.75 });
        }
      }
      row.width = Math.max(
        recommended,
        row.elements.length,
        ...row.segments.map((s) => Math.max(s.from, s.to) + 1),
      );
      return row;
    });
  }
  // Reserve at most six baseline lanes; the interval sweep accounts for wider
  // rows without creating their geometry or letting lines overflow the column.
  const recommended = Math.min(6, maxWidth);
  return {
    get,
    length: count,
    maxWidth: Math.max(maxWidth, recommended),
    get cacheSize() {
      return rowCache.size;
    },
    get positionCacheSize() {
      return positionCache.size;
    },
  };
}

// Materialization is retained for topology tests and non-interactive consumers.
function rows(items: Commit[], showLongEdges = false) {
  const indexed = createRows(items, showLongEdges);
  return items.map((_, i) => indexed.get(i));
}

export { layout, rows, createRows, color };
