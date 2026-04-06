export const GENERATION_CANCELLED_MESSAGE = "Generation cancelled";

export class GenerationCancelledError extends Error {
  constructor() {
    super(GENERATION_CANCELLED_MESSAGE);
    this.name = "GenerationCancelledError";
  }
}

export function isGenerationCancelledError(error: unknown): boolean {
  if (error instanceof GenerationCancelledError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("generation cancelled");
}
