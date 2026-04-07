import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_BASE_SCOPES,
  deriveGoogleCapabilityFlags,
  googleProviderScopeForIntegration,
  googleScopesForIntegration,
  isGoogleIntegrationId,
  mergeGoogleScopes,
} from "../oauth/google_capabilities";

test("google capability helpers validate ids and expose scope maps", () => {
  assert.equal(isGoogleIntegrationId("base"), true);
  assert.equal(isGoogleIntegrationId("gmail"), true);
  assert.equal(isGoogleIntegrationId("drive"), true);
  assert.equal(isGoogleIntegrationId("calendar"), true);
  assert.equal(isGoogleIntegrationId("notion"), false);

  assert.deepEqual(googleScopesForIntegration("base"), GOOGLE_BASE_SCOPES);
  assert.equal(
    googleProviderScopeForIntegration("gmail"),
    "https://www.googleapis.com/auth/gmail.modify",
  );
});

test("deriveGoogleCapabilityFlags and mergeGoogleScopes handle mixed scope sets", () => {
  const merged = mergeGoogleScopes(
    ["openid", "https://www.googleapis.com/auth/drive"],
    [
      "https://www.googleapis.com/auth/gmail.modify",
      "openid",
      "https://www.googleapis.com/auth/calendar",
    ],
  );

  assert.deepEqual(merged, [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.modify",
    "openid",
  ]);

  assert.deepEqual(deriveGoogleCapabilityFlags(merged), {
    hasGmail: true,
    hasDrive: true,
    hasCalendar: true,
  });
});
