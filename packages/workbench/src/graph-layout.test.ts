import { expect, it } from 'vitest';
import { createGraphLayout } from './graph-layout';

it('settles connected and isolated nodes to finite positions and reacts to dragging', () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    path: `${i}.md`,
    label: String(i),
    degree: i < 10 ? 1 : 0,
  }));
  const edges = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    source: '0',
    target: String(i + 1),
  }));
  const layout = createGraphLayout({ nodes, edges });
  layout.simulation.tick(250);
  expect(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
    true,
  );
  expect(
    new Set(layout.nodes.map((node) => `${node.x.toFixed(2)},${node.y.toFixed(2)}`)).size,
  ).toBe(60);
  const neighbour = { x: layout.nodes[1].x, y: layout.nodes[1].y };
  layout.nodes[0].fx = 400;
  layout.nodes[0].fy = 150;
  layout.simulation.alpha(0.8).tick(80);
  expect(layout.nodes[0].x).toBe(400);
  expect(layout.nodes[0].y).toBe(150);
  expect(
    Math.hypot(layout.nodes[1].x - neighbour.x, layout.nodes[1].y - neighbour.y),
  ).toBeGreaterThan(10);
  const changed = createGraphLayout(
    { nodes: nodes.map((node) => ({ ...node, path: `renamed/${node.path}` })), edges },
    layout.nodes,
  );
  expect(changed.nodes[0].x).toBe(400);
  expect(changed.nodes[0].fx).toBeUndefined();
  layout.simulation.stop();
  changed.simulation.stop();
});
