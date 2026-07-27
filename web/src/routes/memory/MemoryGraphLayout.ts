import type { Id } from "@convex/_generated/dataModel";

export interface MemoryGraphLayoutNode {
  id: Id<"memories">;
  category: string;
  retrievalMode: string;
  importanceScore: number;
  reinforcementCount: number;
  isSuperseded: boolean;
}

export interface MemoryGraphLayoutEdge {
  sourceId: Id<"memories">;
  targetId: Id<"memories">;
  confidence: number;
}

export interface PositionedMemoryNode extends MemoryGraphLayoutNode {
  x: number;
  y: number;
  radius: number;
}

export const MEMORY_GRAPH_WIDTH = 1_000;
export const MEMORY_GRAPH_HEIGHT = 680;

const CATEGORY_ORDER = [
  "identity",
  "preferences",
  "work",
  "goals",
  "background",
  "writingStyle",
  "relationships",
  "skills",
  "tools",
  "logistics",
];

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededUnit(value: string, salt: number): number {
  return (hashString(`${value}:${salt}`) % 10_000) / 10_000;
}

function initialPosition(node: MemoryGraphLayoutNode, index: number) {
  const categoryIndex = Math.max(0, CATEGORY_ORDER.indexOf(node.category));
  const categoryAngle = (categoryIndex / CATEGORY_ORDER.length) * Math.PI * 2;
  const jitter = (seededUnit(node.id, 1) - 0.5) * 1.35;
  const angle = categoryAngle + jitter + index * 0.011;
  const radialNoise = seededUnit(node.id, 2);
  const radius = 90 + Math.sqrt(radialNoise) * 210;
  return {
    x: MEMORY_GRAPH_WIDTH / 2 + Math.cos(angle) * radius,
    y: MEMORY_GRAPH_HEIGHT / 2 + Math.sin(angle) * radius * 0.78,
  };
}

export function graphNodeRadius(node: MemoryGraphLayoutNode): number {
  const importance = Math.max(0, Math.min(1, node.importanceScore));
  const reinforcement = Math.min(1, Math.log2(node.reinforcementCount + 1) / 5);
  return 3.5 + importance * 5 + reinforcement * 3;
}

export function layoutMemoryGraph(
  nodes: MemoryGraphLayoutNode[],
  edges: MemoryGraphLayoutEdge[],
): PositionedMemoryNode[] {
  if (nodes.length === 0) return [];
  const positions = nodes.map((node, index) => ({
    ...node,
    ...initialPosition(node, index),
    radius: graphNodeRadius(node),
    vx: 0,
    vy: 0,
  }));
  const indexes = new Map(positions.map((node, index) => [node.id, index]));
  const iterations = nodes.length > 180 ? 48 : 72;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;
    for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
      const left = positions[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
        const right = positions[rightIndex]!;
        const dx = right.x - left.x || 0.01;
        const dy = right.y - left.y || 0.01;
        const distanceSquared = Math.max(36, dx * dx + dy * dy);
        const force = Math.min(1.8, 750 / distanceSquared) * cooling;
        const distance = Math.sqrt(distanceSquared);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        left.vx -= fx;
        left.vy -= fy;
        right.vx += fx;
        right.vy += fy;
      }
    }
    for (const edge of edges) {
      const sourceIndex = indexes.get(edge.sourceId);
      const targetIndex = indexes.get(edge.targetId);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      const source = positions[sourceIndex]!;
      const target = positions[targetIndex]!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const ideal = 58 + (1 - edge.confidence) * 40;
      const force = (distance - ideal) * 0.008 * cooling;
      source.vx += (dx / distance) * force;
      source.vy += (dy / distance) * force;
      target.vx -= (dx / distance) * force;
      target.vy -= (dy / distance) * force;
    }
    for (const node of positions) {
      node.vx += (MEMORY_GRAPH_WIDTH / 2 - node.x) * 0.0008;
      node.vy += (MEMORY_GRAPH_HEIGHT / 2 - node.y) * 0.001;
      node.x = Math.max(24, Math.min(MEMORY_GRAPH_WIDTH - 24, node.x + node.vx));
      node.y = Math.max(24, Math.min(MEMORY_GRAPH_HEIGHT - 24, node.y + node.vy));
      node.vx *= 0.72;
      node.vy *= 0.72;
    }
  }

  const minX = Math.min(...positions.map((node) => node.x));
  const maxX = Math.max(...positions.map((node) => node.x));
  const minY = Math.min(...positions.map((node) => node.y));
  const maxY = Math.max(...positions.map((node) => node.y));
  const rangeX = Math.max(1, maxX - minX);
  const rangeY = Math.max(1, maxY - minY);
  const fitScale = Math.min(
    2.2,
    (MEMORY_GRAPH_WIDTH - 100) / rangeX,
    (MEMORY_GRAPH_HEIGHT - 90) / rangeY,
  );
  const offsetX = (MEMORY_GRAPH_WIDTH - rangeX * fitScale) / 2;
  const offsetY = (MEMORY_GRAPH_HEIGHT - rangeY * fitScale) / 2;

  return positions.map((node) => ({
    id: node.id,
    category: node.category,
    retrievalMode: node.retrievalMode,
    importanceScore: node.importanceScore,
    reinforcementCount: node.reinforcementCount,
    isSuperseded: node.isSuperseded,
    x: offsetX + (node.x - minX) * fitScale,
    y: offsetY + (node.y - minY) * fitScale,
    radius: node.radius,
  }));
}
