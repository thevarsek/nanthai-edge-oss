import { APP_DEFAULT_MODEL_ID } from "./modelDefaults";

export const OpenRouter = {
  oauthUrl: "https://openrouter.ai/auth",
  callbackUrl: import.meta.env.DEV
    ? `${window.location.origin}/openrouter/callback`
    : "https://nanthai.tech/openrouter/callback",
} as const;

export const convexSiteUrl = (() => {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
  return convexUrl?.replace(".convex.cloud", ".convex.site") ?? "";
})();

export const StoreUrls = {
  ios: "https://apps.apple.com/us/app/nanthai-edge-multi-ai-chat/id6760239881",
  android: "https://play.google.com/store/apps/details?id=com.nanthai.edge",
} as const;

export const Defaults = {
  model: APP_DEFAULT_MODEL_ID,
  temperature: 0.7,
  maxParticipants: 3,
} as const;
