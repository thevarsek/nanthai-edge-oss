/**
 * Provider logo component — mirrors iOS ProviderLogoView.swift.
 * Renders the provider PNG from /providers/ with a colored-initials fallback.
 */

import { useState } from "react";

// ─── Slug → asset file mapping (matches iOS slugToAsset) ───────────────

const slugToAsset: Record<string, string> = {
  openai: "provider_openai",
  anthropic: "provider_anthropic",
  google: "provider_google",
  "meta-llama": "provider_meta_llama",
  mistralai: "provider_mistralai",
  deepseek: "provider_deepseek",
  cohere: "provider_cohere",
  perplexity: "provider_perplexity",
  nvidia: "provider_nvidia",
  qwen: "provider_qwen",
  ai21: "provider_ai21",
  "x-ai": "provider_x_ai",
  amazon: "provider_amazon",
  nousresearch: "provider_nousresearch",
  alibaba: "provider_alibaba",
  minimax: "provider_minimax",
  baidu: "provider_baidu",
  bytedance: "provider_bytedance",
  "bytedance-seed": "provider_bytedance_seed",
  ibm: "provider_ibm",
  "ibm-granite": "provider_ibm",
  "arcee-ai": "provider_arcee_ai",
  allenai: "provider_allenai",
  "aion-labs": "provider_aion_labs",
  inception: "provider_inception",
  meituan: "provider_meituan",
  tencent: "provider_tencent",
  moonshot: "provider_moonshot",
  moonshotai: "provider_moonshot",
  deepcogito: "provider_deepcogito",
  morph: "provider_morph",
  upstage: "provider_upstage",
  writer: "provider_writer",
  stepfun: "provider_stepfun",
  xiaomi: "provider_xiaomi",
  kwaipilot: "provider_kwaipilot",
  inclusionai: "provider_inclusionai",
  sao10k: "provider_sao10k",
  relace: "provider_relace",
  "nex-agi": "provider_nex_agi",
  "prime-intellect": "provider_prime_intellect",
  tngtech: "provider_tngtech",
  openrouter: "provider_openrouter",
  "z-ai": "provider_z_ai",
  switchpoint: "provider_switchpoint",
};

// ─── Helpers ────────────────────────────────────────────────────────────

function assetName(slug: string): string {
  // Strip leading "~" — OpenRouter uses tilde-prefixed provider slugs
  // (e.g. "~anthropic/claude-opus-latest") as "latest alias" pointers.
  // They share logos with the non-tilde canonical provider.
  const canonical = slug.startsWith("~") ? slug.slice(1) : slug;
  return slugToAsset[canonical] ?? `provider_${canonical.replace(/-/g, "_")}`;
}

function extractProvider(modelId: string): string {
  const raw = modelId.split("/")[0] ?? modelId;
  return raw.startsWith("~") ? raw.slice(1) : raw;
}

/** Deterministic hue from slug string (matches iOS palette approach). */
function slugHue(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash + slug.charCodeAt(i)) * 31) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

/**
 * Initials matching iOS logic:
 * - Multi-word (hyphenated): first letter of each word → "ML" for "meta-llama"
 * - Single word: first uppercase + second lowercase → "Op" for "openai"
 */
function initials(slug: string): string {
  const words = slug.split("-");
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("");
  }
  const first = slug.charAt(0).toUpperCase();
  const second = slug.charAt(1)?.toLowerCase() ?? "";
  return first + second;
}

// ─── Component ──────────────────────────────────────────────────────────

interface ProviderLogoProps {
  /** OpenRouter provider slug (e.g. "openai") OR full model ID (e.g. "openai/gpt-4o"). */
  slug?: string;
  modelId?: string;
  /** Pixel size (width & height). Default 28. */
  size?: number;
  className?: string;
}

export function ProviderLogo({ slug, modelId, size = 28, className }: ProviderLogoProps) {
  const provider = slug ?? (modelId ? extractProvider(modelId) : "unknown");
  const [imgFailed, setImgFailed] = useState(false);

  const asset = assetName(provider);
  const src = `/providers/${asset}.png`;

  if (imgFailed) {
    const hue = slugHue(provider);
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `hsl(${hue}, 50%, 88%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.4,
          fontWeight: 600,
          color: `hsl(${hue}, 55%, 35%)`,
          flexShrink: 0,
        }}
        aria-label={`${provider} logo`}
      >
        {initials(provider)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${provider} logo`}
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      onError={() => setImgFailed(true)}
    />
  );
}
