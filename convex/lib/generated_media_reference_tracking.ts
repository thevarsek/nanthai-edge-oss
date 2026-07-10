export const GENERATED_MEDIA_REFERENCE_TRACKING_VERSION = 1;

export function isGeneratedMediaReferenceFullyTracked(
  media: { referenceTrackingVersion?: number },
): boolean {
  return media.referenceTrackingVersion === GENERATED_MEDIA_REFERENCE_TRACKING_VERSION;
}
