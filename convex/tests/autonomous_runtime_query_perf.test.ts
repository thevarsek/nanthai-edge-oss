import assert from "node:assert/strict";
import test from "node:test";

import { listActiveSessions, listSessions } from "../autonomous/queries";
import { getSessionByChatInternal } from "../runtime/queries";

test("listActiveSessions reads running and paused sessions via by_chat_status", async () => {
  const indexCalls: Array<{ index: string; status?: string }> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        return null;
      },
      query: (table: string) => {
        assert.equal(table, "autonomousSessions");
        return {
          withIndex: (index: string, apply: (query: any) => any) => {
            let status: string | undefined;
            apply({
              eq: (_field: string, value: string) => ({
                eq: (_statusField: string, statusValue: string) => {
                  status = statusValue;
                  return {};
                },
              }),
            });
            indexCalls.push({ index, status });
            return {
              take: async () => status === "running"
                ? [{ _id: "session_running", status: "running", currentCycle: 1, maxCycles: 3, currentParticipantIndex: 0, createdAt: 10 }]
                : [{ _id: "session_paused", status: "paused", currentCycle: 2, maxCycles: 3, currentParticipantIndex: 1, createdAt: 20 }],
            };
          },
        };
      },
    },
  } as any;

  const result = await (listActiveSessions as any)._handler(ctx, { chatId: "chat_1" });

  assert.deepEqual(indexCalls, [
    { index: "by_chat_status", status: "running" },
    { index: "by_chat_status", status: "paused" },
  ]);
  assert.deepEqual(result.map((session: any) => session.status), ["paused", "running"]);
});

test("listSessions deduplicates repeated chat title lookups", async () => {
  const chatGetCalls: string[] = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        chatGetCalls.push(id);
        if (id === "chat_1") return { _id: "chat_1", title: "Shared Chat" };
        if (id === "chat_2") return { _id: "chat_2", title: "Second Chat" };
        return null;
      },
      query: (table: string) => {
        assert.equal(table, "autonomousSessions");
        return {
          withIndex: (index: string, _apply: (query: any) => any) => {
            assert.equal(index, "by_user_created");
            return {
              order: (_direction: string) => ({
                take: async () => [
                  { _id: "session_1", chatId: "chat_1", status: "running", createdAt: 30 },
                  { _id: "session_2", chatId: "chat_1", status: "paused", createdAt: 20 },
                  { _id: "session_3", chatId: "chat_2", status: "ended", createdAt: 10 },
                ],
              }),
            };
          },
        };
      },
    },
  } as any;

  const result = await (listSessions as any)._handler(ctx, {});

  assert.deepEqual(chatGetCalls, ["chat_1", "chat_2"]);
  assert.deepEqual(result.map((session: any) => session.chatTitle), [
    "Shared Chat",
    "Shared Chat",
    "Second Chat",
  ]);
});

test("getSessionByChatInternal uses by_chat_user_environment index", async () => {
  const indexCalls: string[] = [];
  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "sandboxSessions");
        return {
          withIndex: (index: string, apply: (query: any) => any) => {
            indexCalls.push(index);
            let chatId = "";
            let userId = "";
            let environment = "";
            apply({
              eq: (_field: string, firstValue: string) => {
                chatId = firstValue;
                return {
                  eq: (_userField: string, secondValue: string) => {
                    userId = secondValue;
                    return {
                      eq: (_envField: string, thirdValue: string) => {
                        environment = thirdValue;
                        return {};
                      },
                    };
                  },
                };
              },
            });
            return {
              collect: async () => [
                { _id: "sandbox_1", chatId, userId, environment, updatedAt: 10 },
                { _id: "sandbox_2", chatId, userId, environment, updatedAt: 20 },
              ],
            };
          },
        };
      },
    },
  } as any;

  const result = await (getSessionByChatInternal as any)._handler(ctx, {
    userId: "user_1",
    chatId: "chat_1",
    environment: "python",
  });

  assert.deepEqual(indexCalls, ["by_chat_user_environment"]);
  assert.equal(result?._id, "sandbox_2");
});
