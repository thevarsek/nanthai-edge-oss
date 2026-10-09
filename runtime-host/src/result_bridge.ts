import { z } from "zod";
import { BridgeRequestSchema, PublishResultSchema, WorkResultSchema } from "./protocol.ts";
import type { DeviceCredential } from "./control_plane.ts";
import type { LocalRuntimeTurnPacket } from "./protocol.ts";
import { HttpJsonClient } from "./http_json_client.ts";

const resultSchema = z.object({ generatedFileId: z.string(), storageId: z.string(), filename: z.string(), url: z.string().nullable() });
export function resultBridge(credential: DeviceCredential, presenceSessionId: string) {
  const client = new HttpJsonClient(credential.controlPlaneUrl);
  return async (value: unknown, packet: LocalRuntimeTurnPacket, signal: AbortSignal): Promise<string> => {
    signal.throwIfAborted();
    const request = BridgeRequestSchema.parse(value);
    if (!packet.capabilities.nanthaiTools.some((tool) => tool.id === request.tool)) throw new Error("This NanthAI capability is not bound to the current turn");
    if (request.tool === "nanthai_read_context") {
      z.strictObject({}).parse(request.arguments);
      return JSON.stringify({ ...packet.context, messageIds: packet.messages.map((message) => message.messageId) });
    }
    if (request.tool === "nanthai_update_collaboration_work") {
      const result = await client.post("/runtime-host/work/publish", {
        ...WorkResultSchema.parse(request.arguments), attemptId: packet.attemptId,
        fence: packet.fence, callId: request.callId,
      }, z.object({ committed: z.boolean() }), {
        Authorization: `Bearer ${credential.credential}`, "X-NanthAI-Device-ID": credential.deviceId,
        "X-NanthAI-Credential-ID": credential.credentialId, "X-NanthAI-Presence-Session-ID": presenceSessionId,
      }, signal);
      return JSON.stringify(result);
    }
    const file = PublishResultSchema.parse(request.arguments);
    const result = await client.post("/runtime-host/results/publish", {
      ...file, attemptId: packet.attemptId, fence: packet.fence, callId: request.callId,
    }, resultSchema, {
      Authorization: `Bearer ${credential.credential}`,
      "X-NanthAI-Device-ID": credential.deviceId,
      "X-NanthAI-Credential-ID": credential.credentialId,
      "X-NanthAI-Presence-Session-ID": presenceSessionId,
    }, signal);
    return JSON.stringify({ published: true, ...result });
  };
}
