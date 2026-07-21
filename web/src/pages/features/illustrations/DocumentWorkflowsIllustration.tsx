import {
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Presentation,
  Send,
} from "lucide-react";

import {
  IconSlot,
  MockPanel,
  SkeletonCircle,
  SkeletonLine,
} from "./IllustrationPrimitives";

const artifacts = [
  {
    icon: FileText,
    title: "Project brief",
    format: "DOCX",
    accent: "var(--edge-cyan)",
  },
  {
    icon: FileSpreadsheet,
    title: "Budget model",
    format: "XLSX",
    accent: "var(--edge-amber)",
  },
  {
    icon: Presentation,
    title: "Board update",
    format: "PPTX",
    accent: "var(--edge-coral)",
  },
];

export function DocumentWorkflowsIllustration() {
  return (
    <MockPanel showDots title="Document workflow" className="mx-auto max-w-lg">
      <div className="rounded-xl bg-[var(--edge-coral)] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <SkeletonLine width="78%" height="sm" className="bg-white/25" />
          <IconSlot icon={Send} size={13} className="ml-auto text-white/80" />
        </div>
        <SkeletonLine width="52%" height="sm" className="mt-2 bg-white/20" />
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {artifacts.map((artifact) => {
          const Icon = artifact.icon;
          return (
            <div
              key={artifact.format}
              className="rounded-xl border border-[rgba(var(--edge-fg),0.07)] bg-[rgba(var(--edge-fg),0.02)] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <SkeletonCircle size={30} shade="light">
                  <Icon size={14} style={{ color: artifact.accent }} />
                </SkeletonCircle>
                <span className="text-[8px] font-semibold tracking-[0.12em] efg-25">
                  {artifact.format}
                </span>
              </div>
              <p className="mt-4 text-[10px] font-semibold efg-65">{artifact.title}</p>
              <div className="mt-2 flex items-center gap-1 text-[8px] efg-30">
                <Check size={9} className="text-[var(--edge-cyan)]" />
                Ready in chat
              </div>
              <div className="mt-3 flex items-center gap-1.5 border-t border-[rgba(var(--edge-fg),0.06)] pt-2">
                <Download size={10} className="efg-25" />
                <span className="text-[8px] efg-25">Download</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[rgba(var(--edge-fg),0.06)] px-3 py-2.5">
        <IconSlot icon={FileText} size={13} className="efg-30" />
        <span className="text-[9px] efg-35">Continue refining from the same conversation</span>
      </div>
    </MockPanel>
  );
}
