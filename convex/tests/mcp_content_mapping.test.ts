import assert from "node:assert/strict";
import test from "node:test";
import { mapMcpInvocationContent } from "../mcp/content_mapping";

test("mapMcpInvocationContent deletes blobs stored before a later mapping failure", async () => {
  const deleted: string[] = [];
  let stores = 0;
  const ctx = {
    storage: {
      store: async () => {
        stores += 1;
        if (stores === 2) throw new Error("storage failed");
        return "storage_1";
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  };

  await assert.rejects(() => mapMcpInvocationContent({
    ctx: ctx as never,
    result: {
      content: [
        { type: "image", data: Buffer.from("one").toString("base64"), mimeType: "image/png" },
        { type: "image", data: Buffer.from("two").toString("base64"), mimeType: "image/png" },
      ],
    },
    serverName: "Server",
    itemName: "Resource",
    kind: "resource",
  }), /storage failed/);

  assert.deepEqual(deleted, ["storage_1"]);
});
