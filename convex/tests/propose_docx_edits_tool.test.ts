import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { proposeDocxEdits } from "../tools/propose_docx_edits";
import type { ToolExecutionContext } from "../tools/registry";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function docxWithText(text: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return await zip.generateAsync({ type: "arraybuffer" });
}

test("propose_docx_edits deletes stored rewrite bytes when commit fails", async () => {
  const sourceBytes = await docxWithText("Seller shall pay.");
  const deletedStorageIds: string[] = [];
  const storedStorageIds: string[] = [];

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    generationKey: "generation_1",
    ctx: {
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        if ("storageId" in args) {
          throw new Error("stale source version");
        }
        return [{
          ref: "doc-0",
          documentId: "document_1",
          versionId: "version_1",
          filename: "Agreement.docx",
          title: "Agreement",
          mimeType: DOCX_MIME,
          source: "generated",
          storageId: "storage_source",
        }];
      },
      runQuery: async () => ({ editCount: 0 }),
      storage: {
        get: async () => new Blob([sourceBytes], { type: DOCX_MIME }),
        store: async () => {
          storedStorageIds.push("storage_rewrite");
          return "storage_rewrite";
        },
        delete: async (storageId: string) => {
          deletedStorageIds.push(storageId);
        },
      },
    },
  };

  const result = await proposeDocxEdits.execute(toolCtx as unknown as ToolExecutionContext, {
    doc_id: "doc-0",
    edits: [{ find: "Seller", replace: "Buyer" }],
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /stale source version/);
  assert.deepEqual(storedStorageIds, ["storage_rewrite"]);
  assert.deepEqual(deletedStorageIds, ["storage_rewrite"]);
});
