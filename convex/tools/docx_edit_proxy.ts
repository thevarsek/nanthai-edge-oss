import { makeFunctionReference, type FunctionReference } from "convex/server";
import { createActionProxyTool, type ExecuteProxyToolArgs } from "./action_proxy";
import type { ToolResult } from "./registry";

type DocxEditToolName =
  | "propose_docx_edits";

const executeDocxEditToolRef = makeFunctionReference<
  "action",
  ExecuteProxyToolArgs<DocxEditToolName>,
  ToolResult
>("tools/docx_edit_actions:executeDocxEditTool") as unknown as FunctionReference<
  "action",
  "internal",
  ExecuteProxyToolArgs<DocxEditToolName>,
  ToolResult
>;

export const proposeDocxEdits = createActionProxyTool(executeDocxEditToolRef, "propose_docx_edits", { name: "propose_docx_edits", description: "Propose precise edits to a scoped Microsoft Word .docx as Word tracked changes. Use read_document first. Each edit should be a minimal substitution with short copied context anchors.", parameters: {"type":"object","properties":{"doc_id":{"type":"string","description":"Scoped document handle, document ID, version ID, storage ID, or exact filename."},"edits":{"type":"array","description":"Minimal anchored replacements to propose as tracked changes.","items":{"type":"object","properties":{"find":{"type":"string"},"replace":{"type":"string"},"context_before":{"type":"string"},"context_after":{"type":"string"},"reason":{"type":"string"}},"required":["find","replace"],"additionalProperties":false}}},"required":["doc_id","edits"],"additionalProperties":false} });
