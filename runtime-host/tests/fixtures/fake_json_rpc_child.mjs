import { existsSync } from "node:fs";
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.153.4\n");
  process.exit(0);
}

const input = readline.createInterface({ input: process.stdin });
let threadCounter = 0;
let pendingApproval = null;
let pendingClientRequest = null;
let lastThreadStart = null;
let interruptCount = 0;
const injectedItems = [];
const threadNames = {};
const methodOrder = [];
let codexDialect = false;
let experimentalApi = false;
let lastInitialize = null;
function send(message) {
  const wire = codexDialect
    ? Object.fromEntries(Object.entries(message).filter(([key]) => key !== "jsonrpc"))
    : message;
  process.stdout.write(`${JSON.stringify(wire)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function reject(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function completeTurn(threadId, turnId, status = "completed") {
  send({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId,
      turn: { id: turnId, status, items: [] },
    },
  });
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  codexDialect ||= message.jsonrpc === undefined;
  if (typeof message.method === "string") methodOrder.push(message.method);
  if (message.method === "initialized") return;
  if (message.id === 0) {
    completeTurn(pendingApproval.threadId, pendingApproval.turnId);
    pendingApproval = null;
    return;
  }
  if (message.id === "client-request-1") {
    respond(pendingClientRequest, message.result);
    pendingClientRequest = null;
    return;
  }
  if (message.method === "echo") {
    respond(message.id, message.params);
    return;
  }
  if (message.method === "ask-client") {
    pendingClientRequest = message.id;
    send({
      jsonrpc: "2.0",
      id: "client-request-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-basic", turnId: "turn-basic", itemId: "item-basic" },
    });
    return;
  }
  if (message.method === "malformed") {
    process.stdout.write("not-json\n");
    return;
  }
  if (message.method === "initialize") {
    lastInitialize = message.params;
    experimentalApi = message.params?.capabilities?.experimentalApi === true;
    respond(message.id, {
      codexHome: "/tmp/fake-codex",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "fake",
    });
    return;
  }
  if (message.method === "debug/state") {
    respond(message.id, {
      lastInitialize, lastThreadStart, injectedItems, interruptCount, threadNames, methodOrder,
    });
    return;
  }
  if (message.method === "debug/late-events") {
    completeTurn(message.params.threadId, message.params.turnId);
    send({ jsonrpc: "2.0", method: "thread/status/changed", params: {
      threadId: message.params.threadId, status: { type: "idle" },
    } });
    send({ jsonrpc: "2.0", method: "warning", params: { message: "Late global warning" } });
    respond(message.id, {});
    return;
  }
  if (message.method === "thread/turns/list") {
    respond(message.id, { data: [{ id: "turn-owned", status: "completed" }], nextCursor: null });
    return;
  }
  if (message.method === "model/list") {
    respond(message.id, {
      data: [{
        id: "gpt-test",
        model: "gpt-test",
        displayName: "GPT Test",
        inputModalities: ["text", "image"],
        hidden: false,
        isDefault: true,
      }],
    });
    return;
  }
  if (message.method === "account/read") {
    respond(message.id, {
      account: { type: "chatgpt", email: "personal@example.test", planType: "pro" },
      requiresOpenaiAuth: true,
    });
    return;
  }
  if (message.method === "account/rateLimits/read") {
    respond(message.id, {
      rateLimits: {
        limitId: "codex",
        limitName: "Codex",
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_786_752_000 },
        secondary: null,
        planType: "pro",
      },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: null,
    });
    return;
  }
  if (message.method === "thread/start" || message.method === "thread/resume") {
    lastThreadStart = message.params;
    const threadId = message.params?.threadId ?? `thread-${++threadCounter}`;
    respond(message.id, {
      thread: { id: threadId },
      model: message.params?.model ?? "gpt-test",
      modelProvider: "openai",
      cwd: message.params?.cwd ?? process.cwd(),
    });
    return;
  }
  if (message.method === "thread/inject_items") {
    injectedItems.push(...message.params.items);
    respond(message.id, {});
    return;
  }
  if (message.method === "thread/name/set") {
    if (message.params.name === "FAIL_RENAME") {
      reject(message.id, -32_000, "deterministic thread naming failure");
      return;
    }
    threadNames[message.params.threadId] = message.params.name;
    respond(message.id, {});
    return;
  }
  if (message.method === "turn/start") {
    const threadId = message.params.threadId;
    const turnId = `turn-${threadId}`;
    const text = message.params.input?.find((part) => part.type === "text")?.text ?? "";
    const localImage = message.params.input?.find((part) => part.type === "localImage")?.path;
    const start = () => {
      respond(message.id, { turn: { id: turnId, status: "inProgress", items: [] } });
      const responseText = text.includes("REPORT_LOCAL_IMAGE")
        ? localImage !== undefined && existsSync(localImage) ? "LOCAL_IMAGE_OK" : "LOCAL_IMAGE_MISSING"
        : text.includes("REPORT_THREAD_NAME") ? threadNames[threadId] ?? "UNNAMED" : "hello";
      continueTurn(threadId, turnId, text, responseText);
    };
    if (text.includes("SLOW_START")) setTimeout(start, 30);
    else start();
    return;
  }
  if (message.method === "turn/interrupt") {
    interruptCount += 1;
    respond(message.id, {});
    completeTurn(message.params.threadId, message.params.turnId, "interrupted");
  }
});

function continueTurn(threadId, turnId, text, responseText) {
    if (text.includes("MALFORMED_WARNING")) {
      send({
        jsonrpc: "2.0",
        method: "warning",
        params: { threadId, turnId },
      });
      return;
    }
    if (text.includes("WARNING")) {
      send({
        jsonrpc: "2.0",
        method: "warning",
        params: {
          threadId,
          message: "Skill descriptions were shortened to fit the skills context budget.",
        },
      });
    }
    if (text.includes("CRASH")) {
      setImmediate(() => process.exit(7));
      return;
    }
    if (text.includes("NATIVE_AGENT")) {
      runNativeAgentTurn(threadId, turnId);
      return;
    }
    send({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId: "message-1", delta: responseText },
    });
    if (text.includes("UNKNOWN")) {
      send({
        jsonrpc: "2.0",
        method: "unsupported//Users/private/repository",
        params: { threadId, turnId },
      });
      if (text.includes("TERMINAL_QUEUED")) completeTurn(threadId, turnId);
      return;
    }
    if (text.includes("APPROVAL")) {
      const target = /TARGET=([^\s]+)/.exec(text)?.[1];
      pendingApproval = { threadId, turnId };
      send({
        jsonrpc: "2.0",
        id: 0,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId,
          itemId: "command-1",
          command: target === undefined ? "printf harmless" : `touch ${target}`,
          reason: "test approval",
          startedAtMs: Date.now(),
        },
      });
      return;
    }
    if (!text.includes("WAIT")) completeTurn(threadId, turnId);
}
function runNativeAgentTurn(threadId, turnId) {
  if (!experimentalApi) {
    send({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: {
      threadId, turnId, itemId: "root-message-1", delta: "Root final answer",
    } });
    completeTurn(threadId, turnId);
    return;
  }
  const childThreadId = `${threadId}-child-1`;
  send({ jsonrpc: "2.0", method: "item/started", params: {
    threadId,
    turnId,
    item: {
      type: "subAgentActivity",
      id: "spawn-activity-1",
      kind: "started",
      agentThreadId: childThreadId,
      agentPath: "/root/scout",
    },
    startedAtMs: Date.now(),
  } });
  send({ jsonrpc: "2.0", method: "item/completed", params: {
    threadId, turnId, item: {
      type: "subAgentActivity", id: "spawn-activity-1", kind: "started",
      agentThreadId: childThreadId, agentPath: "/root/scout",
    }, completedAtMs: Date.now(),
  } });
  send({ jsonrpc: "2.0", method: "thread/status/changed", params: {
    threadId: childThreadId, status: { type: "idle" },
  } });
  send({ jsonrpc: "2.0", method: "thread/status/changed", params: {
    threadId: childThreadId, status: { type: "active", activeFlags: [] },
  } });
  send({ jsonrpc: "2.0", method: "turn/started", params: {
    threadId: childThreadId,
    turn: { id: "child-turn-1", status: "inProgress", items: [] },
  } });
  send({ jsonrpc: "2.0", method: "item/started", params: {
    threadId: childThreadId, turnId: "child-turn-1",
    item: { type: "agentMessage", id: "child-message-1", text: "", phase: "final_answer" },
  } });
  send({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: {
    threadId: childThreadId,
    turnId: "child-turn-1",
    itemId: "child-message-1",
    delta: "Child result stays backstage",
  } });
  send({ jsonrpc: "2.0", method: "item/completed", params: {
    threadId: childThreadId, turnId: "child-turn-1",
    item: {
      type: "agentMessage", id: "child-message-1",
      text: "Child result stays backstage", phase: "final_answer",
    },
  } });
  send({ jsonrpc: "2.0", method: "thread/status/changed", params: {
    threadId: childThreadId, status: { type: "idle" },
  } });
  completeTurn(childThreadId, "child-turn-1");
  send({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: {
    threadId, turnId, itemId: "root-message-1", delta: "Root final answer",
  } });
  completeTurn(threadId, turnId);
}
