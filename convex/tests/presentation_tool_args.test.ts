import assert from "node:assert/strict";
import test from "node:test";
import {
  optionalPresentationStorageId,
  presentationAssetStorageIds,
} from "../tools/presentation_tool_args";
import { createPresentationNode } from "../tools/presentation_tools_node";

test("scratch presentation args omit blank source and asset storage IDs", () => {
  assert.equal(optionalPresentationStorageId(undefined), undefined);
  assert.equal(optionalPresentationStorageId(""), undefined);
  assert.equal(optionalPresentationStorageId("   "), undefined);
  assert.equal(optionalPresentationStorageId("**omit**"), undefined);
  assert.equal(optionalPresentationStorageId("__omit__"), undefined);
  assert.equal(optionalPresentationStorageId(" OMIT "), undefined);
  assert.equal(optionalPresentationStorageId(" omitted "), undefined);
  assert.equal(optionalPresentationStorageId("undefined"), undefined);
  assert.equal(optionalPresentationStorageId("null"), undefined);
  assert.equal(optionalPresentationStorageId(" storage_source "), "storage_source");
  assert.deepEqual(
    presentationAssetStorageIds(["", " asset_1 ", "asset_1", null, "asset_2"]),
    ["asset_1", "asset_2"],
  );
  assert.equal(presentationAssetStorageIds(["", "  "]), undefined);
  assert.deepEqual(
    presentationAssetStorageIds(["**omit**", "__omit__", " asset_1 ", "none"]),
    ["asset_1"],
  );
});

test("create presentation defers expensive phases after creating the chat project", async () => {
  const mutationArgs: Array<Record<string, unknown>> = [];
  const result = await createPresentationNode.execute({
    ctx: {
      runQuery: async () => ({
        _id: "user_message_1",
        role: "user",
        chatId: "chat_1",
        content: "Source fact: inference cost changes product architecture.",
      }),
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutationArgs.push(args);
        return "project_1";
      },
    } as never,
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    userMessageId: "user_message_1",
    jobId: "job_1",
    modelId: "openai/gpt-5",
  }, {
    brief: "Explain the durable workflow",
    audience: "Product leaders",
    tone: "Concise and technical",
    sourceStorageId: "**omit**",
  });

  assert.equal(mutationArgs.length, 1);
  assert.equal(mutationArgs[0]?.sourceStorageId, undefined);
  assert.match(String(mutationArgs[0]?.prompt), /inference cost changes/);
  assert.equal(result.success, true);
  assert.deepEqual(result.deferred, {
    kind: "presentation_workflow",
    data: { projectId: "project_1" },
  });
});

test("create presentation exposes and enforces the 1-20 slide contract before mutation", async () => {
  const definition = createPresentationNode.definition;
  assert.ok("function" in definition);
  const parameters = definition.function.parameters as {
    properties: Record<string, Record<string, unknown>>;
  };
  assert.equal(parameters.properties.slideCount?.minimum, 1);
  assert.equal(parameters.properties.slideCount?.maximum, 20);
  assert.equal(parameters.properties.approvedOutline?.maxItems, 20);

  let mutationCalls = 0;
  const result = await createPresentationNode.execute({
    ctx: {
      runMutation: async () => {
        mutationCalls += 1;
        return "project_1";
      },
    } as never,
    userId: "user_1",
    modelId: "openai/gpt-5",
  }, {
    brief: "Explain the system",
    audience: "Product leaders",
    tone: "Direct",
    slideCount: 21,
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /1 to 20 slides/);
  assert.equal(mutationCalls, 0);
});

test("create presentation rejects an approved outline count mismatch before mutation", async () => {
  let mutationCalls = 0;
  const result = await createPresentationNode.execute({
    ctx: {
      runMutation: async () => {
        mutationCalls += 1;
        return "project_1";
      },
    } as never,
    userId: "user_1",
    modelId: "openai/gpt-5",
  }, {
    brief: "Explain the system",
    audience: "Product leaders",
    tone: "Direct",
    slideCount: 2,
    approvedOutline: [{ title: "Only one slide" }],
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /slideCount must match/);
  assert.equal(mutationCalls, 0);
});
