import type { RuntimeChatEventContext } from "./chat_terminal_ingestion";

/** Helpers have a canonical run and source message, but no public generation job. */
export type RuntimeRequestEventContext = Omit<RuntimeChatEventContext, "job"> & {
  job: Pick<RuntimeChatEventContext["job"], "chatId" | "runtimeCommandRecordId" | "sourceExecutionId"> & {
    _id?: RuntimeChatEventContext["job"]["_id"];
  };
};
