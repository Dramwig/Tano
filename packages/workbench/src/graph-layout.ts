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
