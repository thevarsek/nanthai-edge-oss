export function advanceProjectRevision(current: number, incoming: number): number {
  return Math.max(current, incoming);
}
