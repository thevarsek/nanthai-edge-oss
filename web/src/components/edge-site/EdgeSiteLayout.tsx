import { cn } from "@/lib/utils";
import { EdgeSiteHeader } from "./EdgeSiteHeader";
import { EdgeSiteFooter } from "./EdgeSiteFooter";

type EdgeSiteLayoutProps = {
  activePage?: "home" | "privacy" | "terms" | "support" | "features" | "licensing";
  children: React.ReactNode;
  mainClassName?: string;
};

export function EdgeSiteLayout({
  activePage,
  children,
  mainClassName,
}: EdgeSiteLayoutProps) {
  return (
    <div className="edge-site-shell min-h-screen overflow-hidden">
      {/* Cinematic light cone — single dramatic top-center wash */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        {/* Primary light cone — top center, large elliptical wash */}
        <div
          className="absolute left-1/2 top-0 h-[80vh] w-[140vw] -translate-x-1/2 rounded-[50%] opacity-[0.07]"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, #00E0D0 0%, transparent 60%)",
          }}
        />
        {/* Warm accent — bottom right, subtle */}
        <div
          className="absolute -right-[10vw] bottom-[10vh] h-[40vh] w-[40vh] rounded-full opacity-[0.04]"
          style={{
            background:
              "radial-gradient(circle, #FFBE76 0%, transparent 70%)",
            animation: "edgeFloat 14s ease-in-out infinite",
          }}
        />
        {/* Top edge highlight — thin line of light */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(to right, transparent, var(--edge-top-highlight), transparent)` }}
        />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <EdgeSiteHeader activePage={activePage} />
        <main className={cn("flex-1", mainClassName)}>{children}</main>
        <EdgeSiteFooter />
      </div>
    </div>
  );
}
