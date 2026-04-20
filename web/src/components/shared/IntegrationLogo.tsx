/**
 * Integration logo component — renders integration PNGs from /integrations/.
 * Falls back to a colored-initials circle if the image fails to load.
 */

import { useState } from "react";

// ─── Known integration slugs ───────────────────────────────────────────

const knownIntegrations: Record<string, { file: string; ext?: string }> = {
  gmail: { file: "integration_gmail" },
  "google-calendar": { file: "integration_google_calendar" },
  "google-drive": { file: "integration_google_drive" },
  "google-workspace": { file: "integration_google_workspace", ext: "webp" },
  "apple-calendar": { file: "integration_apple_calendar" },
  notion: { file: "integration_notion" },
  slack: { file: "integration_slack" },
  cloze: { file: "integration_cloze" },
  "ms-calendar": { file: "integration_outlook" }, // MS Calendar shares Outlook branding
  "microsoft-365": { file: "integration_microsoft_365" },
  outlook: { file: "integration_outlook" },
  onedrive: { file: "integration_onedrive" },
  excel: { file: "integration_excel" },
  word: { file: "integration_word" },
  powerpoint: { file: "integration_powerpoint" },
};

function assetSrc(slug: string): string {
  const entry = knownIntegrations[slug];
  if (entry) {
    return `/integrations/${entry.file}.${entry.ext ?? "png"}`;
  }
  return `/integrations/integration_${slug.replace(/-/g, "_")}.png`;
}

function slugHue(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash + slug.charCodeAt(i)) * 31) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

function initials(slug: string): string {
  const words = slug.split("-");
  if (words.length >= 2) {
    return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
  }
  return slug.charAt(0).toUpperCase() + (slug.charAt(1)?.toLowerCase() ?? "");
}

// ─── Component ──────────────────────────────────────────────────────────

interface IntegrationLogoProps {
  slug: string;
  size?: number;
  className?: string;
}

export function IntegrationLogo({ slug, size = 28, className }: IntegrationLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = assetSrc(slug);

  if (imgFailed) {
    const hue = slugHue(slug);
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
        aria-label={`${slug} logo`}
      >
        {initials(slug)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${slug} logo`}
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
      onError={() => setImgFailed(true)}
    />
  );
}
