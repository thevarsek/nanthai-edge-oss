export function resolveVideoAudioParameter(
  supportsAudio: boolean | undefined,
  requested: boolean | undefined,
): boolean | undefined {
  if (supportsAudio !== true) return undefined;
  return requested ?? true;
}
