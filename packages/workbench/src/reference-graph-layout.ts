import type { ForceLink } from 'd3-force';
import type { DocumentGraph } from './document-graph';
import {
  createGraphDirectionForce,
  createGraphLayout,
  graphPhysics,
  nodeRadius,
} from './graph-layout';
import type { GraphPhysics, LayoutEdge, LayoutNode } from './graph-layout';

export const referenceGraphPhysics = Object.freeze({
  ...graphPhysics,
  distance: 150,
  repulsion: 180,
});

export function createReferenceGraphLayout(
  graph: DocumentGraph,
  centerId: string,
  previous: LayoutNode[] = [],
  physics: GraphPhysics = referenceGraphPhysics,
) {
  const layout = createGraphLayout(graph, previous, physics);
  const linkedPairs = new Set<string>();
  const springEdges = layout.edges.filter(({ source, target }) => {
    const pair = JSON.stringify([source.id, target.id].sort());
    if (linkedPairs.has(pair)) return false;
    linkedPairs.add(pair);
    return true;
  });
  // Each visible connection has one ordinary spring, including reciprocal references.
  layout.simulation.force<ForceLink<LayoutNode, LayoutEdge>>('links')!.links(springEdges);
  // Keep both directions here so the direction force can recognize and skip reciprocal pairs.
  layout.simulation.force('direction', createGraphDirectionForce(layout.edges));
  const saved = new Set(previous.map((node) => node.id));
  const center = layout.nodes.find((node) => node.id === centerId);
  if (!center) return layout;
  if (!saved.has(center.id)) center.x = center.y = 0;
  const incoming = new Set(
    layout.edges.filter((edge) => edge.target === center).map((edge) => edge.source.id),
  );
  const outgoing = new Set(
    layout.edges.filter((edge) => edge.source === center).map((edge) => edge.target.id),
  );
  // Seed new nodes by direction. These are starting positions, not position constraints.
  for (const side of [-1, 1]) {
    const group = layout.nodes.filter(
      (node) =>
        node !== center && (incoming.has(node.id) && !outgoing.has(node.id) ? -1 : 1) === side,
    );
    group.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN') || a.id.localeCompare(b.id));
    group.forEach((node, index) => {
      if (saved.has(node.id)) return;
      const angle = group.length > 1 ? (index / (group.length - 1) - 0.5) * 1.1 : 0;
      node.x = center.x + side * physics.distance * Math.cos(angle);
      node.y = center.y + physics.distance * Math.sin(angle);
    });
  }
  return layout;
}

export function referenceEdgeCurve(edge: LayoutEdge, bidirectional = false) {
  const { source, target } = edge;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return '';
  // Ease shallow connections toward horizontal tangents while letting steep ones
  // approach their nodes naturally. One continuous rule avoids snapping while dragging.
  const ux = dx / length;
  const uy = (dy / length) ** 3;
  const tangentLength = Math.hypot(ux, uy);
  const tx = ux / tangentLength;
  const ty = uy / tangentLength;
  const startGap = Math.min(nodeRadius(source) + (bidirectional ? 5 : 2), length * 0.2);
  const endGap = Math.min(nodeRadius(target) + 5, length * 0.2);
  const x1 = source.x + tx * startGap;
  const y1 = source.y + ty * startGap;
  const x2 = target.x - tx * endGap;
  const y2 = target.y - ty * endGap;
  // Keep control points ordered on both axes so the curve cannot hook back near an arrow.
  const handle = Math.min(
    (length - startGap - endGap) * 0.4,
    tx ? Math.abs((x2 - x1) / tx) * 0.45 : Infinity,
    ty ? Math.abs((y2 - y1) / ty) * 0.45 : Infinity,
  );
  return `M ${x1} ${y1} C ${x1 + tx * handle} ${y1 + ty * handle}, ${x2 - tx * handle} ${y2 - ty * handle}, ${x2} ${y2}`;
}

export function referenceNodeLabel(node: LayoutNode, centerId: string, centerX = 0) {
  const center = node.id === centerId;
  const side = center ? 0 : node.x < centerX ? -1 : 1;
  const characters = [...node.label];
  const text = characters.length > 22 ? `${characters.slice(0, 21).join('')}…` : node.label;
  const width = [...text].reduce(
    (sum, character) => sum + (/[^\x00-\xff]/.test(character) ? 12 : 7),
    0,
  );
  const x = side * (nodeRadius(node) + 9);
  // Leave room for the arrowhead of a connection arriving from below the center.
  const y = center ? nodeRadius(node) + 28 : 4;
  return {
    text,
    x,
    y,
    anchor: side < 0 ? 'end' : side > 0 ? 'start' : 'middle',
    left: node.x + x - (side < 0 ? width : center ? width / 2 : 0),
    right: node.x + x + (side > 0 ? width : center ? width / 2 : 0),
    top: node.y + y - 12,
    bottom: node.y + y + 4,
  };
}
