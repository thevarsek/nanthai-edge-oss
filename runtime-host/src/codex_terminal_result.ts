import { asRecord, stringAt } from "./codex_event_items.ts";

export function codexTerminalResult(
  record: Record<string, unknown> | null,
  cancelRequested: boolean,
): ["completed" | "failed" | "cancelled" | "interrupted", string, string | null, string | null] {
  const turn = asRecord(record?.turn);
  const status = stringAt(turn, "status");
  const nativeTurnId = stringAt(turn, "id");
  if (status === "failed") return ["failed", "Codex turn failed", "codex_turn_failed", nativeTurnId];
  if (status === "interrupted") return [
    cancelRequested ? "cancelled" : "interrupted",
    cancelRequested ? "Codex turn cancelled" : "Codex turn interrupted",
    null, nativeTurnId,
  ];
  return ["completed", "Codex turn completed", null, nativeTurnId];
}
