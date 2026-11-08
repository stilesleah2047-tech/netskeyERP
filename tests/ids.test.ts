import { test } from "node:test";
import assert from "node:assert/strict";
import { isObjectId } from "../src/lib/server/ids";

test("ObjectId validation rejects malformed ids instead of crashing routes", () => {
  assert.ok(isObjectId("65f0c0ffee0000000000abcd"));
  assert.ok(!isObjectId("not-an-id"));
  assert.ok(!isObjectId("123456789012")); // 12-char strings are not accepted
  assert.ok(!isObjectId(undefined));
});
