import assert from "node:assert/strict";
import test from "node:test";
import { parseWebPushSubscription } from "../push/subscription";

const subscription = (endpoint: string) => JSON.stringify({ endpoint, keys: { p256dh: "test-key", auth: "test-auth" }, expirationTime: null });
test("web push subscriptions accept HTTPS endpoints on supported push services", () => {
  for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "foo.notify.windows.com", "web.push.apple.com"]) {
    const endpoint = `https://${host}/subscription/path`;
    assert.equal(parseWebPushSubscription(subscription(endpoint)).endpoint, endpoint);
  }
});
test("web push rejects private, non-service and disguised endpoint hosts before any network request", () => {
  for (const endpoint of ["http://fcm.googleapis.com/sub", "https://127.0.0.1/sub", "https://[::1]/sub", "https://evil.invalid/sub", "https://fcm.googleapis.com.evil.invalid/sub", "https://evil.invalid/?fcm.googleapis.com", "https://user@fcm.googleapis.com/sub", "https://fcm.googleapis.com:8443/sub"]) {
    assert.throws(() => parseWebPushSubscription(subscription(endpoint)), /Invalid web push/);
  }
  assert.throws(() => parseWebPushSubscription('{"endpoint":"https://fcm.googleapis.com/sub"}'), /Invalid web push/);
});
