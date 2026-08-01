import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveMicrosoftOAuthClientConfigForRedirect,
  resolveStoredMicrosoftOAuthClientConfig,
} from "../oauth/microsoft_client_config";

test("microsoft config uses native client for custom scheme redirects", () => {
  process.env.MICROSOFT_CLIENT_ID = "native-client";
  process.env.MICROSOFT_CLIENT_SECRET = "must-not-be-used";
  delete process.env.MICROSOFT_WEB_CLIENT_ID;
  delete process.env.MICROSOFT_WEB_CLIENT_SECRET;

  const config = resolveMicrosoftOAuthClientConfigForRedirect(
    "tech.nanthai.NanthAi-Edge://oauth/microsoft/callback",
  );

  assert.equal(config.clientId, "native-client");
  assert.equal(config.clientType, "native");
  assert.equal(config.clientSecret, undefined);
});

test("microsoft config requires a secret for web redirects", () => {
  process.env.MICROSOFT_CLIENT_ID = "shared-client";
  delete process.env.MICROSOFT_CLIENT_SECRET;
  delete process.env.MICROSOFT_WEB_CLIENT_ID;
  delete process.env.MICROSOFT_WEB_CLIENT_SECRET;

  assert.throws(
    () => resolveMicrosoftOAuthClientConfigForRedirect(
      "http://localhost:5174/oauth/microsoft/callback",
    ),
    /MICROSOFT_WEB_CLIENT_SECRET or MICROSOFT_CLIENT_SECRET/,
  );
});

test("microsoft config uses the confidential web client for http redirects", () => {
  process.env.MICROSOFT_CLIENT_ID = "shared-client";
  process.env.MICROSOFT_CLIENT_SECRET = "web-secret";
  delete process.env.MICROSOFT_WEB_CLIENT_ID;
  delete process.env.MICROSOFT_WEB_CLIENT_SECRET;

  const config = resolveMicrosoftOAuthClientConfigForRedirect(
    "http://localhost:5174/oauth/microsoft/callback",
  );

  assert.equal(config.clientId, "shared-client");
  assert.equal(config.clientType, "web");
  assert.equal(config.clientSecret, "web-secret");
});

test("stored microsoft config preserves native compatibility when client type is missing", () => {
  process.env.MICROSOFT_CLIENT_ID = "native-client";

  const config = resolveStoredMicrosoftOAuthClientConfig(undefined);

  assert.equal(config.clientId, "native-client");
  assert.equal(config.clientType, "native");
  assert.equal(config.clientSecret, undefined);
});
