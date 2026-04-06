import {
  Key,
  ExternalLink,
  Shield,
  Server,
} from "lucide-react";
import {
  MockPanel,
  SkeletonCircle,
  IconSlot,
  AccentDot,
  SkeletonDivider,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Bring Your Own Key Illustration                                    */
/*  Shows OpenRouter connection + provider key cards.                   */
/* ------------------------------------------------------------------ */

function MockProviderKeyRow({
  name,
  connected,
  color,
}: {
  name: string;
  connected: boolean;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <SkeletonCircle size={26} shade="light">
        <IconSlot icon={Server} size={11} className="efg-30" />
      </SkeletonCircle>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-medium efg-50">{name}</span>
      </div>
      {connected ? (
        <div className="flex items-center gap-1">
          <AccentDot color={color} size={6} />
          <span className="text-[8px] font-medium efg-35">Active</span>
        </div>
      ) : (
        <div className="rounded-full border border-[rgba(var(--edge-fg),0.10)] px-2 py-0.5">
          <span className="text-[8px] font-medium efg-25">Add Key</span>
        </div>
      )}
    </div>
  );
}

export function BYOKIllustration() {
  return (
    <MockPanel showDots title="API Keys" className="max-w-sm mx-auto">
      {/* OpenRouter connection */}
      <div className="rounded-xl border border-[var(--edge-cyan)]/20 bg-[var(--edge-cyan)]/5 p-3.5 mb-4">
        <div className="flex items-center gap-2.5 mb-2">
          <SkeletonCircle size={32} shade="light">
            <IconSlot icon={Key} size={14} className="text-[var(--edge-cyan)]" />
          </SkeletonCircle>
          <div>
            <span className="text-[11px] font-semibold efg-70">OpenRouter</span>
            <div className="flex items-center gap-1 mt-0.5">
              <AccentDot color="var(--edge-cyan)" size={6} />
              <span className="text-[9px] font-medium text-[var(--edge-cyan)]">Connected</span>
            </div>
          </div>
          <div className="ml-auto">
            <IconSlot icon={ExternalLink} size={12} className="efg-25" />
          </div>
        </div>
        <div className="text-[9px] efg-35 leading-relaxed">
          Every token billed at OpenRouter's listed rate. No markup.
        </div>
      </div>

      {/* Provider keys */}
      <div className="rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] px-3.5">
        <div className="flex items-center gap-1.5 pt-3 pb-1">
          <IconSlot icon={Shield} size={11} className="efg-25" />
          <span className="text-[9px] font-semibold efg-30 uppercase tracking-wider">Provider Keys (Optional)</span>
        </div>
        <MockProviderKeyRow name="AWS Bedrock" connected={true} color="var(--edge-amber)" />
        <SkeletonDivider />
        <MockProviderKeyRow name="Google AI" connected={false} color="var(--edge-cyan)" />
        <SkeletonDivider />
        <MockProviderKeyRow name="Azure OpenAI" connected={false} color="var(--edge-blue, #60a5fa)" />
        <div className="pb-2" />
      </div>

      {/* Info note */}
      <div className="mt-3 text-[9px] efg-30 leading-relaxed text-center">
        Add provider keys on OpenRouter to use your own cloud accounts.
      </div>
    </MockPanel>
  );
}
