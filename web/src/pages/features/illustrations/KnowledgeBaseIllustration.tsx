import {
  BookOpen,
  FileText,
  Upload,
  Paperclip,
} from "lucide-react";
import {
  MockPanel,
  SkeletonCircle,
  IconSlot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Knowledge Base Illustration                                        */
/*  Shows uploaded document cards with attachment indicators.           */
/* ------------------------------------------------------------------ */

function MockDocumentRow({
  name,
  type,
  size,
  attached,
}: {
  name: string;
  type: string;
  size: string;
  attached?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 hover:bg-[rgba(var(--edge-fg),0.03)] transition-colors">
      <SkeletonCircle size={30} shade="light">
        <IconSlot icon={FileText} size={13} className="efg-30" />
      </SkeletonCircle>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium efg-55 truncate">{name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[8px] efg-25 uppercase">{type}</span>
          <span className="text-[8px] efg-20">·</span>
          <span className="text-[8px] efg-25">{size}</span>
        </div>
      </div>
      {attached && (
        <div className="flex items-center gap-1">
          <IconSlot icon={Paperclip} size={10} className="text-[var(--edge-cyan)]" />
          <span className="text-[8px] font-medium text-[var(--edge-cyan)]">Attached</span>
        </div>
      )}
    </div>
  );
}

export function KnowledgeBaseIllustration() {
  return (
    <MockPanel showDots title="Knowledge Base" className="max-w-sm mx-auto">
      {/* Upload zone */}
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[rgba(var(--edge-fg),0.12)] bg-[rgba(var(--edge-fg),0.02)] px-4 py-5 mb-3">
        <SkeletonCircle size={36} shade="light">
          <IconSlot icon={Upload} size={16} className="efg-30" />
        </SkeletonCircle>
        <span className="text-[10px] efg-30">Drop files here or tap to upload</span>
        <span className="text-[8px] efg-20">PDF, DOCX, XLSX, TXT</span>
      </div>

      {/* Document list */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 px-2.5 mb-1">
          <IconSlot icon={BookOpen} size={11} className="efg-25" />
          <span className="text-[9px] font-semibold efg-30 uppercase tracking-wider">3 documents</span>
        </div>
        <MockDocumentRow name="Q4 Revenue Report.pdf" type="pdf" size="2.4 MB" attached />
        <MockDocumentRow name="Product Requirements.docx" type="docx" size="856 KB" attached />
        <MockDocumentRow name="Customer Research.xlsx" type="xlsx" size="1.1 MB" />
      </div>
    </MockPanel>
  );
}
