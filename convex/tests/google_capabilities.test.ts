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
  assert.equal(isGoogleIntegrationId("workspace"), true);
  assert.equal(isGoogleIntegrationId("notion"), false);

  assert.deepEqual(googleScopesForIntegration("base"), GOOGLE_BASE_SCOPES);
  assert.deepEqual(googleScopesForIntegration("workspace"), [
    ...GOOGLE_BASE_SCOPES,
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.events",
  ]);
  assert.equal(
    googleProviderScopeForIntegration("gmail"),
    "",
  );
});

test("deriveGoogleCapabilityFlags and mergeGoogleScopes handle mixed scope sets", () => {
  const merged = mergeGoogleScopes(
    ["openid", "https://www.googleapis.com/auth/drive.file"],
    [
      "openid",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  );

  assert.deepEqual(merged, [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file",
    "openid",
  ]);

  assert.deepEqual(deriveGoogleCapabilityFlags(merged), {
    hasGmail: false,
    hasDrive: true,
    hasCalendar: true,
  });
});
