// components/shared/PersonaAvatar.tsx
// 4-tier avatar fallback matching iOS PersonaAvatarBadgeView:
// 1. Avatar image URL → circular image
// 2. Emoji → centered in circle
// 3. First letter of persona name → primary-colored initial
// 4. Generic icon → muted theater masks equivalent

import { useContext, useState } from "react";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { SharedDataContext } from "@/hooks/useSharedData";

interface PersonaAvatarProps {
  personaId?: string;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  /** Size in Tailwind w/h units (default: w-9 h-9 = 36px) */
  className?: string;
  /** Font size for emoji tier (default: text-lg) */
  emojiClass?: string;
  /** Font size for initial letter tier (default: text-sm) */
  initialClass?: string;
  /** Icon size for fallback tier (default: 16) */
  iconSize?: number;
}

export function PersonaAvatar({
  personaId,
  personaName,
  personaEmoji,
  personaAvatarImageUrl,
  className = "w-9 h-9",
  emojiClass = "text-lg",
  initialClass = "text-sm",
  iconSize = 16,
}: PersonaAvatarProps) {
  const sharedData = useContext(SharedDataContext);
  const [didImageFail, setDidImageFail] = useState(false);
  const resolvedPersona = !personaId || !sharedData?.personas
    ? null
    : sharedData.personas.find((persona) => persona._id === personaId) ?? null;

  const resolvedName = resolvedPersona?.displayName ?? personaName;
  const resolvedEmoji = resolvedPersona?.avatarEmoji ?? personaEmoji;
  const resolvedImageUrl = resolvedPersona?.avatarImageUrl ?? personaAvatarImageUrl;

  // Tier 1: Avatar image
  if (resolvedImageUrl && !didImageFail) {
    return (
      <img
        src={resolvedImageUrl}
        alt={resolvedName ?? ""}
        className={cn("rounded-full object-cover flex-shrink-0", className)}
        onError={() => setDidImageFail(true)}
      />
    );
  }

  // Tier 2: Emoji
  if (resolvedEmoji) {
    return (
      <div className={cn("rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0", className)}>
        <span className={emojiClass}>{resolvedEmoji}</span>
      </div>
    );
  }

  // Tier 3: First letter of persona name
  if (resolvedName && resolvedName.length > 0) {
    return (
      <div className={cn("rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0", className)}>
        <span className={cn("font-semibold text-primary", initialClass)}>
          {resolvedName.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  // Tier 4: Generic icon fallback
  return (
    <div className={cn("rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0", className)}>
      <User size={iconSize} className="text-muted" />
    </div>
  );
}
