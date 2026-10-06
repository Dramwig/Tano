import { expect, it } from 'vitest';
import {
  createReferenceGraphLayout,
  referenceEdgeCurve,
  referenceGraphPhysics,
  referenceNodeLabel,
} from './reference-graph-layout';
import type { DocumentGraph } from './document-graph';
import { createGraphDirectionForce, createGraphLayout, nodeRadius } from './graph-layout';

const labels = [
  '00-从这里开始',
  '06-对象引用',
  '目标文档',
  '03-公式图表与脚注',
  '01-基础块与行内',
  '02-YAML-属性字段',
  '04-增强块',
  '05-链接图片与附件',
  '07-原文保留边界',
];
const graph: DocumentGraph = {
  nodes: labels.map((label, index) => ({
    id: String(index),
    label,
    path: `${label}.md`,
    degree: index ? 1 : 8,
  })),
  edges: labels.slice(1).map((_, index) => ({
    id: String(index + 1),
    source: index < 3 ? String(index + 1) : '0',
    target: index < 3 ? '0' : String(index + 1),
  })),
};

it.each([0, 180])(
  'settles eight neighbours into readable directed connections with repulsion %i',
  (repulsion) => {
    const layout = createReferenceGraphLayout(graph, '0', [], {
      ...referenceGraphPhysics,
      repulsion,
    });
    layout.simulation.tick(300);
    expect(layout.nodes.every((node) => node.fx == null && node.fy == null)).toBe(true);
    for (const edge of layout.edges) {
      const angle = Math.atan2(edge.target.y - edge.source.y, edge.target.x - edge.source.x);
      expect(Math.abs(angle)).toBeLessThan(Math.PI / 3);
      expect(referenceEdgeCurve(edge)).toContain(' C ');
    }
    const bounds = layout.nodes.map((node) => referenceNodeLabel(node, '0', layout.nodes[0].x));
    for (let a = 0; a < bounds.length; a++)
      for (let b = a + 1; b < bounds.length; b++) {
        const first = bounds[a],
          second = bounds[b];
        const overlap =
          first.left < second.right &&
          first.right > second.left &&
          first.top < second.bottom &&
          first.bottom > second.top;
        expect(overlap, `${first.text} overlaps ${second.text}`).toBe(false);
      }
    // Unpinned nodes displaced to the wrong side should rotate back into the flow.
    const node = layout.nodes[4];
    node.x = layout.nodes[0].x - 160;
    node.y = layout.nodes[0].y + 40;
    layout.simulation.alpha(1).tick(300);
    expect(node.x).toBeGreaterThan(layout.nodes[0].x);
  },
);

it('preserves every node position when rebuilding the layout without retaining any fixed nodes', () => {
  const layout = createReferenceGraphLayout(graph, '0');
  layout.simulation.tick(300);
  const center = layout.nodes[0];
  center.x = center.fx = 180;
  center.y = center.fy = 90;
  const rebuilt = createReferenceGraphLayout(graph, '0', layout.nodes, {
    ...referenceGraphPhysics,
    repulsion: 500,
  });
  expect(rebuilt.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
    layout.nodes.map(({ id, x, y }) => ({ id, x, y })),
  );
  expect(rebuilt.nodes.every((node) => node.fx == null && node.fy == null)).toBe(true);
  rebuilt.simulation.tick(300);
  expect(rebuilt.nodes[0].x).not.toBe(180);
});

it.each([100, 300])('restores a reciprocal edge from length %i without turning it', (length) => {
  const mutualGraph = {
    nodes: graph.nodes.slice(0, 2),
    edges: [
      { id: 'forward', source: '0', target: '1' },
      { id: 'backward', source: '1', target: '0' },
    ],
  };
  const previous = mutualGraph.nodes.map((node, i) => ({
    ...node,
    x: 20 - i * length * 0.6,
    y: 40 + i * length * 0.8,
  }));
  const layout = createReferenceGraphLayout(mutualGraph, '0', previous, {
    ...referenceGraphPhysics,
    center: 0,
    repulsion: 0,
  });
  layout.simulation.tick(200);
  const dx = layout.nodes[1].x - layout.nodes[0].x;
  const dy = layout.nodes[1].y - layout.nodes[0].y;
  expect(Math.hypot(dx, dy)).toBeCloseTo(referenceGraphPhysics.distance, 1);
  expect(Math.atan2(dy, dx)).toBeCloseTo(Math.atan2(0.8, -0.6), 10);
  expect(layout.nodes.every((node) => node.fx == null && node.fy == null)).toBe(true);
  expect(layout.edges).toHaveLength(2);
  expect(referenceEdgeCurve(layout.edges[0], true)).toContain(' C ');
});

