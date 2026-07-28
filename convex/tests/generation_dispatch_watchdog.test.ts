import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueRunGeneration,
  reconcileRunGenerationDispatchHandler,
} from "../chat/run_generation_queue";

const generationArgs = {
  chatId: "chat_1",
  userMessageId: "user_message_1",
  assistantMessageIds: ["assistant_1", "assistant_2"],
  generationJobIds: ["job_1", "job_2"],
  participants: [
    {
      modelId: "openai/gpt-5",
      messageId: "assistant_1",
      jobId: "job_1",
    },
    {
      modelId: "anthropic/claude-sonnet-4",
      messageId: "assistant_2",
      jobId: "job_2",
    },
  ],
  userId: "user_1",
  expandMultiModelGroups: false,
  webSearchEnabled: false,
};

test("generation dispatch schedules the coordinator action and bounded watchdog", async () => {
  const scheduled: Array<{ delay: number; args: unknown }> = [];
  const operationId = await enqueueRunGeneration({
    scheduler: {
      runAfter: async (delay: number, _reference: unknown, args: unknown) => {
        scheduled.push({ delay, args });
        return `scheduled_${scheduled.length}`;
      },
    },
  } as never, generationArgs as never);

  assert.equal(operationId, "scheduled_1");
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0]?.delay, 0);
  assert.deepEqual(scheduled[0]?.args, generationArgs);
  assert.equal(scheduled[1]?.delay, 30_000);
  assert.deepEqual(scheduled[1]?.args, {
    generationArgs,
    restartAttempt: 0,
  });
});

test("dispatch watchdog settles when every participant has a driver or terminal job", async () => {
  let restarted = 0;
  let rechecked = 0;
  const result = await reconcileRunGenerationDispatchHandler(
    {} as never,
    { generationArgs: generationArgs as never, restartAttempt: 0 },
    {
      findStranded: async () => [],
      restart: async () => {
        restarted += 1;
        return "replacement";
      },
      scheduleRecheck: async () => {
        rechecked += 1;
      },
      finalize: async () => undefined,
    },
  );

  assert.equal(result, "settled");
  assert.equal(restarted, 0);
  assert.equal(rechecked, 0);
});

test("dispatch watchdog restarts only stranded participants and advances its bound", async () => {
  let restartedArgs: typeof generationArgs | undefined;
  let recheckArgs:
    | { generationArgs: typeof generationArgs; restartAttempt: number }
    | undefined;
  const stranded = generationArgs.participants[1];
  const result = await reconcileRunGenerationDispatchHandler(
    {} as never,
    { generationArgs: generationArgs as never, restartAttempt: 1 },
    {
      findStranded: async () => [stranded as never],
      restart: async (_ctx, args) => {
        restartedArgs = args as typeof generationArgs;
        return "replacement";
      },
      scheduleRecheck: async (_ctx, args) => {
        recheckArgs = args as typeof recheckArgs;
      },
      finalize: async () => undefined,
    },
  );

  assert.equal(result, "restarted");
  assert.deepEqual(restartedArgs?.participants, [stranded]);
  assert.equal(
    typeof (restartedArgs as typeof generationArgs & { enqueuedAt?: number })
      ?.enqueuedAt,
    "number",
  );
  assert.equal(recheckArgs?.restartAttempt, 2);
  assert.deepEqual(recheckArgs?.generationArgs.participants, [stranded]);
});

test("dispatch watchdog fails stranded participants after bounded retries", async () => {
  const finalized: string[] = [];
  const result = await reconcileRunGenerationDispatchHandler(
    {} as never,
    { generationArgs: generationArgs as never, restartAttempt: 3 },
    {
      findStranded: async () => generationArgs.participants as never,
      restart: async () => "replacement",
      scheduleRecheck: async () => undefined,
      finalize: async (_ctx, args) => {
        finalized.push(String(args.jobId));
        return undefined;
      },
    },
  );

  assert.equal(result, "failed");
  assert.deepEqual(finalized, ["job_1", "job_2"]);
});

test("dispatch watchdog propagates terminal finalization failures", async () => {
  await assert.rejects(
    () => reconcileRunGenerationDispatchHandler(
      {} as never,
      { generationArgs: generationArgs as never, restartAttempt: 3 },
      {
        findStranded: async () => [generationArgs.participants[0] as never],
        restart: async () => "replacement",
        scheduleRecheck: async () => undefined,
        finalize: async () => {
          throw new Error("transient finalize failure");
        },
      },
    ),
    /transient finalize failure/,
  );
});
