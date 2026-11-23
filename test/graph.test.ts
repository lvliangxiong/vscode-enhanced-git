import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createGraphController } from '../src/webview/log/graph-render';
import { rows as graphRows, layout as graphLayout, createRows } from '../src/shared/graph';
function node(tag, text?, cls?) {
  const n = {
    tag,
    attributes: { class: cls },
    children: [],
    ctx: undefined,
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    getAttribute(key) {
      return this.attributes[key];
    },
    querySelector(selector) {
      return this.children.find((child) => child.attributes.class === selector.slice(1));
    },
    append(...children) {
      this.children.push(...children);
    },
    getBoundingClientRect() {
      return { left: 0, right: 1000, width: 1000 };
    },
    closest() {
      return this;
    },
    getContext() {
      return this.ctx;
    },
  };
  if (tag === 'canvas') {
    let points = [],
      dash = [];
    n.ctx = {
      lines: [],
      arrowStrokes: [],
      setTransform() {},
      clearRect() {},
      arc() {},
      fill() {},
      setLineDash(value) {
        dash = value;
      },
      beginPath() {
        points = [];
      },
      moveTo(x, y) {
        points.push(x, y);
      },
      lineTo(x, y) {
        points.push(x, y);
      },
      stroke(path?) {
        if (path) {
          this.arrowStrokes.push({ path: path.path, width: this.lineWidth });
          return;
        }
        if (points.length !== 4) return;
        this.lines.push({
          attributes: {
            d: `M ${points[0]} ${points[1]} L ${points[2]} ${points[3]}`,
            'stroke-dasharray': dash.length ? dash.join(' ') : undefined,
          },
        });
      },
    };
  }
  return n;
}
const document = { createElementNS: (_ns, tag) => node(tag), createElement: node };
let hoverCell;
const graphController = createGraphController({
  env: {
    document,
    el: node,
    $: () => ({ querySelector: () => hoverCell, querySelectorAll: () => [hoverCell] }),
    window: {
      devicePixelRatio: 2,
      Path2D: class {
        constructor(public path: string) {}
      },
      getComputedStyle: () => ({ getPropertyValue: () => '24' }),
    },
  },
  actions: { columns: { getRuleStyle: () => ({ setProperty() {} }) } },
} as any);
const graphCell = (...args: Parameters<typeof graphController.graphCell>) =>
  graphController.graphCell(...args) as any;
const paintHover = (cell, arrow) => {
  hoverCell = cell;
  graphController.setHover(undefined, arrow);
};
const svgGraph = (...args: Parameters<typeof graphController.graphCell>) =>
  graphCell(...args).children.find((n) => n.tag === 'svg');
