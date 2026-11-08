import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkCallbackAuth, callbackUrlWithSecret, mpesaEnabled } from "../src/lib/server/mpesaGuard";

const env = process.env as Record<string, string | undefined>;
beforeEach(() => {
  delete env.MPESA_ENABLED;
  delete env.DARAJA_CALLBACK_SECRET;
  delete env.DARAJA_CALLBACK_IP_ALLOWLIST;
  env.NODE_ENV = "production";
});

test("M-Pesa is off by default and callbacks are rejected", () => {
  assert.equal(mpesaEnabled(), false);
  assert.match(checkCallbackAuth("1.2.3.4", null) ?? "", /disabled/);
});

test("production with no secret or allowlist rejects callbacks", () => {
  env.MPESA_ENABLED = "true";
  assert.notEqual(checkCallbackAuth("1.2.3.4", null), null);
});

test("secret is required and compared exactly", () => {
  env.MPESA_ENABLED = "true";
  env.DARAJA_CALLBACK_SECRET = "s3cret-value";
  assert.notEqual(checkCallbackAuth("1.2.3.4", null), null);
  assert.notEqual(checkCallbackAuth("1.2.3.4", "wrong"), null);
  assert.equal(checkCallbackAuth("1.2.3.4", "s3cret-value"), null);
  assert.equal(new URL(callbackUrlWithSecret("https://x.test/api/mpesa/callback")).searchParams.get("s"), "s3cret-value");
});

test("IP allowlist is enforced", () => {
  env.MPESA_ENABLED = "true";
  env.DARAJA_CALLBACK_IP_ALLOWLIST = "196.201.214.200, 196.201.214.206";
  assert.equal(checkCallbackAuth("196.201.214.206", null), null);
  assert.notEqual(checkCallbackAuth("8.8.8.8", null), null);
});
