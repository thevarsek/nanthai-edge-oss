import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveGoogleOAuthClientConfigForRedirect,
  resolveStoredGoogleOAuthClientConfig,
} from "../oauth/google_client_config";

test("google config uses native client for custom scheme redirects", () => {
  process.env.GOOGLE_CLIENT_ID = "native-client";
  delete process.env.GOOGLE_WEB_CLIENT_ID;
  delete process.env.GOOGLE_WEB_CLIENT_SECRET;

  const config = resolveGoogleOAuthClientConfigForRedirect(
    "com.googleusercontent.apps.example:/oauth/google/callback",
  );

  assert.equal(config.clientId, "native-client");
  assert.equal(config.clientType, "native");
  assert.equal(config.clientSecret, undefined);
});

test("google config uses web client for https redirects", () => {
  process.env.GOOGLE_CLIENT_ID = "native-client";
  process.env.GOOGLE_WEB_CLIENT_ID = "web-client";
  process.env.GOOGLE_WEB_CLIENT_SECRET = "web-secret";

  const config = resolveGoogleOAuthClientConfigForRedirect(
    "https://nanthai.tech/oauth/google/callback",
  );

  assert.equal(config.clientId, "web-client");
  assert.equal(config.clientType, "web");
  assert.equal(config.clientSecret, "web-secret");
});

test("stored google config falls back to native when client type missing", () => {
  process.env.GOOGLE_CLIENT_ID = "native-client";
  delete process.env.GOOGLE_WEB_CLIENT_ID;

  const config = resolveStoredGoogleOAuthClientConfig(undefined);

  assert.equal(config.clientId, "native-client");
  assert.equal(config.clientType, "native");
});