const paths = (row) => graphCell(row).children.find((n) => n.tag === 'canvas').ctx.lines;
test('hidden ancestors render dashed across intervening rows and into the destination', () => {
  const rows = graphRows([
    { hash: 'a', parents: ['hidden'], graphParents: ['d'] },
    { hash: 'b', parents: ['c'] },
    { hash: 'c', parents: [] },
    { hash: 'd', parents: [] },
  ]);
  assert.match(paths(rows[0])[0].attributes['stroke-dasharray'], /^[\d.]+ 10$/);
  for (const index of [1, 2])
    assert.equal(paths(rows[index]).filter((p) => p.attributes['stroke-dasharray']).length, 2);
  assert.match(paths(rows[3])[0].attributes['stroke-dasharray'], /^[\d.]+ 10$/);
  assert.ok(rows[3].segments.every((s) => s.endY <= 0.5));
});
test('filtered graphs retain solid direct parents and dashed skipped merge parents', () => {
  const rows = graphRows([
    { hash: 'merge', parents: ['direct', 'hidden'], graphParents: ['direct', 'ancestor'] },
    { hash: 'direct', parents: ['ancestor'] },
    { hash: 'ancestor', parents: [] },
  ]);
  const outgoing = paths(rows[0]);
  assert.equal(outgoing[0].attributes['stroke-dasharray'], undefined);
  assert.equal(outgoing[1].attributes['stroke-dasharray'], '14 10');
  assert.equal(paths(rows[1])[0].attributes['stroke-dasharray'], undefined);
  assert.ok(rows[2].segments.every((s) => s.endY <= 0.5));
});
test('unloaded parents end in a clickable arrow inside the last row', () => {
  const rows = graphRows([
    { hash: 'a', parents: ['b'] },
    { hash: 'b', parents: ['unloaded'] },
  ]);
  for (const row of rows)
    for (const p of paths(row)) assert.equal(p.attributes['stroke-dasharray'], undefined);
  assert.ok(rows[1].segments.every((s) => s.endY <= 1));
  assert.equal(rows[1].arrows[0].edge.hash, 'unloaded');
  assert.equal(rows[1].arrows[0].y, 0.8);
  const jumps = [];
  svgGraph(rows[1], (hash) => jumps.push(hash))
    .children.find((n) => n.attributes.class === 'graph-jump')
    .onclick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(jumps, ['unloaded']);
});
const { filteredGraph } = require('../out/extension/git/index');
test('hidden merges keep a sparse chain instead of connecting every reachable visible ancestor', () => {
  const topology = [];
  for (let i = 0; i < 80; i++) {
    topology.push({ hash: `v${i}`, parents: i < 79 ? [`h${i}`] : [] });
    if (i < 79)
      topology.push({ hash: `h${i}`, parents: [`v${i + 1}`, ...(i < 78 ? [`h${i + 1}`] : [])] });
  }
  const result = filteredGraph(
    topology.filter((c) => c.hash.startsWith('v')),
    topology,
  );
  for (let i = 0; i < 79; i++) assert.deepEqual(result[i].graphParents, [`v${i + 1}`]);
  assert.deepEqual(result.at(-1).graphParents, []);
  const rows = graphRows(result);
  assert.ok(rows.every((r) => r.elements.length <= 1));
});
test('hidden merge preserves independent visible parents and their common ancestor', () => {
  const topology = [
    { hash: 'm', parents: ['h'] },
    { hash: 'h', parents: ['a', 'b'] },
    { hash: 'a', parents: ['r'] },
    { hash: 'b', parents: ['r'] },
    { hash: 'r', parents: [] },
  ];
  const result = filteredGraph(
    topology.filter((c) => c.hash !== 'h'),
    topology,
  );
  assert.deepEqual(new Set(result[0].graphParents), new Set(['a', 'b']));
  assert.deepEqual(result[1].graphParents, ['r']);
  assert.deepEqual(result[2].graphParents, ['r']);
  assert.deepEqual(result[3].graphParents, []);
});

test('compact graph joins row boundaries at 24px with centered commit nodes', () => {
  const rows = graphRows([
    { hash: 'a', parents: ['b'] },
    { hash: 'b', parents: [] },
  ]);
  const first = svgGraph(rows[0]),
    second = svgGraph(rows[1]);
  assert.equal(first.attributes.height, '24');
  assert.equal(first.children.find((n) => n.tag === 'circle').attributes.cy, '12');
  assert.match(paths(rows[0])[0].attributes.d, / 24$/);
  assert.match(paths(rows[1])[0].attributes.d, / 0 L [\d.]+ 12$/);
});

test('collapsed long-edge arrows navigate to opposite endpoints by mouse and keyboard', () => {
  const items = Array.from({ length: 35 }, (_, i) => ({
    hash: `commit${i}`,
    parents: i === 0 ? ['commit34'] : [],
  }));
  const rows = graphRows(items),
    jumps = [],
    edges = [];
  const arrows = (index) =>
    svgGraph(rows[index], (hash, edge) => {
      jumps.push(hash);
      edges.push(edge);
    }).children.filter((n) => n.attributes.class === 'graph-jump');
  assert.equal(arrows(1).length, 1);
  assert.equal(arrows(33).length, 1);
  assert.equal(arrows(15).length, 0);
  assert.equal(
    svgGraph(graphRows(items, true)[1]).children.filter((n) => n.attributes.class === 'graph-jump')
      .length,
    1,
  );
  assert.ok(graphRows(items, true)[15].segments.length > 0);
  let prevented = 0,
    stopped = 0;
  const event = {
    preventDefault() {
      prevented++;
    },
    stopPropagation() {
      stopped++;
    },
  };
  arrows(1)[0].onclick(event);
  arrows(33)[0].onkeydown({ ...event, key: 'Enter' });
  arrows(33)[0].onkeydown({ ...event, key: ' ' });
  arrows(1)[0].onkeydown({ ...event, key: 'Tab' });
  assert.deepEqual(jumps, ['commit34', 'commit0', 'commit0']);
  assert.ok(edges.every((edge) => edge.source === 'commit0' && edge.parent === 'commit34'));
  assert.equal(arrows(33)[0].attributes['data-target'], 'commit0');
  assert.equal(arrows(33)[0].attributes['data-edge-source'], 'commit0');
  assert.equal(arrows(33)[0].attributes['data-edge-parent'], 'commit34');
  assert.equal(prevented, 3);
  assert.equal(stopped, 3);
});

