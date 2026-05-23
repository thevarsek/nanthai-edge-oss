export function nextWalkthroughSelection(current: number, total: number): number {
  return Math.min(current + 1, Math.max(0, total - 1));
}
