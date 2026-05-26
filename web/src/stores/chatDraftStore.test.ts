import { describe, expect, it } from "vitest";
import { clearChatDraft, getChatDraft, setChatDraft } from "./chatDraftStore";

const attachment = {
  name: "notes.pdf",
  type: "file",
  mimeType: "application/pdf",
};

describe("chatDraftStore", () => {
  it("does not share mutable empty drafts across missing chats", () => {
    const missing = getChatDraft("missing-a");
    missing.attachments.push(attachment);
    missing.text = "mutated";

    expect(getChatDraft("missing-b")).toEqual({ text: "", attachments: [] });
    expect(getChatDraft("missing-a")).toEqual({ text: "", attachments: [] });
  });

  it("returns defensive copies for stored drafts", () => {
    setChatDraft("chat-1", { text: "hello", attachments: [attachment] });

    const firstRead = getChatDraft("chat-1");
    firstRead.text = "changed";
    firstRead.attachments[0].name = "mutated.pdf";
    firstRead.attachments.pop();

    expect(getChatDraft("chat-1")).toEqual({ text: "hello", attachments: [attachment] });

    clearChatDraft("chat-1");
  });

  it("does not retain caller-owned attachment object references", () => {
    const callerAttachment = { ...attachment };
    setChatDraft("chat-2", { text: "hello", attachments: [callerAttachment] });

    callerAttachment.name = "changed.pdf";

    expect(getChatDraft("chat-2")).toEqual({ text: "hello", attachments: [attachment] });

    clearChatDraft("chat-2");
  });
});
