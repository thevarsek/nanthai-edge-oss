import assert from "node:assert/strict";
import test from "node:test";
import { generationRecovery } from "../chat/generation_recovery";
import { openRouterErrorDetails } from "../lib/openrouter_error";
import { deploymentAnalyticsProperties } from "../analytics/deployment_environment";

const failed = { role: "assistant", status: "failed", content: "" };
test("credit and authentication recovery works for current and historical persisted failures", () => {
  for (const content of [JSON.stringify(openRouterErrorDetails(402, "")), "Your OpenRouter balance is too low for this model.", 'Error: {"error":{"code":"INSUFFICIENT_CREDITS","message":"Payment required"}}']) {
    assert.deepEqual(generationRecovery({ ...failed, content })?.actions, ["openrouter_credits", "change_model"]);
  }
  for (const content of [JSON.stringify(openRouterErrorDetails(401, "")), "OpenRouter request failed (HTTP 401). Please try again or reconnect OpenRouter in Settings."]) {
    assert.deepEqual(generationRecovery({ ...failed, content })?.actions, ["reconnect_openrouter"]);
  }
});
test("provider failures, cancellation, partial prose, and non-assistant messages do not suggest reconnecting", () => {
  for (const status of [400, 403, 404, 422, 429, 500, 503]) {
    const details = openRouterErrorDetails(status, "bad request");
    assert.doesNotMatch(details.message, /reconnect/i);
    assert.equal(generationRecovery({ ...failed, content: JSON.stringify(details) }), undefined);
  }
  const content = JSON.stringify(openRouterErrorDetails(402, ""));
  for (const message of [{ ...failed, content, role: "user" }, { ...failed, content, status: "completed" }, { ...failed, content, terminalErrorCode: "cancelled_by_user" }, { ...failed, content: 'Example: "HTTP 401" and insufficient credits' }]) {
    assert.equal(generationRecovery(message), undefined);
  }
});
test("deployment metadata never defaults unknown installations to production", () => {
  assert.equal(deploymentAnalyticsProperties("production").deployment_environment, "production");
  assert.equal(deploymentAnalyticsProperties("development").deployment_environment, "development");
  for (const environment of ["", "staging", "https://another.convex.cloud"]) {
    assert.equal(deploymentAnalyticsProperties(environment).deployment_environment, "unknown");
  }
});