test('skipped ancestry arrows retain endpoint hashes when a lane is reused', () => {
  const items = Array.from(
    { length: 35 },
    (_, i): { hash: string; parents: string[]; graphParents?: string[] } => ({
      hash: `c${i}`,
      parents: [],
    }),
  );
  items[0] = { hash: 'c0', parents: ['hidden'], graphParents: ['c34'] };
  items[10].parents = ['c34'];
  const rows = graphRows(items),
    jumps = [];
  const arrow = svgGraph(rows[33], (hash) => jumps.push(hash)).children.find(
    (n) => n.attributes.class === 'graph-jump',
  );
  arrow.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(jumps, ['c0']);
});

test('merge sides converge on the parent dot with continuous diagonals across rows', () => {
  const rows = graphRows([
    { hash: 'merge', parents: ['parent', 'side'] },
    { hash: 'side', parents: ['parent'] },
    { hash: 'parent', parents: [] },
  ]);
  assert.equal(rows[1].elements.length, 2);
  const arrivals = rows[2].segments.filter((s) => s.endY === 0.5);
  assert.equal(arrivals.length, 2);
  assert.ok(arrivals.every((s) => s.to === rows[2].lane));
  const diagonal = arrivals.find((s) => s.from !== s.to);
  const previous = rows[1].segments.find((s) => s.edge === diagonal.edge && s.endY === 1);
  assert.equal(previous.to, diagonal.from);
  assert.equal(previous.to, (previous.from + diagonal.to) / 2);
});

test('long-edge arrows and hit areas stay away from dots and meet their stubs', () => {
  const rows = graphRows(
    Array.from({ length: 35 }, (_, i) => ({ hash: `n${i}`, parents: i === 0 ? ['n34'] : [] })),
  );
  for (const [index, y] of [
    [1, 6],
    [33, 18],
  ]) {
    const graph = svgGraph(rows[index]);
    const group = graph.children.find((node) => node.attributes.class === 'graph-jump');
    const hit = group.children.find((node) => node.tag === 'rect');
    assert.ok(
      Number(hit.attributes.y) + Number(hit.attributes.height) < 12 ||
        Number(hit.attributes.y) > 12,
    );
    const edge = rows[index].arrows[0].edge;
    assert.ok(
      rows[index].segments.some(
        (s) => s.edge === edge && (s.startY * 24 === y || s.endY * 24 === y),
      ),
    );
  }
});

// Rebased testData/layoutBuilder/manyNodes, Apache-2.0 (see notices).
test('permanent DFS layout matches the upstream manyNodes fixture', () => {
  const parentLists = [[1, 6, 3], [7], [3], [], [5], [], [7], [8], []];
  const items = parentLists.map((parents, i) => ({
    hash: `a${i}`,
    parents: parents.map((p) => `a${p}`),
  }));
  const layout = graphLayout(items);
  assert.deepEqual(
    items.map((c) => layout.get(c.hash).graphLayout),
    [1, 1, 4, 3, 5, 5, 2, 1, 1],
  );
});

// Rebased testData/elementGenerator/manyNodes, including its dotted edge.
test('visible element ordering matches the upstream print generator fixture', () => {
  const parentLists = [[1, 6, 3], [], [3], [], [5], [], [7], []];
  const items = parentLists.map((parents, i) => ({
    hash: `n${i}`,
    parents: parents.map((p) => `n${p}`),
  }));
  items[1].parents = ['n6'];
  const rows = graphRows(items);
  assert.deepEqual(
    Array.from(rows, (r) => r.lane),
    [0, 1, 3, 2, 2, 2, 0, 0],
  );
});

test('hidden long edges release columns, and restored edges preserve their target and color', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ hash: `n${i}`, parents: [] }));
  items[0].parents = ['n39'];
  items[2].parents = ['n38'];
  const compact = graphRows(items, false),
    expanded = graphRows(items, true);
  assert.equal(compact[10].elements.length, 1);
  assert.equal(compact[10].lane, 0);
  assert.equal(expanded[10].elements.length, 3);
  assert.equal(compact[38].segments.at(-1).edge.hash, 'n38');
  assert.deepEqual(
    Array.from(compact, (r: { colorId: number }) => r.colorId),
    Array.from(expanded, (r: { colorId: number }) => r.colorId),
  );
});

