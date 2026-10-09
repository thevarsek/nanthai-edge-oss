import type { FunctionArgs } from "convex/server";
import type { api } from "@convex/_generated/api";

export type VoiceCloningRequest = NonNullable<FunctionArgs<typeof api.chat.mutations.sendMessage>["voiceCloning"]>;
