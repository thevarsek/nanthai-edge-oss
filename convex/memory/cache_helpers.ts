export function waitForMemoryCache(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashMemoryCacheText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export function hashMemoryCacheTextForPrivacyMode(
  text: string,
  requireZdr: boolean,
): string {
  return hashMemoryCacheText(requireZdr ? `zdr:${text}` : text);
}