it('uses one ordinary spring per pair while applying direction force only to single-direction references', () => {
  const mixedGraph = {
    nodes: graph.nodes.slice(0, 3),
    edges: [
      { id: 'forward', source: '0', target: '1' },
      { id: 'backward', source: '1', target: '0' },
      { id: 'single', source: '0', target: '2' },
    ],
  };
  const previous = mixedGraph.nodes.map((node, i) => ({
    ...node,
    x: [20, -230, 80][i],
    y: [40, 210, 360][i],
  }));
  const mixed = createReferenceGraphLayout(mixedGraph, '0', previous);
  const expected = createGraphLayout(
    { ...mixedGraph, edges: [mixedGraph.edges[0], mixedGraph.edges[2]] },
    previous,
    referenceGraphPhysics,
  );
  expected.simulation.force('direction', createGraphDirectionForce([expected.edges[1]]));
  mixed.simulation.tick(100);
  expected.simulation.tick(100);
  expect(mixed.nodes.map(({ x, y }) => ({ x, y }))).toEqual(
    expected.nodes.map(({ x, y }) => ({ x, y })),
  );
  const edge = mixed.edges[2];
  expect(Math.hypot(edge.target.x - edge.source.x, edge.target.y - edge.source.y)).toBeLessThan(
    250,
  );
  expect(
    Math.abs(Math.atan2(edge.target.y - edge.source.y, edge.target.x - edge.source.x)),
  ).toBeLessThan(Math.PI / 3);
});

it.each([
  [150, 60],
  [-150, 60],
  [150, 0],
  [30, 150],
  [30, -150],
  [-30, 150],
  [-30, -150],
  [0, 150],
  [0, -150],
])('leaves room for both arrowheads with the other node at (%i, %i)', (x, y) => {
  const layout = createReferenceGraphLayout(
    {
      nodes: graph.nodes.slice(0, 2),
      edges: [
        { id: 'forward', source: '0', target: '1' },
        { id: 'backward', source: '1', target: '0' },
      ],
    },
    '0',
  );
  layout.nodes[1].x = x;
  layout.nodes[1].y = y;
  for (const edge of layout.edges) {
    for (const bidirectional of [false, true]) {
      const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = referenceEdgeCurve(edge, bidirectional)
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      expect(Math.hypot(x1 - edge.source.x, y1 - edge.source.y)).toBeCloseTo(
        nodeRadius(edge.source) + (bidirectional ? 5 : 2),
      );
      expect(Math.hypot(x2 - edge.target.x, y2 - edge.target.y)).toBeCloseTo(
        nodeRadius(edge.target) + 5,
      );
      // Each arrow tip faces its node along the curve's endpoint tangent.
      expect((x1 - edge.source.x) * (c1y - y1) - (y1 - edge.source.y) * (c1x - x1)).toBeCloseTo(0);
      expect((x2 - edge.target.x) * (c2y - y2) - (y2 - edge.target.y) * (c2x - x2)).toBeCloseTo(0);
      for (const [start, first, second, end] of [
        [x1, c1x, c2x, x2],
        [y1, c1y, c2y, y2],
      ]) {
        const sign = Math.sign(end - start);
        expect((first - start) * sign).toBeGreaterThanOrEqual(0);
        expect((second - first) * sign).toBeGreaterThanOrEqual(0);
        expect((end - second) * sign).toBeGreaterThanOrEqual(0);
      }
      // Near-vertical arrows must point up/down along the connection, not sideways.
      if (Math.abs(y) > Math.abs(x) * 3) {
        const directionX = edge.target.x - edge.source.x;
        const directionY = edge.target.y - edge.source.y;
        const alignment =
          ((x2 - c2x) * directionX + (y2 - c2y) * directionY) /
          (Math.hypot(x2 - c2x, y2 - c2y) * Math.hypot(directionX, directionY));
        expect(alignment).toBeGreaterThan(0.99);
      }
    }
  }
  layout.simulation.tick(300);
  expect(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
    true,
  );
});

it('changes arrow tangents continuously when a node crosses the old routing threshold', () => {
  const [source, target] = graph.nodes.slice(0, 2).map((node) => ({ ...node, x: 0, y: 0 }));
  target.y = 150;
  const threshold = nodeRadius(source) + nodeRadius(target) + 12;
  target.x = threshold - 0.001;
  const before = referenceEdgeCurve({ id: 'edge', source, target }, true)
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  target.x = threshold + 0.001;
  const after = referenceEdgeCurve({ id: 'edge', source, target }, true)
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  expect(
    Math.max(...before.map((coordinate, index) => Math.abs(coordinate - after[index]))),
  ).toBeLessThan(0.01);
});
