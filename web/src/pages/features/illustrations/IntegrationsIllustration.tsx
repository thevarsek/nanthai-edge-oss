import {
  Mail,
  FileText,
  Calendar,
  BookOpen,
  Check,
} from "lucide-react";
import {
  MockPanel,
  SkeletonCircle,
  IconSlot,
  AccentDot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Integrations Illustration                                          */
/*  Shows connected provider cards with status indicators.             */
/* ------------------------------------------------------------------ */

function MockProviderCard({
  icon,
  name,
  description,
  connected,
  color,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  name: string;
  description: string;
  connected: boolean;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] px-3.5 py-3">
      <SkeletonCircle size={34} shade="light">
        <div style={{ color }}>
          <IconSlot icon={icon} size={16} className="text-current" />
        </div>
      </SkeletonCircle>
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold efg-60">{name}</span>
        <div className="text-[9px] efg-30 mt-0.5">{description}</div>
      </div>
      {connected ? (
        <div className="flex items-center gap-1">
          <AccentDot color="var(--edge-cyan)" size={6} />
          <span className="text-[9px] font-medium efg-35">Connected</span>
        </div>
      ) : (
        <div className="rounded-full border border-[rgba(var(--edge-fg),0.10)] px-2 py-0.5">
          <span className="text-[9px] font-medium efg-30">Connect</span>
        </div>
      )}
    </div>
  );
}

export function IntegrationsIllustration() {
  return (
    <MockPanel showDots title="Integrations" className="max-w-sm mx-auto">
      <div className="space-y-2.5">
        <MockProviderCard
          icon={Mail}
          name="Google"
          description="Coming soon on web"
          connected={false}
          color="var(--edge-cyan)"
        />
        <MockProviderCard
          icon={FileText}
          name="Microsoft"
          description="Outlook, OneDrive, Calendar"
          connected={true}
          color="var(--edge-blue, #60a5fa)"
        />
        <MockProviderCard
          icon={BookOpen}
          name="Notion"
          description="Pages, databases, wikis"
          connected={false}
          color="var(--edge-amber)"
        />
        <MockProviderCard
          icon={Calendar}
          name="Apple Calendar"
          description="Events, reminders"
          connected={false}
          color="var(--edge-coral)"
        />
      </div>

      {/* Capability summary */}
      <div className="mt-4 rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-3">
        <span className="text-[9px] font-semibold efg-30 uppercase tracking-wider">Available Actions</span>
        <div className="mt-2 space-y-1.5">
          {["Read & send emails", "Browse cloud files", "Manage calendar events", "Search Notion pages"].map((action, i) => (
            <div key={i} className="flex items-center gap-2">
              <IconSlot icon={Check} size={10} className="text-[var(--edge-cyan)]" />
              <span className="text-[10px] efg-40">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </MockPanel>
  );
}
