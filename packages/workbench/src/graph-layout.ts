import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationNodeDatum } from 'd3-force';
import type { DocumentGraph, GraphNode } from './document-graph';

export interface LayoutNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
}
export interface LayoutEdge {
  id: string;
  source: LayoutNode;
  target: LayoutNode;
}

// Shared physics defaults: weak gravity keeps clusters together while springs,
// charge and collision leave enough room to read titles and drag individual nodes.
export const graphPhysics = Object.freeze({
  center: 0.018,
  attraction: 0.2,
  repulsion: 420,
  distance: 130,
  damping: 0.32,
  collision: 26,
});
export interface GraphPhysics {
  center: number;
  attraction: number;
  repulsion: number;
  distance: number;
}
export function nodeRadius(node: GraphNode) {
  return 5 + Math.min(5, Math.sqrt(node.degree) * 1.5);
}

/** Turns edges into a right-facing cone using tangential impulses, without a preferred length or position. */
export function createGraphDirectionForce(edges: readonly LayoutEdge[], strength = 0.55) {
  const pairs = new Set(edges.map(({ source, target }) => JSON.stringify([source.id, target.id])));
  const maxAngle = Math.PI / 5;
  const force = (alpha: number) => {
    for (const edge of edges) {
      // Reciprocal references cannot both point right; let the shared layout settle them.
      if (pairs.has(JSON.stringify([edge.target.id, edge.source.id]))) continue;
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const angle = Math.atan2(dy, dx);
      const error = angle - Math.max(-maxAngle, Math.min(maxAngle, angle));
      if (!error || Math.hypot(dx, dy) < 0.001) continue;
      const turn = Math.max(-0.3, Math.min(0.3, error * strength * alpha));
      const vx = dy * turn;
      const vy = -dx * turn;
      const sourceFree = edge.source.fx == null && edge.source.fy == null;
      const targetFree = edge.target.fx == null && edge.target.fy == null;
      const share = sourceFree && targetFree ? 0.5 : 1;
      if (sourceFree) {
        edge.source.vx = (edge.source.vx ?? 0) - vx * share;
        edge.source.vy = (edge.source.vy ?? 0) - vy * share;
      }
      if (targetFree) {
        edge.target.vx = (edge.target.vx ?? 0) + vx * share;
        edge.target.vy = (edge.target.vy ?? 0) + vy * share;
      }
    }
  };
  return force;
}

export function createGraphLayout(
  graph: DocumentGraph,
  previous: LayoutNode[] = [],
  physics: GraphPhysics = graphPhysics,
) {
  const old = new Map(previous.map((node) => [node.id, node]));
  const nodes: LayoutNode[] = graph.nodes.map((node, i) => {
    const saved = old.get(node.id);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = 24 * Math.sqrt(i);
    return {
      ...node,
      x: saved?.x ?? Math.cos(angle) * radius,
      y: saved?.y ?? Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: LayoutEdge[] = graph.edges.map((edge) => ({
    ...edge,
    source: byId.get(edge.source)!,
    target: byId.get(edge.target)!,
  }));
  const simulation = forceSimulation(nodes)
    .force('center-x', forceX(0).strength(physics.center))
    .force('center-y', forceY(0).strength(physics.center))
    .force('repulsion', forceManyBody().strength(-physics.repulsion).distanceMin(12))
    .force(
      'links',
      forceLink<LayoutNode, LayoutEdge>(edges)
        .id((node) => node.id)
        .distance(physics.distance)
        .strength(physics.attraction),
    )
    .force(
      'collision',
      forceCollide<LayoutNode>((node) => nodeRadius(node) + graphPhysics.collision).iterations(2),
    )
    .velocityDecay(graphPhysics.damping)
    .alphaDecay(0.025)
    .stop();
  return { nodes, edges, simulation };
}
