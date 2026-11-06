// convex/chat/product_context.ts
// =============================================================================
// Host-product context for ordinary chat turns.
//
// Every participant turn gets one compact block that tells the model it is a
// separately selected model running inside NanthAI, what NanthAI can actually
// do, and which of those capabilities are live for this turn. Detailed how-to
// guidance lives in the `nanthai-guide` skill and is loaded only on demand.
//
// Pure and V8-safe: callers resolve the turn state and pass it in.
// =============================================================================

export interface ProductContextState {
  /** Canonical model ID of the participant answering this turn. */
  modelId: string;
  isPro: boolean;
  /** A non-empty tool registry and a tool-capable model. */
  toolsAvailable: boolean;
  /** `spawn_subagents` can run on this turn. */
  subagentsAvailable: boolean;
  /** Number of models answering this user turn. */
  modelCount: number;
  /** This turn belongs to a Conversation mode collaboration exchange. */
  collaboration: boolean;
  /** Auto audio reply resolved from chat override and user preference. */
  autoAudioReply: boolean;
}

const PRODUCT_FACTS = [
  "App facts, only for questions about NanthAI:",
  "- Voice: the mic transcribes speech; \"Listen\" reads a reply aloud; \"Auto audio reply\" speaks replies to voice messages. No live voice conversation.",
  "- Multiple AIs: up to 3 models answer side by side; Conversation mode > Collaboration has them build on each other. Subagents are one model splitting its task into helpers.",
  "- Pro adds tools, personas, skills, memory, integrations and scheduled jobs.",
  "Recommend other products honestly when asked or when NanthAI can't do it.",
].join("\n");

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function describeModels(state: ProductContextState): string {
  if (state.modelCount <= 1) return "1 model";
  return `${state.modelCount} models (${state.collaboration ? "collaboration" : "side by side"})`;
}

export function buildProductContext(state: ProductContextState): string {
  const turnState = [
    state.isPro ? "Pro" : "Free",
    `tools ${onOff(state.toolsAvailable)}`,
    `subagents ${onOff(state.subagentsAvailable)}`,
    describeModels(state),
    `auto audio reply ${onOff(state.autoAudioReply)}`,
  ].join("; ");
  return [
    "<host_product>",
    `You are the model ${state.modelId} inside NanthAI, a multi-model AI app for iOS, Android and web, not your provider; if asked, name your model and say you run in NanthAI. Never claim to be ChatGPT, Gemini, Grok or another app. Any persona below keeps its name, role and tone.`,
    PRODUCT_FACTS,
    `Now: ${turnState}.`,
    "</host_product>",
  ].join("\n");
}

/** Prepend the host-product block once, ahead of persona and skill layers. */
export function withProductContext(
  systemPrompt: string | null | undefined,
  productContext: string,
): string {
  const rest = systemPrompt?.trim();
  return rest ? `${productContext}\n\n${rest}` : productContext;
}
