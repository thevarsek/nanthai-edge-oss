import type {
  CodexInputPart,
  CodexModel,
  StartCodexSessionInput,
} from "../codex_transport.ts";

export function startParams(input: StartCodexSessionInput): Record<string, unknown> {
  return {
    config: {
      "features.default_mode_request_user_input": true,
      ...(input.webSearch === undefined ? {} : { web_search: input.webSearch }),
    },
    ...(input.dynamicTools?.length ? { dynamicTools: input.dynamicTools } : {}),
    ...(input.workingDirectory === undefined ? {} : { cwd: input.workingDirectory }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.approvalPolicy === undefined ? {} : { approvalPolicy: input.approvalPolicy }),
    ...(input.sandboxMode === undefined ? {} : { sandbox: input.sandboxMode }),
    ...(input.baseInstructions === undefined
      ? {} : { baseInstructions: input.baseInstructions }),
    ...(input.developerInstructions === undefined
      ? {} : { developerInstructions: input.developerInstructions }),
  };
}

export function toAppServerInput(part: CodexInputPart): Record<string, unknown> {
  switch (part.type) {
    case "text": return { type: "text", text: part.text };
    case "local_image": return { type: "localImage", path: part.path };
    case "remote_image": return { type: "image", url: part.url };
    case "local_audio":
    case "remote_audio": throw new Error("App Server turn audio is not a supported public input");
  }
}

export function parseThreadStart(value: unknown) {
  const threadId = nestedString(value, "thread", "id");
  if (threadId === null) throw new Error("App Server response omitted thread.id");
  return {
    threadId,
    model: nestedString(value, "model"),
    provider: nestedString(value, "modelProvider"),
    cwd: nestedString(value, "cwd"),
  };
}

export function parseTurnId(value: unknown): string {
  const turnId = nestedString(value, "turn", "id");
  if (turnId === null) throw new Error("App Server response omitted turn.id");
  return turnId;
}

export function parseModels(value: unknown): CodexModel[] {
  const record = asRecord(value);
  if (!Array.isArray(record?.data)) throw new Error("App Server model/list omitted data");
  return record.data.map((entry) => {
    const model = asRecord(entry);
    if (model === null || typeof model.id !== "string" || typeof model.model !== "string") {
      throw new Error("App Server returned an invalid model entry");
    }
    return {
      id: model.id,
      model: model.model,
      displayName: typeof model.displayName === "string" ? model.displayName : model.id,
      inputModalities: Array.isArray(model.inputModalities)
        ? model.inputModalities.filter((item): item is string => typeof item === "string")
        : [],
      hidden: model.hidden === true,
      isDefault: model.isDefault === true,
    };
  });
}

export function nestedString(value: unknown, ...path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) current = asRecord(current)?.[key];
  return typeof current === "string" ? current : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
