import { expect, it } from 'vitest';
import { createGraphDirectionForce, createGraphLayout } from './graph-layout';

it('turns steep directed edges with no radial impulse or position target', () => {
  const layout = createGraphLayout({
    nodes: ['source', 'target'].map((id) => ({ id, path: id, label: id, degree: 1 })),
    edges: [{ id: 'edge', source: 'source', target: 'target' }],
  });
  const [source, target] = layout.nodes;
  source.x = 30;
  source.y = -20;
  target.x = 40;
  target.y = 130;
  source.vx = source.vy = target.vx = target.vy = 0;
  createGraphDirectionForce(layout.edges)(1);
  const vx = target.vx! - source.vx!;
  const vy = target.vy! - source.vy!;
  expect(vx).toBeGreaterThan(0);
  expect(vy).toBeLessThan(0);
  expect(vx * 10 + vy * 150).toBeCloseTo(0);
  expect(source.vx! + target.vx!).toBeCloseTo(0);
  expect(source.vy! + target.vy!).toBeCloseTo(0);
  // A short, already horizontal edge must not be pulled apart.
  source.x = source.y = target.y = 0;
  target.x = 0.5;
  source.vx = source.vy = target.vx = target.vy = 0;
  createGraphDirectionForce(layout.edges)(1);
  expect([source.vx, source.vy, target.vx, target.vy]).toEqual([0, 0, 0, 0]);
});

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
