import assert from "node:assert/strict";
import test from "node:test";
import { storeAccountTokenForUser, storeAccountTokenMatches } from "../preferences/store_account_token";
import { evaluateAppStoreTransaction, evaluatePlayPurchase } from "../preferences/store_purchase_verification";

const paid = {
  bundleId: "tech.example.app",
  productId: "tech.nanthai.edge.pro.lifetime",
  originalTransactionId: "2000000123",
  environment: "Production",
};

test("each user gets a stable UUID that StoreKit and Play accept", async () => {
  const first = await storeAccountTokenForUser("user_1");
  assert.equal(first, await storeAccountTokenForUser("user_1"));
  assert.notEqual(first, await storeAccountTokenForUser("user_2"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(first.length <= 64, "Play obfuscated account IDs are capped at 64 characters");
});

test("tokens must match when present and are optional for older purchases", async () => {
  const expected = await storeAccountTokenForUser("user_1");
  assert.equal(storeAccountTokenMatches(undefined, expected), true);
  assert.equal(storeAccountTokenMatches("", expected), true);
  assert.equal(storeAccountTokenMatches(expected.toUpperCase(), expected), true);
  assert.equal(storeAccountTokenMatches(await storeAccountTokenForUser("user_2"), expected), false);
});

test("App Store and Play purchases bound to another account are refused", async () => {
  const mine = await storeAccountTokenForUser("user_1");
  const theirs = await storeAccountTokenForUser("user_2");
  const config = { bundleId: "tech.example.app", acceptTest: false };
  assert.equal(evaluateAppStoreTransaction({ ...paid, appAccountToken: mine }, "2000000123", config, mine).ok, true);
  assert.equal(evaluateAppStoreTransaction(paid, "2000000123", config, mine).ok, true);
  const apple = evaluateAppStoreTransaction({ ...paid, appAccountToken: theirs }, "2000000123", config, mine);
  assert.deepEqual(apple.ok ? null : apple.reason, "account_mismatch");

  assert.equal(evaluatePlayPurchase({ purchaseState: 0, obfuscatedExternalAccountId: mine }, "nanthai.pro.lifetime", "tok", { acceptTest: false }, mine).ok, true);
  assert.equal(evaluatePlayPurchase({ purchaseState: 0 }, "nanthai.pro.lifetime", "tok", { acceptTest: false }, mine).ok, true);
  const play = evaluatePlayPurchase({ purchaseState: 0, obfuscatedExternalAccountId: theirs }, "nanthai.pro.lifetime", "tok", { acceptTest: false }, mine);
  assert.deepEqual(play.ok ? null : play.reason, "account_mismatch");
});
