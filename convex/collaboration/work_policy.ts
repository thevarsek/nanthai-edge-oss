export interface WorkDependencyNode {
  id: string;
  dependencyIds: string[];
  status: string;
  needsRevalidation: boolean;
}

export function assertAcyclicDependencies(
  nodes: WorkDependencyNode[], id: string, dependencies: string[],
): void {
  const graph = new Map(nodes.map((node) => [node.id, node.dependencyIds]));
  graph.set(id, dependencies);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error("WORK_DEPENDENCY_CYCLE");
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of graph.get(key) ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  visit(id);
}

export function workDependenciesCommitted(
  work: Pick<WorkDependencyNode, "dependencyIds">, nodes: WorkDependencyNode[],
): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return work.dependencyIds.every((id) => {
    const dependency = byId.get(id);
    return dependency?.status === "done" && !dependency.needsRevalidation;
  });
}

export function affectedDependents(nodes: WorkDependencyNode[], changedId: string): string[] {
  const affected = new Set([changedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!affected.has(node.id) && node.dependencyIds.some((id) => affected.has(id))) {
        affected.add(node.id);
        changed = true;
      }
    }
  }
  affected.delete(changedId);
  return [...affected];
}
