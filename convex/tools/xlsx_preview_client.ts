import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ToolExecutionContext } from "./registry";

interface XlsxPreviewResult {
  preview: {
    storageId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string | null;
  };
  validation: {
    engine: "openpyxl";
    sheetCount: number;
    formulaCount: number;
    formulaErrors: string[];
    truncated: boolean;
  };
}

const createPreviewRef = makeFunctionReference<
  "action",
  { userId: string; chatId: string; storageId: Id<"_storage">; title: string },
  XlsxPreviewResult
>("tools/xlsx_preview_actions:createPreview") as unknown as FunctionReference<
  "action",
  "internal",
  { userId: string; chatId: string; storageId: Id<"_storage">; title: string },
  XlsxPreviewResult
>;

export async function tryCreateXlsxPreview(
  toolCtx: ToolExecutionContext,
  storageId: Id<"_storage">,
  title: string,
  enabled: boolean,
): Promise<{ result?: XlsxPreviewResult; warning?: string }> {
  if (!enabled || !toolCtx.chatId || !toolCtx.userId) return {};
  try {
    return {
      result: await toolCtx.ctx.runAction(createPreviewRef, {
        userId: toolCtx.userId,
        chatId: toolCtx.chatId,
        storageId,
        title,
      }),
    };
  } catch (error) {
    return {
      warning: `Workbook created, but server-side validation/preview was unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function xlsxPreviewWarnings(
  preview: { result?: XlsxPreviewResult; warning?: string },
): string[] {
  if (preview.warning) return [preview.warning];
  const warnings: string[] = [];
  if (preview.result?.validation.formulaErrors.length) {
    warnings.push(
      `Workbook validation found ${preview.result.validation.formulaErrors.length} cached formula error(s).`,
    );
  }
  if (preview.result?.validation.truncated) {
    warnings.push("The companion PDF preview is limited to the first 100 rows and 16 columns per sheet.");
  }
  return warnings;
}
