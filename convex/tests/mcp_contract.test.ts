import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path: string) => await readFile(new URL(path, import.meta.url), "utf8");

test("MCP transport pins 2026-07-28 and uses only the egress gateway", async () => {
  const [client, gateway] = await Promise.all([
    read("../mcp/sdk_client.ts"),
    read("../mcp/gateway_fetch.ts"),
  ]);
  assert.match(client, /mode:\s*\{ pin: MCP_PROTOCOL_VERSION \}/);
  assert.match(client, /createDefaultMcpGatewayFetch/);
  assert.doesNotMatch(client, /mode:\s*["']auto["']/);
  assert.match(gateway, /redirect:\s*["']manual["']/);
  assert.match(gateway, /x-nanthai-egress-key/);
});

test("MCP schema and cleanup keep credentials in a separate owned domain", async () => {
  const [schema, purge, queries] = await Promise.all([
    read("../schema_tables_mcp.ts"),
    read("../account/purge_tables.ts"),
    read("../mcp/queries.ts"),
  ]);
  for (const table of [
    "mcpConnections",
    "mcpCredentials",
    "mcpOAuthTransactions",
    "mcpCatalogItems",
    "mcpCatalogSnapshots",
    "mcpInvocations",
  ]) {
    assert.match(schema, new RegExp(`${table}: defineTable`));
    assert.match(purge, new RegExp(`"${table}"`));
  }
  assert.doesNotMatch(queries, /accessToken:\s*connection/);
  assert.doesNotMatch(queries, /credentialValue/);
  assert.match(schema, /mcpOAuthTransactions:[\s\S]*?\.index\("by_user", \["userId", "createdAt"\]\)/);
});

test("MCP dynamic tools are standing authorization with no unsafe retry", async () => {
  const registry = await read("../mcp/tool_registry.ts");
  assert.match(registry, /effect:\s*"write", retry:\s*"never"/);
  assert.match(registry, /128 - registry\.size/);
  assert.match(registry, /invokeAllowedTool/);
  assert.doesNotMatch(registry, /confirm|approval/i);
});

test("MCP deferred work is owned by M46/M47 and every remote continuation is journaled", async () => {
  const [executionWaiting, lifecycle, taskLifecycle, taskWorkflow, continuation, scheduler, artifactWriter, artifactLinker] = await Promise.all([
    read("../mcp/execution_waiting.ts"),
    read("../mcp/lifecycle_mutations.ts"),
    read("../mcp/task_lifecycle.ts"),
    read("../mcp/task_workflow.ts"),
    read("../mcp/continuation_actions.ts"),
    read("../mcp/deferred_workflow_scheduler.ts"),
    read("../tools/artifact_writer.ts"),
    read("../tools/artifact_mcp_linker.ts"),
  ]);
  assert.match(executionWaiting, /createAndClaimDomainExecution/);
  assert.match(executionWaiting, /durableWorkflow\.start/);
  assert.match(lifecycle, /requestRunTreeTeardown/);
  assert.match(taskLifecycle, /invocation\.toolAlias \?\? "remote_mcp"/);
  assert.match(taskWorkflow, /internal\.execution\.operations\.prepare/);
  assert.match(taskWorkflow, /retry:\s*"safe"/);
  assert.match(continuation, /markOutcomeUnknown/);
  assert.match(continuation, /claimInvocationOperation/);
  assert.match(continuation, /resumeInvocationOperation/);
  assert.match(continuation, /settleMcpInvocation/);
  assert.match(continuation, /queueMcpInvocationSettlement/);
  assert.match(continuation, /MCP_TASK_INPUT_REQUIRED/);
  assert.match(continuation, /mcpOperationInputHash/);
  assert.match(continuation, /invocation\.catalogStableKey/);
  assert.doesNotMatch(continuation, /inputHash:\s*JSON\.stringify/);
  assert.match(scheduler, /saveCheckpointAndBindInvocation/);
  assert.match(lifecycle, /saveGenerationContinuationHandler/);
  assert.match(artifactWriter, /attachRemoteMcpArtifacts/);
  assert.match(artifactLinker, /invocation_mutations\.attachArtifacts/);
});

test("MCP prompt and resource context stays attributed and storage-backed", async () => {
  const [mapping, messageContext, assembly, publicQueries, schema] = await Promise.all([
    read("../mcp/content_mapping.ts"),
    read("../mcp/message_context.ts"),
    read("../chat/actions_context_assembly_integration.ts"),
    read("../chat/queries_handlers_public.ts"),
    read("../schema_tables_mcp.ts"),
  ]);
  assert.match(mapping, /ctx\.storage\.store/);
  assert.match(mapping, /\[Remote MCP/);
  assert.match(messageContext, /invocation\.state !== "completed"/);
  assert.match(messageContext, /invocation\.messageId/);
  assert.match(messageContext, /invocation\.chatId !== chatId/);
  assert.match(messageContext, /invocation\.chatId !== chatId/);
  assert.match(assembly, /role:\s*"user" as const/);
  assert.doesNotMatch(assembly, /mcpContexts[\s\S]{0,200}role:\s*"system"/);
  assert.match(schema, /contentItems:/);
  assert.match(schema, /\.index\("by_chat", \["chatId", "updatedAt"\]\)/);
  assert.match(publicQueries, /Omit<Doc<"messages">, "searchContext" \| "mcpInvocationIds">/);
  assert.match(publicQueries, /Math\.min\(MAX_LIST_MESSAGES_LIMIT/);
});

test("MCP OAuth refresh is CAS protected and disconnect removes local secrets", async () => {
  const [credentials, oauthActions, oauthMetadata, oauthMutations, disconnect] = await Promise.all([
    read("../mcp/credentials.ts"),
    read("../mcp/oauth_actions.ts"),
    read("../mcp/oauth_metadata.ts"),
    read("../mcp/oauth_mutations.ts"),
    read("../mcp/disconnect_action.ts"),
  ]);
  assert.match(credentials, /grant_type:\s*"refresh_token"/);
  assert.match(credentials, /expectedRevision:\s*row\.refreshRevision/);
  assert.match(oauthMetadata, /discoverOAuthServerInfo/);
  assert.match(oauthMetadata, /discoverAuthorizationServerMetadata/);
  assert.match(oauthActions, /metadata\.resource/);
  assert.match(oauthMetadata, /checkResourceAllowed/);
  assert.match(oauthMutations, /credential\.refreshRevision !== args\.expectedRevision/);
  assert.match(oauthMutations, /claimOAuthRefresh/);
  assert.match(oauthMutations, /credential\.refreshLeaseId !== args\.leaseId/);
  assert.match(oauthMutations, /priorTransactions/);
  assert.match(oauthMutations, /ctx\.db\.delete\(transaction\._id\)/);
  assert.match(oauthMutations, /oauthTransactionStateHash:\s*args\.stateHash/);
  assert.match(oauthActions, /expectedOAuthStateHash:\s*stateHash/);
  assert.match(disconnect, /credential\.revocationEndpoint/);
  assert.match(disconnect, /beginConnectionDisconnect/);
  assert.ok(
    disconnect.indexOf("beginConnectionDisconnect") < disconnect.lastIndexOf("createDefaultMcpGatewayFetch()"),
    "local MCP deletion must happen before best-effort remote revocation",
  );
  assert.doesNotMatch(disconnect, /console\./);
});

test("credential rotation renews its execution lease and terminalizes success", async () => {
  const [mutations, workflow] = await Promise.all([
    read("../security/secret_rotation_mutations.ts"),
    read("../security/secret_rotation_workflow.ts"),
  ]);
  assert.match(mutations, /leaseExpiresAt:\s*now \+ 20 \* 60 \* 1_000/);
  assert.match(workflow, /internal\.execution\.mutations\.terminalize/);
  assert.match(workflow, /outcome:\s*"completed"/);
});

test("MCP cancellation and task races are fenced across dispatch, polling, and disconnect", async () => {
  const [invokeAction, toolAction, taskActions, taskWorker, taskWorkflow, taskLifecycle, lifecycle, disconnect, credentials] = await Promise.all([
    read("../mcp/invoke_action.ts"),
    read("../mcp/tool_action.ts"),
    read("../mcp/task_actions.ts"),
    read("../mcp/task_worker_action.ts"),
    read("../mcp/task_workflow.ts"),
    read("../mcp/task_lifecycle.ts"),
    read("../mcp/lifecycle_mutations.ts"),
    read("../mcp/disconnect_action.ts"),
    read("../mcp/credentials.ts"),
  ]);
  assert.match(invokeAction, /if \(!persisted\) throw new Error\("MCP_INVOCATION_SUPERSEDED"\)/);
  assert.match(invokeAction, /remoteToolDispatched = true;[\s\S]*?client\.callTool/);
  assert.match(invokeAction, /failureState = remoteToolDispatched \? "outcome_unknown" : "failed"/);
  assert.match(invokeAction, /MCP_REMOTE_OUTCOME_UNKNOWN/);
  assert.match(toolAction, /if \(!persisted\) throw new Error\("MCP_INVOCATION_SUPERSEDED"\)/);
  assert.match(taskActions, /args\.operation !== "cancel"/);
  assert.match(taskActions, /getAllowedItem/);
  assert.match(taskActions, /resumeInvocationOperation/);
  assert.match(taskActions, /releaseTaskOperation/);
  assert.match(taskActions, /args\.operation === "get" && state === "awaiting_input"/);
  assert.match(taskActions, /restoreTaskInputWait/);
  assert.match(taskActions, /settleMcpInvocation/);
  assert.match(taskActions, /state: "outcome_unknown"[\s\S]{0,500}settleMcpInvocation/);
  assert.match(taskWorker, /claimInvocationOperation/);
  assert.match(taskWorker, /getAllowedItem/);
  assert.match(taskWorker, /expectedOperationKey: args\.operationKey/);
  assert.match(taskWorkflow, /if \(!waiting\) continue/);
  assert.match(taskLifecycle, /invocation\.state === "awaiting_input" \|\| invocation\.state === "task_pending"/);
  assert.match(taskLifecycle, /scheduleDeferredInvocationSettlement/);
  assert.match(taskLifecycle, /taskResumeEventId[\s\S]*action: "terminal"/);
  assert.match(lifecycle, /invocation\.state !== "awaiting_input"/);
  assert.match(disconnect, /beginConnectionDisconnect/);
  assert.match(disconnect, /deleteConnectionAfter: true/);
  assert.doesNotMatch(disconnect, /runMutation\(internal\.mcp\.mutations\.deleteConnectionData/);
  assert.match(credentials, /REFRESH_LEASE_MS = 120_000/);
  assert.match(credentials, /winner\.refreshRevision !== row\.refreshRevision/);
});
