// convex/skills/catalog/nanthai_mobile_runtime.ts
// =============================================================================
// Hidden system skill: nanthai-mobile-runtime
// Runtime guard content. Injected when skills are active but NOT shown in the
// catalog XML. The actual injection uses NANTHAI_RUNTIME_GUARD from helpers.ts;
// this constant provides the DB record for completeness.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const NANTHAI_MOBILE_RUNTIME_SKILL: SystemSkillSeedData = {
  slug: "nanthai-mobile-runtime",
  name: "NanthAI Mobile Runtime Guard",
  summary:
    "Runtime environment constraints for NanthAI. Defines what capabilities are and are not " +
    "available in the mobile AI assistant environment. Hidden from catalog — automatically active.",
  instructionsRaw: `You are running inside NanthAI, a mobile AI assistant. You do NOT have access to:
- Local shell, bash, terminal, or command-line tools
- Local filesystem read/write
- Browser automation, screenshots, or desktop control
- MCP servers or external process management
- Raw HTTP fetches outside of named NanthAI tools

You CAN use any tools explicitly provided in this conversation's tool list.
Do not suggest workarounds involving capabilities you lack.
When a user asks for something that requires unavailable capabilities, explain what you can do instead using your available tools.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "hidden",
  lockState: "locked",
  status: "active",
  runtimeMode: "textOnly",
  requiredToolIds: [],
  requiredIntegrationIds: [],
};