test('layout and color metadata survive filtering and pagination', () => {
  const full = [
    { hash: 'a', parents: ['c'], decorations: 'refs/remotes/origin/feature_bar' },
    { hash: 'b', parents: ['d'], decorations: 'refs/remotes/origin/feature-foo' },
    { hash: 'c', parents: ['e'] },
    { hash: 'd', parents: ['e'] },
    { hash: 'e', parents: [] },
  ];
  const metadata = graphLayout(full),
    withMeta = full.map((c) => ({ ...c, ...metadata.get(c.hash) }));
  assert.ok(metadata.get('b').graphLayout < metadata.get('a').graphLayout);
  const filtered = withMeta.filter((c) => ['a', 'c', 'e'].includes(c.hash));
  assert.equal(graphRows(filtered)[1].colorId, graphRows(withMeta)[2].colorId);
  assert.equal(graphRows(withMeta.slice(0, 3))[0].colorId, graphRows(withMeta)[0].colorId);
});

test('branch names use Rebased natural character order for punctuation, case and numbers', () => {
  const names = ['featureAlpha', 'feature_bar', 'feature-foo', 'release10', 'release2'];
  const items = names.map((name) => ({
    hash: name,
    parents: [],
    decorations: `refs/remotes/origin/${name}`,
  }));
  const layout = graphLayout(items);
  const ordered = [...items]
    .sort((a, b) => layout.get(a.hash).graphLayout - layout.get(b.hash).graphLayout)
    .map((c) => c.hash);
  assert.deepEqual(ordered, [
    'feature-foo',
    'feature_bar',
    'featureAlpha',
    'release2',
    'release10',
  ]);
});

test('every routed edge meets across row boundaries and only terminates at dots or arrows', () => {
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const items = Array.from({ length: 150 }, (_, i) => ({ hash: `n${i}`, parents: [] }));
  items.forEach((c, i) => {
    for (let j = 0; j < 3; j++)
      if (i < 149 && random() < 0.7) c.parents.push(`n${i + 1 + Math.floor(random() * (149 - i))}`);
  });
  for (const long of [false, true]) {
    const rows = graphRows(items, long);
    for (const row of rows)
      for (const s of row.segments) {
        if (s.startY === 0) {
          const previous = rows[row.index - 1].segments.find(
            (p) => p.edge === s.edge && p.endY === 1,
          );
          assert.ok(previous);
          assert.equal(previous.to, s.from);
        } else if (s.edge.start === row.index) {
          assert.equal(s.from, row.lane);
          assert.equal(s.startY, 0.5);
        } else assert.ok(row.elements.includes(s.edge));
        if (s.edge.end === row.index) {
          assert.equal(s.to, row.lane);
          assert.equal(s.endY, 0.5);
        }
      }
  }
});

test('unloaded parent gets a next-row stub, not an edge to an unrelated dot', () => {
  const items = [
    { hash: 'a', parents: ['b'] },
    { hash: 'b', parents: ['parent'] },
    { hash: 'other', parents: [] },
  ];
  const rows = graphRows(items),
    arrow = rows[2].arrows[0];
  assert.equal(arrow.edge.hash, 'parent');
  assert.equal(arrow.y, 0.25);
  assert.notEqual(arrow.lane, rows[2].lane);
  assert.equal(rows[1].segments.find((s) => s.edge === arrow.edge).from, rows[1].lane);
  const complete = graphRows([...items, { hash: 'parent', parents: [] }]);
  assert.equal(complete.flatMap((r) => r.arrows).length, 0);
  assert.equal(complete[3].segments[0].to, complete[3].lane);
  assert.equal(graphRows([{ hash: 'root', parents: [] }])[0].arrows.length, 0);
});

test('arrow outline and colored shape retain separate scaled stroke widths', () => {
  const rows = graphRows([{ hash: 'child', parents: ['missing'] }]);
  const cell = graphCell(rows[0], () => {}, 24);
  const arrow = cell.children
    .find((n) => n.tag === 'svg')
    .children.find((n) => n.attributes.class === 'graph-jump');
  paintHover(cell, arrow);
  const [outline, shape] = cell.children.find((n) => n.tag === 'canvas').ctx.arrowStrokes.slice(-2);
  assert.equal(outline.path, shape.path);
  assert.ok(outline.width > shape.width);
});

