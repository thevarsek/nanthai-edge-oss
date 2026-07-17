export class DeferredPresentationRepair extends Error {
  readonly invalidResponse: string;
  readonly validationError: string;
  readonly targetSlideId?: string;
  readonly effectiveModelId?: string;

  constructor(
    invalidResponse: string,
    validationError: string,
    targetSlideId?: string,
    effectiveModelId?: string,
  ) {
    super("Presentation response requires a durable repair attempt.");
    this.name = "DeferredPresentationRepair";
    this.invalidResponse = invalidResponse;
    this.validationError = validationError;
    this.targetSlideId = targetSlideId;
    this.effectiveModelId = effectiveModelId;
  }
}