test('diagonal arrow wings are symmetric and fit the vertically extended clip', () => {
  for (const rowHeight of [22, 24, 32])
    for (const down of [true, false])
      for (const direction of [-1, 1]) {
        const edge = {
          hash: 'parent',
          source: 'child',
          colorId: 0,
          start: 0,
          end: 1,
          unloaded: false,
          dashed: false,
        };
        const y = down ? 0.25 : 0.75;
        const row = {
          hash: 'child',
          index: 0,
          elements: [],
          lane: 1,
          width: 4,
          colorId: 0,
          segments: [
            { edge, from: direction < 0 ? 2 : 1, to: direction < 0 ? 1 : 2, startY: 0, endY: 1 },
          ],
          arrows: [{ edge, lane: 1, down, y }],
        };
        const svg = svgGraph(row, () => {}, rowHeight);
        const group = svg.children.find((n) => n.attributes.class === 'graph-jump');
        const shape = group.children.find((n) => n.attributes.class === 'graph-arrow-shape');
        const [x1, y1, x, y0, x2, y2] = shape.attributes.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
        assert.ok(Math.abs(Math.hypot(x1 - x, y1 - y0) - Math.hypot(x2 - x, y2 - y0)) < 1e-9);
        for (const wingY of [y1, y2])
          assert.ok(wingY - 2 >= -rowHeight / 2 && wingY + 2 <= rowHeight * 1.5);
      }
  const css = fs.readFileSync(require.resolve('../out/webview/compact.css'), 'utf8');
  assert.match(
    css,
    /\.graph-cell > svg[\s\S]*?overflow:\s*visible;\s*clip-path:\s*inset\(-50% 0\)/,
  );
});

test('pointer press on an arrow prevents browser focus decoration without blocking navigation', () => {
  const rows = graphRows([{ hash: 'child', parents: ['missing'] }]);
  const jumps = [];
  const arrow = svgGraph(rows[0], (hash) => jumps.push(hash)).children.find(
    (n) => n.attributes.class === 'graph-jump',
  );
  let prevented = false,
    stopped = false;
  arrow.onpointerdown({
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });
  assert.ok(prevented && stopped);
  arrow.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(jumps, ['missing']);
});

test('lazy interval geometry matches the pre-virtual renderer across collapsed, expanded, merge and unloaded edges', () => {
  // Golden digests were produced by the 0.1.159 eager generator, excluding only
  // recommended width (now computed by an interval sweep, without materializing rows).
  const { createHash } = require('node:crypto');
  for (const [long, expected] of [
    [false, 'e932f4de201a47a21e0d7314ba21752f89bf424ea351bde30c554ffbc841ad49'],
    [true, 'e81c38c74d542795884f0d426f2975d294648c743729d92f6d2a1f7847363a7e'],
  ] as const) {
    let seed = 42;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const count = 1200;
    const commits = Array.from({ length: count }, (_, i) => ({
      hash: `n${i}`,
      parents: Array.from(
        { length: (i % 3) + 1 },
        () => `n${i + 1 + Math.floor(random() * (count - i + 10))}`,
      ),
    }));
    const provider = createRows(commits, long, 32);
    assert.equal(provider.cacheSize, 0, 'initialization must not generate row geometry');
    assert.equal(provider.positionCacheSize, 0);
    // Reverse/random access and eviction cannot change lane ordering or endpoints.
    for (let i = count - 1; i >= 0; i -= 7) provider.get(i);
    const result = commits.map((_, i) => {
      const { width, ...row } = provider.get(i);
      assert.ok(width <= provider.maxWidth);
      return {
        hash: row.hash,
        index: row.index,
        elements: row.elements,
        segments: row.segments,
        arrows: row.arrows,
        colorId: row.colorId,
        lane: row.lane,
      };
    });
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), expected);
    assert.ok(provider.cacheSize <= 32 && provider.positionCacheSize <= 32);
    assert.throws(() => provider.get(-1), RangeError);
    assert.throws(() => provider.get(count), RangeError);
  }
});

test('tall file-history rows retain the log lane spacing and center their graph nodes', () => {
  const row = graphRows([{ hash: 'one', parents: [] }])[0];
  const normal = svgGraph(row, undefined, 24);
  const tall = svgGraph(row, undefined, 46, undefined, 24);
  const circle = (svg) => svg.children.find((child) => child.tag === 'circle').attributes;
  assert.equal(circle(tall).cx, circle(normal).cx);
  assert.equal(circle(tall).r, circle(normal).r);
  assert.equal(circle(tall).cy, '23');
});
